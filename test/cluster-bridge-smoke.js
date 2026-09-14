'use strict'

const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('node:assert/strict')
const sourceRoot = path.resolve(__dirname, '..')
const appRoot = process.env.DPA_SMOKE_APP_ROOT ? path.resolve(process.env.DPA_SMOKE_APP_ROOT) : sourceRoot
const { BUILTIN_THEMES, DEFAULT_TYPOGRAPHY, typographyCss } = require(path.join(appRoot, 'appearance-service.js'))

const temporaryData = fs.mkdtempSync(path.join(os.tmpdir(), 'dpa-bridge-smoke-'))
const { createExtensionMarket } = require(path.join(appRoot, 'extension-market.js'))
const githubCalls = []
const market = createExtensionMarket({
  dataDir: path.join(temporaryData, 'data'), dshHome: path.join(temporaryData, 'home'), harnessDir: temporaryData,
  githubRequester: async pathname => {
    const params = new URL('https://api.github.com' + pathname).searchParams
    githubCalls.push(Object.fromEntries(params))
    const page = Number(params.get('page')); const perPage = Number(params.get('per_page'))
    const total = 75; const offset = (page - 1) * perPage
    return { total_count: total, incomplete_results: false, items: Array.from({ length: Math.max(0, Math.min(perPage, total - offset)) }, (_, i) => ({
      name: 'demo-' + (offset + i + 1), full_name: 'demo/demo-' + (offset + i + 1), owner: { login: 'demo' },
      description: '用于分页验收的示例仓库', html_url: 'https://github.com/demo/demo-' + (offset + i + 1), topics: [], stargazers_count: 75 - offset - i,
    })) }
  },
})
app.setPath('userData', temporaryData)
app.disableHardwareAcceleration()

const project = {
  id: 'bridge-project', name: '桥接测试项目', goal: '验证本地 iframe 与主进程通信',
  mode: 'hierarchy', status: 'draft', phase: 'draft',
  members: [{ agent: 'tester', name: '测试员', role: '测试负责人', rank: 1 }],
}
const calls = []
let running = false
let startAttempts = 0
const events = [
  { seq: 1, id: 'user-1', projectId: project.id, type: 'user.message', channel: 'room', actor: { id: 'user', kind: 'user' }, text: '请完成一个演示项目。' },
  { seq: 2, id: 'work-1', projectId: project.id, type: 'agent.message.completed', channel: 'worklog', actor: { id: 'tester' }, text: 'INTERNAL_TRACE_NOT_FOR_ROOM' },
]
const errors = []
const deadline = setTimeout(() => { console.error('Desktop acceptance timed out'); app.exit(1) }, 45000)

const appearance = { themeId:'midnight', theme:BUILTIN_THEMES[0], themes:BUILTIN_THEMES, typography:typographyCss(DEFAULT_TYPOGRAPHY), background:{ enabled:false, dataUrl:'', fit:'cover', position:'center', opacity:.28, blur:0, overlay:.42 } }
ipcMain.handle('capability:request', (_event, request) => {
  if (request.method === 'themeState') return appearance
  if (request.method === 'state') return {
    capabilities:{ agentTeam:{ supported:true }, plugins:{ writable:true } }, appearance,
    skills:[], plugins:[], github:{ connected:false, configured:false }, backups:[],
  }
  if (request.method === 'searchExtensions') return market.search(request.payload)
  throw new Error(`能力烟测未实现：${request.method}`)
})
ipcMain.handle('dsh:update-status', () => ({ status:'current', currentVersion:'smoke' }))
ipcMain.handle('dsh:authenticated-url', () => null)

ipcMain.handle('cluster:request', async (_event, request) => {
  calls.push(request.method)
  if (request.method === 'listAgents') return [{ id: 'tester', name: '测试员', description: '验证桥接', source: 'dpa' }]
  if (request.method === 'listSkills') return { skills: [{ name: 'code-review', description: '审查代码', source: '测试' }], roots: [] }
  if (request.method === 'listProjects') return [project]
  if (request.method === 'getProjectOverview') return { project, tasks: [], approvals: [], artifacts: [], decisions: [], lastEventSeq: 2 }
  if (request.method === 'listEvents') return events.filter(e => e.seq > Number(request.payload && request.payload.after || 0))
  if (request.method === 'getRunState') return { running, runId: running ? 'acceptance-run' : '' }
  if (request.method === 'startProject') {
    startAttempts += 1
    await new Promise(resolve => setTimeout(resolve, 100))
    if (startAttempts === 1) throw new Error('验收模拟：模型凭据尚未配置')
    running = true; project.status = 'active'; project.phase = 'discussion'; project.displayStatus = 'running'; project.lastError = ''
    return { started: true, runId: 'acceptance-run' }
  }
  throw new Error(`冒烟测试未实现：${request.method}`)
})

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1200,
    height: 760,
    show: false,
    webPreferences: {
      preload: path.join(appRoot, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  })
  window.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3 && !/ERR_|network|Content.Security.Policy|Failed to load resource/i.test(message)) errors.push(message)
  })
  await window.loadFile(path.join(appRoot, 'shell.html'))
  await window.webContents.executeJavaScript(`
    switchTo('cluster');
    new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        const frame = document.getElementById('cluster');
        const doc = frame && frame.contentDocument;
        if (doc && doc.getElementById('room-name') && doc.getElementById('room-name').textContent === '桥接测试项目') return resolve(true);
        if (Date.now() - started > 7000) return reject(new Error('cluster iframe 初始化超时'));
        setTimeout(check, 80);
      };
      check();
    });
  `)
  const result = await window.webContents.executeJavaScript(`(() => {
    const frame = document.getElementById('cluster');
    const doc = frame.contentDocument;
    const resizer = doc.getElementById('project-sidebar-resizer');
    const before = frame.contentWindow.getComputedStyle(doc.documentElement).getPropertyValue('--project-sidebar-width').trim();
    resizer.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const after = frame.contentWindow.getComputedStyle(doc.documentElement).getPropertyValue('--project-sidebar-width').trim();
    const layoutSaved = Boolean(frame.contentWindow.localStorage.getItem('dpa.cluster.layout.v1'));
    const menuTrigger = doc.querySelector('.project-menu-trigger');
    menuTrigger.click();
    const contextMenu = doc.getElementById('project-context-menu');
    return {
      roomName: doc.getElementById('room-name').textContent,
      employeeCards: doc.querySelectorAll('.employee-card').length,
      projectItems: doc.querySelectorAll('.project-item').length,
      projectVisible: !doc.getElementById('project-room').classList.contains('hidden'),
      resizers: doc.querySelectorAll('[role=separator].column-resizer').length,
      sidebarBefore: before,
      sidebarAfter: after,
      layoutSaved,
      importanceBadge: doc.querySelector('.project-importance').getAttribute('aria-label'),
      contextMenuItems: contextMenu.querySelectorAll('[role=menuitem],[role=menuitemradio]').length,
      deleteAction: Array.from(contextMenu.querySelectorAll('button')).some((button) => button.textContent.includes('移入回收站')),
    };
  })()`)
  const launchFailure = await window.webContents.executeJavaScript(`(async () => {
    const frame = document.getElementById('cluster').contentWindow;
    frame.document.getElementById('run-start').click();
    frame.document.getElementById('run-start').click();
    const started = Date.now();
    while (Date.now() - started < 5000) {
      const banner = frame.document.getElementById('run-feedback');
      if (banner && banner.textContent.includes('验收模拟') && !frame.document.getElementById('run-start').disabled) {
        return { error: banner.textContent, chat: frame.document.getElementById('feed').textContent };
      }
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error('启动失败未出现持久反馈或按钮未恢复');
  })()`)
  assert.equal(startAttempts, 1, '重复点击不得并发启动同一项目')
  assert.match(launchFailure.error, /模型凭据尚未配置/)
  assert.doesNotMatch(launchFailure.chat, /验收模拟|INTERNAL_TRACE_NOT_FOR_ROOM/)
  const retried = await window.webContents.executeJavaScript(`(async () => {
    const frame = document.getElementById('cluster').contentWindow;
    frame.document.getElementById('run-start').click();
    const started = Date.now();
    while (Date.now() - started < 5000) {
      const status = frame.document.getElementById('room-status').textContent;
      if (status === '运行中') return status;
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error('重试没有进入运行中');
  })()`)
  assert.equal(startAttempts, 2)
  assert.equal(retried, '运行中')
  result.launch = { duplicatePrevented: true, visibleFailure: true, retryRunning: true, roomTraceHidden: true }
  await window.webContents.executeJavaScript(`
    switchTo('capabilities');
    new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        const frame = document.getElementById('capabilities');
        const doc = frame && frame.contentDocument;
        if (doc && doc.getElementById('background-preview') && doc.querySelectorAll('.theme-card').length) return resolve(true);
        if (Date.now() - started > 7000) return reject(new Error('capabilities iframe 初始化超时'));
        setTimeout(check, 80);
      };
      check();
    });
  `)
  result.capabilities = await window.webContents.executeJavaScript(`(() => {
    const doc = document.getElementById('capabilities').contentDocument;
    return {
      themeCards: doc.querySelectorAll('.theme-card').length,
      backgroundControls: Boolean(doc.getElementById('choose-background') && doc.getElementById('save-background')),
      themeFileImport: Boolean(doc.getElementById('import-theme-file')),
      githubControl: Boolean(doc.getElementById('github-account')),
    };
  })()`)
  result.methods = [...new Set(calls)]
  result.pagination = await window.webContents.executeJavaScript(`(async () => {
    const frame = document.getElementById('capabilities').contentWindow;
    const doc = frame.document;
    const ready = async (text) => {
      const started = Date.now();
      while (Date.now() - started < 5000) {
        if (doc.getElementById('market-page-label').textContent.includes(text) && doc.getElementById('extension-grid').getAttribute('aria-busy') === 'false') return;
        await new Promise(r => setTimeout(r, 40));
      }
      throw new Error('分页没有切换到 ' + text);
    };
    await ready('1 / 3');
    const first = doc.getElementById('extension-grid').textContent;
    doc.getElementById('market-next').click(); await ready('2 / 3');
    const second = doc.getElementById('extension-grid').textContent;
    doc.getElementById('market-page-input').value = '3'; doc.getElementById('market-page-go').click(); await ready('3 / 3');
    const last = doc.getElementById('extension-grid').textContent;
    const disabledAtEnd = doc.getElementById('market-next').disabled;
    doc.getElementById('market-page-size').value = '60'; doc.getElementById('market-page-size').dispatchEvent(new frame.Event('change')); await ready('1 / 2');
    return { firstHas1: first.includes('demo-1'), secondHas31: second.includes('demo-31'), lastHas75: last.includes('demo-75'), disabledAtEnd, summary: doc.getElementById('market-result-summary').textContent };
  })()`)
  assert.equal(result.pagination.firstHas1, true)
  assert.equal(result.pagination.secondHas31, true)
  assert.equal(result.pagination.lastHas75, true)
  assert.equal(result.pagination.disabledAtEnd, true)
  assert.match(result.pagination.summary, /75.*1–60/)
  assert.ok(githubCalls.every(c => c.q === 'deepseek-harness'), 'GitHub 查询不可追加隐藏关键词')
  assert.equal(result.roomName, '桥接测试项目')
  assert.equal(result.projectVisible, true)
  assert.equal(result.projectItems, 1)
  assert.equal(result.resizers, 3)
  assert.notEqual(result.sidebarBefore, result.sidebarAfter)
  assert.equal(result.layoutSaved, true)
  assert.equal(result.deleteAction, true)
  assert.equal(result.capabilities.themeCards, BUILTIN_THEMES.length)
  assert.equal(result.capabilities.githubControl, true)
  assert.equal(result.capabilities.backgroundControls, true)
  assert.equal(result.capabilities.themeFileImport, true)
  result.themes = []
  for (const theme of BUILTIN_THEMES) {
    const view = { ...appearance, theme, themeId: theme.id }
    const observation = await window.webContents.executeJavaScript(`(() => {
      const cluster = document.getElementById('cluster').contentWindow;
      const market = document.getElementById('capabilities').contentWindow;
      cluster.applyClusterAppearance(${JSON.stringify(view)});
      market.applyAppearance(${JSON.stringify(view)}, false);
      const cs = cluster.getComputedStyle(cluster.document.documentElement);
      const ms = market.getComputedStyle(market.document.documentElement);
      return { clusterBackground: cs.getPropertyValue('--bg').trim(), marketBackground: ms.getPropertyValue('--bg').trim(), font: cs.getPropertyValue('--ui-font-family').trim() };
    })()`)
    assert.equal(observation.clusterBackground.toLowerCase(), theme.tokens.background.toLowerCase())
    assert.equal(observation.marketBackground.toLowerCase(), theme.tokens.background.toLowerCase())
    assert.ok(observation.font)
    result.themes.push(theme.id)
  }
  result.frameIsolation = await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const frame = document.getElementById('cluster');
    let leakedType = '';
    const onMessage = (event) => {
      if (event.source === frame.contentWindow && event.data && event.data.type === 'dpa:test-leak') leakedType = event.data.leakedType || 'unknown';
    };
    window.addEventListener('message', onMessage);
    const timer = setTimeout(() => { window.removeEventListener('message', onMessage); reject(new Error('恶意 frame 隔离探针超时')); }, 3000);
    frame.addEventListener('load', () => {
      applyDpaAppearance(currentAppearance);
      setTimeout(() => {
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        resolve({ leakedType });
      }, 250);
    }, { once:true });
    const attackerHtml = '<!doctype html><script>addEventListener("message",function(event){parent.postMessage({type:"dpa:test-leak",leakedType:event.data&&event.data.type},"file://")});parent.postMessage({type:"cluster:request",id:"forged-frame",method:"forgedSecurityProbe",payload:{}},"file://")<\\/script>';
    frame.src = 'data:text/html;charset=utf-8,' + encodeURIComponent(attackerHtml);
  })`)
  assert.equal(result.frameIsolation.leakedType, '', '外壳不得向已导航到不可信源的 frame 泄露主题或项目数据')
  assert.equal(calls.includes('forgedSecurityProbe'), false, '已导航到不可信源的 frame 不得调用特权集群 API')
  result.rendererErrors = errors
  assert.deepEqual(errors, [])
  console.log(JSON.stringify(result))
  clearTimeout(deadline)
  window.destroy()
  app.quit()
}).catch((error) => {
  console.error(error.stack || error)
  app.exit(1)
})

app.on('quit', () => {
  try { fs.rmSync(temporaryData, { recursive: true, force: true }) } catch (_) {}
})
