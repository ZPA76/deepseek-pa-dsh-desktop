'use strict'

// DeepSeek-PA (DPA) —— 基于 DeepSeek Harness 的 Windows 桌面端。
// 职责：单实例锁、拉起本地 `pnpm dsh web`、原生窗口承载 Web UI、
//       系统托盘常驻、开机自启、全局快捷键唤起、任务完成通知。
// harness 本体与 Cordis 插件架构完全不动。

const { app, BrowserWindow, Menu, dialog, shell, Tray, nativeImage, globalShortcut, Notification, ipcMain, session, safeStorage, crashReporter } = require('electron')
const { spawn, spawnSync } = require('child_process')
const http = require('http')
const path = require('path')
const fs = require('fs')
const { DshUpdater, readPackageVersion } = require('./dsh-updater.js')
const { createCapabilityRegistry } = require('./capability-registry.js')
const { createGitHubAuth } = require('./github-auth.js')
const { selectClusterRuntime, detectHarnessTeam } = require('./harness-team-adapter.js')

// Windows 搜索、任务栏分组和开始菜单快捷方式必须使用同一个稳定标识。
// 需要在 ready 之前同步设置，避免 Electron 回退到 electron.app.* 临时标识。
if (process.platform === 'win32') app.setAppUserModelId('com.deepseek.pa')

// 集群项目房间与统一治理引擎
let clusterEngine = null
try {
  clusterEngine = require('./cluster-engine.js')
} catch (e) {
  console.error('集群引擎加载失败：', e.message)
}

const SERVER_URL = process.env.DSH_DESKTOP_URL || 'http://127.0.0.1:3080'
const LEGACY_HARNESS_DIR = process.env.DSH_DESKTOP_LEGACY_HARNESS_DIR || path.join(process.env.HOME || process.env.USERPROFILE || process.cwd(), 'deepseek-harness')
const DPA_SOURCE_ROOT = __dirname

function isHarnessRuntime(directory) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))
    return pkg.name === '@deepseek-ai/dsh-root'
  } catch (_) {
    return false
  }
}

function resolveHarnessDir() {
  if (process.env.DSH_DESKTOP_HARNESS_DIR) return path.resolve(process.env.DSH_DESKTOP_HARNESS_DIR)
  const candidates = [
    path.join(path.dirname(process.execPath), 'runtime', 'harness'),
    path.join(__dirname, 'runtime', 'harness'),
    path.join(DPA_SOURCE_ROOT, 'runtime', 'harness'),
    LEGACY_HARNESS_DIR,
  ]
  return candidates.find(isHarnessRuntime) || path.join(DPA_SOURCE_ROOT, 'runtime', 'harness')
}

const HARNESS_DIR = resolveHarnessDir()
// 统一传给集群 ACP 员工，确保桌面 UI 与员工执行使用同一份托管 DSH。
process.env.DSH_DESKTOP_HARNESS_DIR = HARNESS_DIR
const STARTUP_TIMEOUT_MS = Number(process.env.DSH_DESKTOP_STARTUP_TIMEOUT_MS || 180000)
const DSH_HOME_DIR = process.env.DSH_DESKTOP_DSH_HOME || path.join(process.env.LOCALAPPDATA || process.env.HOME || process.cwd(), 'DeepSeek-PA', 'dsh-home')
const DATA_DIR = process.env.DSH_DESKTOP_DATA_DIR || path.join(process.env.LOCALAPPDATA || process.env.HOME || process.cwd(), 'DeepSeek-PA', 'data')

const DIAGNOSTIC_LOG_MAX_BYTES = 2 * 1024 * 1024
function writeDiagnostic(kind, error, extra = '') {
  try {
    const logDir = path.join(DATA_DIR, 'logs')
    fs.mkdirSync(logDir, { recursive: true })
    const file = path.join(logDir, 'dpa-main.log')
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > DIAGNOSTIC_LOG_MAX_BYTES) {
        fs.renameSync(file, `${file}.prev`)
      }
    } catch (_) {}
    const detail = error && error.stack ? error.stack : String(error || '')
    const suffix = extra ? ` ${typeof extra === 'string' ? extra : JSON.stringify(extra)}` : ''
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${kind}: ${detail.slice(0, 8000)}${suffix.slice(0, 4000)}\n`, 'utf8')
  } catch (_) {}
}
const HOTKEY = process.env.DSH_DESKTOP_HOTKEY || 'CommandOrControl+Shift+Space'

const githubAuth = createGitHubAuth({ dataDir: DATA_DIR, safeStorage })
const capabilityRegistry = createCapabilityRegistry({
  dataDir: DATA_DIR,
  dshHome: DSH_HOME_DIR,
  harnessDir: HARNESS_DIR,
  githubAuth,
})

// 缓存与数据全部落在 Z 盘：C 盘 AppData 零占用
app.setPath('userData', DATA_DIR)
app.setPath('sessionData', path.join(DATA_DIR, 'session'))

try {
  crashReporter.start({
    uploadToServer: false,
    rateLimit: true,
    productName: 'DeepSeek-PA',
    globalExtra: { dpaVersion: readPackageVersion(__dirname) },
  })
} catch (error) {
  writeDiagnostic('crash-reporter-start-failed', error)
}

process.on('uncaughtExceptionMonitor', (error, origin) => {
  writeDiagnostic('uncaught-exception', error, origin)
})
process.on('unhandledRejection', (reason) => {
  writeDiagnostic('unhandled-rejection', reason)
  setImmediate(() => { throw (reason instanceof Error ? reason : new Error(String(reason))) })
})

let mainWindow = null
let serverProcess = null
let loadingPhase = true
let tray = null
let isQuitting = false
let serverStopRequested = false
let serverErrorTail = ''
let serverRestartAttempts = 0
let serverRestartTimer = null
let rendererRecoveryAttempts = 0
let rendererRecoveryTimer = null
let updateCheckPromise = null
let updateInstallPromise = null
const dshUpdater = new DshUpdater({ harnessDir: HARNESS_DIR })

function applyWindowZoom(appearanceState) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const zoom = Number(appearanceState && appearanceState.typography && appearanceState.typography.zoom || 100)
  mainWindow.webContents.setZoomFactor(Math.min(2, Math.max(.8, zoom / 100)))
}

// ── 系统托盘 ──────────────────────────────────────────────────────────────
function resolveTrayIcon() {
  const candidates = [
    path.join(__dirname, 'icon.ico'),
    path.join(__dirname, 'icon.png'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) return img
    }
  }
  // 无图标文件时用一个 16x16 的透明占位，避免托盘崩溃
  return nativeImage.createEmpty()
}

function createTray() {
  if (tray) return
  tray = new Tray(resolveTrayIcon())
  tray.setToolTip('DeepSeek-PA')
  const menu = Menu.buildFromTemplate([
    { label: '显示 DeepSeek-PA', click: () => showMainWindow() },
    { label: '隐藏', click: () => mainWindow && mainWindow.hide() },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked })
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => {
    if (mainWindow && mainWindow.isVisible()) mainWindow.hide()
    else showMainWindow()
  })
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow().catch((e) => console.error(e))
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

// 页面通过 preload 触发系统通知（用于任务完成等事件）
ipcMain.on('dpa:notify', (_event, payload) => {
  const { title, body } = payload || {}
  notify(title || 'DeepSeek-PA', body || '')
})

// ── 集群模块 IPC ─────────────────────────────────────────────────────────
const clusterRuns = new Map()

function requireClusterEngine() {
  if (!clusterEngine) throw new Error('集群引擎未加载')
  return clusterEngine
}

function sendClusterEvent(event) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try { mainWindow.webContents.send('cluster:event', event) } catch (_) {}
}

function activeRun(projectId) {
  return clusterRuns.get(String(projectId || '')) || null
}

function createRunContext(projectId, runId) {
  return {
    projectId,
    runId,
    controller: new AbortController(),
    paused: false,
    resumeWaiters: [],
    approvals: new Map(),
    userMessages: [],
    waitIfPaused() {
      if (!this.paused) return Promise.resolve()
      return new Promise((resolve) => this.resumeWaiters.push(resolve))
    },
    resume() {
      this.paused = false
      for (const resolve of this.resumeWaiters.splice(0)) resolve()
    },
    finishApprovals(status = 'cancelled') {
      for (const resolve of this.approvals.values()) resolve({ status, feedback: '' })
      this.approvals.clear()
    },
  }
}

function startClusterProject(project) {
  const engine = requireClusterEngine()
  if (!project || !project.id) throw new Error('项目缺少 ID')
  const existing = activeRun(project.id)
  if (existing) return { started: false, reason: 'already-running', runId: existing.runId }

  const selectedRuntime = selectClusterRuntime(HARNESS_DIR, project.executionRuntime)
  const saved = engine.saveProject({ ...project, executionRuntime: selectedRuntime.id })
  const runId = `run-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const context = createRunContext(saved.id, runId)
  clusterRuns.set(saved.id, context)

  context.promise = engine.runCluster(saved, {
    runId,
    runtimeMode: selectedRuntime.id,
    signal: context.controller.signal,
    onStep: sendClusterEvent,
    waitIfPaused: () => context.waitIfPaused(),
    consumeUserMessages: () => context.userMessages.splice(0),
    onApproval: (approval) => new Promise((resolve) => {
      context.approvals.set(approval.id, resolve)
    }),
  }).then((result) => {
    notify('DPA 项目等待已结束', `${saved.name} 已通过验收`)
    return result
  }).catch((error) => {
    if (error && error.name !== 'AbortError') notify('DPA 项目运行失败', `${saved.name}：${error.message || error}`)
    return { status: error && error.name === 'AbortError' ? 'cancelled' : 'failed', error: String(error && error.message || error) }
  }).finally(() => {
    context.finishApprovals('cancelled')
    context.resume()
    if (clusterRuns.get(saved.id) === context) clusterRuns.delete(saved.id)
  })

  return { started: true, runId, projectId: saved.id, runtime: selectedRuntime }
}

const clusterMethods = {
  listAgents: (payload) => requireClusterEngine().listAgents({ includeArchived: Boolean(payload && payload.includeArchived) }),
  listSkills: (payload) => requireClusterEngine().listSkills(payload || {}),
  saveAgent: (payload) => requireClusterEngine().saveAgent(payload),
  archiveAgent: (payload) => requireClusterEngine().archiveAgent(payload.id, Boolean(payload.archived)),
  deleteAgent: (payload) => requireClusterEngine().deleteAgent(payload.id),
  addProjectMember: (payload) => requireClusterEngine().addProjectMember(payload.projectId, payload.member),
  removeProjectMember: (payload) => requireClusterEngine().removeProjectMember(payload.projectId, payload.memberId),
  draftAgent: (payload) => requireClusterEngine().draftAgent(payload),
  trainAgent: (payload) => requireClusterEngine().trainAgent(payload),
  listAgentVersions: (payload) => requireClusterEngine().listAgentVersions(payload.id),
  restoreAgentVersion: (payload) => requireClusterEngine().restoreAgentVersion(payload.id, payload.version),
  listTrainingRuns: (payload) => requireClusterEngine().listTrainingRuns(payload.id),
  promoteTrainingRun: (payload) => requireClusterEngine().promoteTrainingRun(payload.id, payload.runId),
  listProjects: () => requireClusterEngine().listProjects().map((project) => ({
    ...project,
    displayStatus: activeRun(project.id) ? 'running' : project.displayStatus,
  })),
  editProject: (payload) => {
    const engine = requireClusterEngine()
    const projectId = String(payload && payload.projectId || '')
    const current = engine.loadProject(projectId)
    const running = activeRun(projectId)
    if (running && (payload.mode != null || payload.workspace != null)) throw new Error('项目运行中只能修改名称、目标和备注；治理策略或工作区请先暂停/结束本轮')
    const patch = {}
    for (const key of ['name', 'goal', 'mode', 'workspace']) {
      if (payload && payload[key] != null) patch[key] = String(payload[key]).trim()
    }
    const saved = engine.saveProject({ ...current, ...patch, id: projectId })
    engine.appendEvent(projectId, {
      type: 'project.updated',
      actor: { id: 'user', name: '你', kind: 'user' },
      text: running ? '项目基本信息已更新；运行中的治理配置保持不变' : '项目基本信息已更新',
      meta: { fields: Object.keys(patch), deferred: Boolean(running) },
    })
    return { ...saved, displayStatus: activeRun(projectId) ? 'running' : engine.getProjectOverview(projectId).project.displayStatus }
  },
  listTrashedProjects: () => requireClusterEngine().listTrashedProjects().map((project) => ({ ...project, displayStatus: 'rest' })),
  archiveProject: (payload) => {
    const projectId = String(payload && payload.projectId || '')
    if (activeRun(projectId)) throw new Error('项目运行中不能归档，请先暂停或取消运行')
    return requireClusterEngine().archiveProject(projectId, payload.archived !== false)
  },
  trashProject: (payload) => {
    const projectId = String(payload && payload.projectId || '')
    if (activeRun(projectId)) throw new Error('项目运行中不能删除，请先取消运行；项目记录会保留在回收站')
    return requireClusterEngine().trashProject(projectId)
  },
  restoreProject: (payload) => requireClusterEngine().restoreProject(String(payload && payload.projectId || '')),
  setProjectImportance: (payload) => requireClusterEngine().setProjectImportance(String(payload && payload.projectId || ''), Number(payload && payload.level)),
  deleteProjectForever: (payload) => {
    const projectId = String(payload && payload.projectId || '')
    if (activeRun(projectId)) throw new Error('运行中的项目不能永久删除')
    return requireClusterEngine().deleteProjectForever(projectId)
  },
  emptyProjectTrash: () => requireClusterEngine().emptyProjectTrash(),
  saveProject: (payload) => requireClusterEngine().saveProject(payload),
  getProjectOverview: (payload) => {
    const overview = requireClusterEngine().getProjectOverview(payload.projectId)
    if (activeRun(payload.projectId)) overview.project.displayStatus = 'running'
    return overview
  },
  listEvents: (payload) => requireClusterEngine().listEvents(payload.projectId, {
    after: payload.after,
    limit: payload.limit,
  }),
  startProject: (payload) => startClusterProject(payload.project || payload),
  sendMessage: (payload) => {
    const engine = requireClusterEngine()
    const projectId = String(payload.projectId || '')
    const text = String(payload.text || '').trim()
    if (!text) throw new Error('消息不能为空')
    const event = engine.appendEvent(projectId, {
      runId: activeRun(projectId) ? activeRun(projectId).runId : '',
      phase: '',
      actor: { id: 'user', name: '你', kind: 'user' },
      type: 'user.message',
      text,
      channel: 'room',
      purpose: 'discussion',
      visibility: 'participants',
      meta: { target: String(payload.target || 'project'), channel: 'room', purpose: 'discussion' },
    })
    const context = activeRun(projectId)
    if (context) context.userMessages.push({ text, target: String(payload.target || 'project'), timestamp: event.timestamp })
    sendClusterEvent({ ...event, eventType: event.type, type: 'message', from: 'user', role: '用户' })
    return event
  },
  respondApproval: (payload) => {
    const context = activeRun(payload.projectId)
    if (!context) throw new Error('项目当前没有运行中的审批')
    const resolve = context.approvals.get(String(payload.approvalId || ''))
    if (!resolve) throw new Error('审批已处理或不存在')
    const status = payload.status === 'approved' ? 'approved' : 'rejected'
    context.approvals.delete(String(payload.approvalId))
    resolve({ status, feedback: String(payload.feedback || '') })
    return { ok: true, status }
  },
  pauseProject: (payload) => {
    const context = activeRun(payload.projectId)
    if (!context) return { ok: false, reason: 'not-running' }
    context.paused = true
    requireClusterEngine().saveProject({ id: context.projectId, status: 'pausing' })
    const event = requireClusterEngine().appendEvent(context.projectId, {
      runId: context.runId,
      actor: { id: 'user', name: '你', kind: 'user' },
      type: 'run.pause-requested',
      text: '将在当前模型响应结束后暂停',
      status: 'pausing',
    })
    sendClusterEvent({ ...event, eventType: event.type, type: 'system', from: 'user', role: '用户' })
    return { ok: true, status: 'pausing' }
  },
  resumeProject: (payload) => {
    const context = activeRun(payload.projectId)
    if (!context) return { ok: false, reason: 'not-running' }
    context.resume()
    requireClusterEngine().saveProject({ id: context.projectId, status: 'active' })
    const event = requireClusterEngine().appendEvent(context.projectId, {
      runId: context.runId,
      actor: { id: 'user', name: '你', kind: 'user' },
      type: 'run.resumed',
      text: '项目已继续运行',
      status: 'active',
    })
    sendClusterEvent({ ...event, eventType: event.type, type: 'system', from: 'user', role: '用户' })
    return { ok: true, status: 'active' }
  },
  cancelProject: (payload) => {
    const context = activeRun(payload.projectId)
    if (!context) return { ok: false, reason: 'not-running' }
    context.finishApprovals('cancelled')
    context.resume()
    context.controller.abort()
    return { ok: true, status: 'cancelling' }
  },
  runtimeCapabilities: () => selectClusterRuntime(HARNESS_DIR, process.env.DPA_CLUSTER_RUNTIME || 'dpa'),
  getRunState: (payload) => {
    const context = activeRun(payload.projectId)
    return context ? {
      running: true,
      runId: context.runId,
      paused: context.paused,
      pendingApprovals: [...context.approvals.keys()],
    } : { running: false }
  },
}

ipcMain.handle('cluster:request', (_event, request) => {
  const method = request && String(request.method || '')
  if (!Object.prototype.hasOwnProperty.call(clusterMethods, method)) throw new Error(`不支持的集群操作：${method}`)
  return clusterMethods[method](request.payload || {})
})

// ── 通知 ──────────────────────────────────────────────────────────────────
// 能力生态控制面：主题、Skill 市场和 Harness 插件清单共用一个受限入口。
const capabilityMethods = {
  state: async (payload) => ({
    capabilities: capabilityRegistry.capabilities(),
    appearance: capabilityRegistry.themeState(),
    skills: capabilityRegistry.listSkills(payload || {}),
    plugins: capabilityRegistry.listPlugins(),
    github: await githubAuth.status(),
    backups: capabilityRegistry.listExtensionBackups(),
  }),
  themeState: () => capabilityRegistry.themeState(),
  setTheme: (payload) => capabilityRegistry.setTheme(payload && payload.themeId),
  setTypography: (payload) => {
    const appearanceState = capabilityRegistry.setTypography(payload || {})
    applyWindowZoom(appearanceState)
    return appearanceState
  },
  chooseBackgroundImage: async (payload) => {
    const options = {
      title: '选择 DPA 背景图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }],
    }
    const result = mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return { cancelled: true, appearance: capabilityRegistry.themeState() }
    return { cancelled: false, appearance: capabilityRegistry.setBackground({ ...(payload || {}), sourcePath: result.filePaths[0], enabled: true }) }
  },
  setBackground: (payload) => capabilityRegistry.setBackground(payload || {}),
  removeBackground: () => capabilityRegistry.removeBackground(),
  chooseThemeFile: async () => {
    const options = {
      title: '导入 DPA、DSH 或 VS Code 主题',
      properties: ['openFile'],
      filters: [{ name: '主题 JSON', extensions: ['json'] }],
    }
    const result = mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return { cancelled: true, appearance: capabilityRegistry.themeState() }
    return { cancelled: false, appearance: capabilityRegistry.importTheme({ sourcePath: result.filePaths[0], activate: true }) }
  },
  saveTheme: (payload) => capabilityRegistry.saveTheme(payload || {}),
  importTheme: (payload) => capabilityRegistry.importTheme(payload || {}),
  removeTheme: (payload) => capabilityRegistry.removeTheme(payload && payload.themeId),
  exportTheme: (payload) => capabilityRegistry.exportTheme(payload && payload.themeId, payload && payload.destination),
  listSkills: (payload) => capabilityRegistry.listSkills(payload || {}),
  installSkill: (payload) => capabilityRegistry.installSkill(payload || {}),
  uninstallSkill: (payload) => capabilityRegistry.uninstallSkill(payload && payload.id),
  listPlugins: () => capabilityRegistry.listPlugins(),
  searchExtensions: (payload) => capabilityRegistry.searchExtensions(payload || {}),
  preflightExtension: (payload) => capabilityRegistry.preflightExtension(payload || {}),
  mutatePlugin: (payload) => capabilityRegistry.mutatePlugin(payload || {}),
  preflightRemoteSkill: (payload) => capabilityRegistry.preflightRemoteSkill(payload || {}),
  installRemoteSkill: (payload) => capabilityRegistry.installRemoteSkill(payload || {}),
  listExtensionBackups: () => capabilityRegistry.listExtensionBackups(),
  restoreExtensionBackup: (payload) => capabilityRegistry.restoreExtensionBackup(payload || {}),
  githubStatus: () => githubAuth.status(),
  githubStartLogin: async () => {
    const flow = await githubAuth.startDeviceFlow()
    if (flow.verificationUri) await shell.openExternal(flow.verificationUri)
    return flow
  },
  githubPollLogin: (payload) => githubAuth.pollDeviceFlow(payload || {}),
  githubDisconnect: () => githubAuth.disconnect(),
  openExternal: async (payload) => {
    const url = new URL(String(payload && payload.url || ''))
    if (url.protocol !== 'https:' || !['github.com', 'www.github.com'].includes(url.hostname)) throw new Error('只允许打开 GitHub HTTPS 链接')
    await shell.openExternal(url.toString())
    return { ok: true }
  },
  capabilities: () => capabilityRegistry.capabilities(),
}

ipcMain.handle('capability:request', (_event, request) => {
  const method = request && String(request.method || '')
  if (!Object.prototype.hasOwnProperty.call(capabilityMethods, method)) throw new Error(`不支持的能力生态操作：${method}`)
  return capabilityMethods[method](request.payload || {})
})

function notify(title, body) {
  try {
    if (Notification.isSupported()) {
      new Notification({ title, body, silent: false }).show()
    }
  } catch (_) { /* 忽略通知失败 */ }
}

function sendUpdateState(state) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try { mainWindow.webContents.send('dsh:update-state', state) } catch (_) {}
}

function localDshStatus() {
  try {
    return {
      status: 'idle',
      harnessDir: HARNESS_DIR,
      currentVersion: readPackageVersion(HARNESS_DIR),
    }
  } catch (error) {
    return { status: 'error', harnessDir: HARNESS_DIR, error: error.message || String(error) }
  }
}

async function refreshDshClientCache(force = false) {
  const markerPath = path.join(DATA_DIR, 'dsh-runtime-version.txt')
  let version = 'unknown'
  try { version = readPackageVersion(HARNESS_DIR) } catch (_) {}
  let previous = ''
  try { previous = fs.readFileSync(markerPath, 'utf8').trim() } catch (_) {}
  if (!force && previous === version) return false
  await session.defaultSession.clearCache()
  await session.defaultSession.clearStorageData({
    origin: new URL(SERVER_URL).origin,
    storages: ['serviceworkers', 'cachestorage'],
  }).catch(() => {})
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(markerPath, version, 'utf8')
  return true
}

async function installDshUpdate(checkResult) {
  if (updateInstallPromise) return updateInstallPromise
  updateInstallPromise = (async () => {
    sendUpdateState({ status: 'installing', message: '正在准备更新…', ...checkResult })
    await stopServer()
    if (await isUp(1000)) throw new Error('3080 端口仍被外部 DSH 占用，请先关闭它再更新')
    const result = await dshUpdater.apply(checkResult.latestTag, (progress) => {
      if (progress && progress.message) {
        sendUpdateState({ status: 'installing', message: progress.message, phase: progress.phase || '' })
      }
    })
    await refreshDshClientCache(true)
    ensureServer()
    if (!(await waitUntilUp())) throw new Error('新版 DSH 已安装，但重启服务失败：' + serverErrorTail)
    sendUpdateState({
      status: 'complete',
      currentVersion: result.after.version,
      message: '更新完成',
      backupBranch: result.backupBranch,
    })
    if (mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadFile('shell.html')
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'DSH 更新完成',
      message: 'DSH 已更新到 ' + result.after.version,
      detail: 'DPA 已清理旧版网页缓存并重启本地服务。\n回退分支：' + result.backupBranch,
    })
    return result
  })().catch(async (error) => {
    sendUpdateState({ status: 'error', error: error.message || String(error) })
    if (!(await isUp(1000))) ensureServer()
    dialog.showErrorBox('DSH 更新失败', error.message || String(error))
    throw error
  }).finally(() => {
    updateInstallPromise = null
  })
  return updateInstallPromise
}

async function checkDshUpdates(options = {}) {
  if (updateCheckPromise) return updateCheckPromise
  const interactive = Boolean(options.interactive)
  updateCheckPromise = (async () => {
    sendUpdateState({ status: 'checking', message: '正在检查 DSH 更新…' })
    const result = await dshUpdater.check()
    sendUpdateState({ status: result.updateAvailable ? 'available' : 'current', ...result })
    if (!result.updateAvailable) {
      if (interactive) {
        await dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'DSH 更新',
          message: '当前已经是最新版',
          detail: '已安装：' + result.version + '\n运行时：' + HARNESS_DIR,
        })
      }
      return result
    }
    const answer = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '发现 DSH 更新',
      message: '发现新版 DSH ' + result.latestVersion,
      detail: '当前版本：' + result.version + '\n更新前会建立 Git 回退分支；员工、项目和会话数据不会被改动。',
      buttons: ['立即更新', '稍后'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    if (answer.response === 0) await installDshUpdate(result)
    return result
  })().catch((error) => {
    sendUpdateState({ status: 'error', error: error.message || String(error) })
    if (interactive) dialog.showErrorBox('检查 DSH 更新失败', error.message || String(error))
    throw error
  }).finally(() => {
    updateCheckPromise = null
  })
  return updateCheckPromise
}

ipcMain.handle('dsh:update-status', () => localDshStatus())
ipcMain.handle('dsh:update-check', () => checkDshUpdates({ interactive: true }))
ipcMain.handle('dsh:update-install', async (_event, payload) => {
  const checkResult = payload && payload.latestTag ? payload : await dshUpdater.check()
  return installDshUpdate(checkResult)
})
// ── 服务管理 ──────────────────────────────────────────────────────────────
function isUp(timeoutMs = 3000) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok) => {
      if (!settled) { settled = true; resolve(ok) }
    }
    const req = http.get(SERVER_URL, { timeout: timeoutMs }, (res) => {
      res.resume()
      finish(res.statusCode >= 200 && res.statusCode < 500)
    })
    req.on('timeout', () => { req.destroy(); finish(false) })
    req.on('error', () => finish(false))
  })
}

async function waitUntilUp() {
  const start = Date.now()
  while (Date.now() - start < STARTUP_TIMEOUT_MS) {
    if (await isUp()) {
      serverRestartAttempts = 0
      return true
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  const ready = await isUp()
  if (ready) serverRestartAttempts = 0
  return ready
}

function appendServerError(chunk) {
  serverErrorTail = (serverErrorTail + chunk.toString()).slice(-8000)
}

function serverLaunchArgs() {
  const target = new URL(SERVER_URL)
  const host = target.hostname
  const port = Number(target.port || 80)
  if (!/^[0-9A-Za-z.:-]+$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('无效的 DSH 本地服务地址：' + SERVER_URL)
  }
  return ['/d', '/s', '/c', 'pnpm.cmd', 'dsh', 'web', '--no-open', '--host', host, '--port', String(port)]
}

function ensureServer() {
  if (serverProcess) return
  if (!isHarnessRuntime(HARNESS_DIR)) throw new Error('DPA 托管 DSH 运行时不存在：' + HARNESS_DIR)
  serverStopRequested = false
  serverErrorTail = ''
  const launched = spawn(process.env.ComSpec || 'cmd.exe', serverLaunchArgs(), {
    cwd: HARNESS_DIR,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DSH_HOME: DSH_HOME_DIR },
  })
  serverProcess = launched
  launched.stdout.on('data', appendServerError)
  launched.stderr.on('data', appendServerError)
  launched.on('exit', (code) => {
    if (serverProcess === launched) serverProcess = null
    if (!serverStopRequested && code) {
      const message = serverErrorTail || ('DSH 服务退出码：' + code)
      writeDiagnostic('server-exit', message, { code })
      sendUpdateState({ status: 'server-error', error: message })
      if (!isQuitting && serverRestartAttempts < 2) {
        const attempt = ++serverRestartAttempts
        clearTimeout(serverRestartTimer)
        serverRestartTimer = setTimeout(() => {
          serverRestartTimer = null
          if (serverProcess || serverStopRequested || isQuitting) return
          try { ensureServer() } catch (error) { writeDiagnostic('server-restart-failed', error) }
        }, Math.min(3000 * attempt, 10000))
      }
    }
  })
  launched.on('error', (error) => {
    appendServerError(error.message || String(error))
    if (serverProcess === launched) serverProcess = null
  })
}

function stopServerSync() {
  const target = serverProcess
  serverStopRequested = true
  clearTimeout(serverRestartTimer)
  serverRestartTimer = null
  serverProcess = null
  if (!target || !target.pid || target.exitCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(target.pid), '/T', '/F'], { windowsHide: true })
  } else {
    try { target.kill('SIGTERM') } catch (_) {}
  }
}

async function stopServer() {
  stopServerSync()
  const start = Date.now()
  while (Date.now() - start < 15000) {
    if (!(await isUp(500))) return true
    await new Promise((resolve) => setTimeout(resolve, 350))
  }
  return !(await isUp(500))
}

function buildMenu() {
  const template = [
    {
      label: '视图',
      submenu: [
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', click: () => mainWindow && mainWindow.webContents.reload() },
        { label: '开发者工具', accelerator: 'F12', click: () => mainWindow && mainWindow.webContents.toggleDevTools() },
        { type: 'separator' },
        { label: '在浏览器中打开', click: () => shell.openExternal(SERVER_URL) },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '检查 DSH 更新…', click: () => checkDshUpdates({ interactive: true }).catch(() => {}) },
        { label: '打开 DSH 运行时目录', click: () => shell.openPath(HARNESS_DIR) },
        { type: 'separator' },
        {
          label: '关于 DeepSeek-PA',
          click: () => dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: '关于',
            message: 'DeepSeek-PA (DPA)',
            detail: '基于 DeepSeek Harness 的 Windows 桌面端。\n架构不变：万物皆插件（Cordis）。\n本地服务：' + SERVER_URL +
              '\nDSH 版本：' + (() => { try { return readPackageVersion(HARNESS_DIR) } catch (_) { return '未安装' } })() +
              '\nDSH 运行时：' + HARNESS_DIR +
              '\n\n全局快捷键唤起：' + HOTKEY.replace('CommandOrControl', 'Ctrl'),
          }),
        },
      ],
    },
  ]
  return Menu.buildFromTemplate(template)
}

// ── 窗口 ──────────────────────────────────────────────────────────────────
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    title: 'DeepSeek-PA',
    backgroundColor: '#0d1117',
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  })

  applyWindowZoom(capabilityRegistry.themeState())
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => { mainWindow = null })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    writeDiagnostic('renderer-process-gone', details && details.reason, details)
    if (isQuitting || !mainWindow || mainWindow.isDestroyed()) return
    rendererRecoveryAttempts += 1
    clearTimeout(rendererRecoveryTimer)
    if (rendererRecoveryAttempts > 2) {
      dialog.showErrorBox('DeepSeek-PA', '界面进程异常退出，已停止自动重试以避免循环崩溃。请重新启动 DPA。')
      return
    }
    rendererRecoveryTimer = setTimeout(() => {
      rendererRecoveryTimer = null
      if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) mainWindow.reload().catch((error) => writeDiagnostic('renderer-reload-failed', error))
    }, 1200)
    setTimeout(() => { rendererRecoveryAttempts = 0 }, 30000)
  })

  // 关闭窗口 → 隐藏到托盘（托盘常驻），除非真正退出
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow.hide()
      notify('DeepSeek-PA 仍在后台运行', '点击托盘图标可重新打开；需要完全退出请从托盘菜单选择「退出」。')
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const target = new URL(url)
      const base = new URL(SERVER_URL)
      if (target.origin !== base.origin) {
        event.preventDefault()
        shell.openExternal(url)
      }
    } catch (_) { event.preventDefault() }
  })

  mainWindow.webContents.on('did-fail-load', () => {
    if (loadingPhase && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.loadFile('loading.html').catch(() => {})
    }
  })

  Menu.setApplicationMenu(buildMenu())

  await mainWindow.loadFile('loading.html')
  mainWindow.show()

  if (!(await isUp())) ensureServer()
  const ok = await waitUntilUp()
  if (!ok) {
    dialog.showErrorBox(
      'DeepSeek-PA',
      '3 分钟内未能连上本地服务：\n' + SERVER_URL +
        '\n\nDSH 运行时：' + HARNESS_DIR +
        (serverErrorTail ? '\n\n最近的启动日志：\n' + serverErrorTail.slice(-3000) : '')
    )
    return
  }

  await refreshDshClientCache()
  loadingPhase = false
  if (mainWindow && !mainWindow.isDestroyed()) {
    // 加载带顶部模式切换的 shell（Agent / Chat），Agent 内嵌 dsh 本地服务
    await mainWindow.loadFile('shell.html')
    // 把 Codex 主题 CSS 注入 shell 页面，供 webview 加载 Agent 页时使用
    try {
      const css = fs.readFileSync(path.join(__dirname, 'codex-theme.css'), 'utf8')
      await mainWindow.webContents.executeJavaScript('window.__codexCSS = ' + JSON.stringify(css))
    } catch (_) { /* 注入失败不影响主功能 */ }
  }
}

// ── 启动 ──────────────────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('child-process-gone', (_event, details) => {
    writeDiagnostic('child-process-gone', details && details.reason, details)
  })
  app.on('gpu-process-crashed', (_event, killed) => {
    writeDiagnostic('gpu-process-crashed', killed ? 'killed' : 'crashed')
  })
  app.on('second-instance', () => showMainWindow())

  app.whenReady().then(() => {
    // 开机自启（默认开启）
    if (!app.getLoginItemSettings().openAtLogin) {
      app.setLoginItemSettings({ openAtLogin: true })
    }

    createWindow().then(() => {
      setTimeout(() => checkDshUpdates({ interactive: false }).catch(() => {}), 8000)
    }).catch((error) => {
      dialog.showErrorBox('DeepSeek-PA', '启动失败：' + (error && error.message ? error.message : String(error)))
    })

    // 全局快捷键唤起/隐藏
    globalShortcut.register(HOTKEY, () => {
      if (mainWindow && mainWindow.isVisible()) mainWindow.hide()
      else showMainWindow()
    })

    // 托盘常驻
    createTray()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow().catch(() => {})
      else showMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    // 托盘常驻：不退出，除非 isQuitting
    if (!isQuitting) return
    app.quit()
  })

  app.on('will-quit', () => {
    stopServerSync()
    globalShortcut.unregisterAll()
  })
}
