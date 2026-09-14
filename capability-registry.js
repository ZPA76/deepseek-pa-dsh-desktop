'use strict'

// DPA 扩展中心控制面：应用级主题、Skill 生命周期与 Harness 插件市场。
// 扩展执行仍由 Harness/Cordis 负责；这里负责校验、快照、安装编排和回滚。
const fs = require('fs')
const path = require('path')
const { resolveDpaPaths } = require('./dpa-paths')
const { BUILTIN_THEMES, createAppearanceService } = require('./appearance-service.js')
const { createExtensionMarket } = require('./extension-market.js')

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (_) { return fallback }
}

function safeId(value) {
  const id = String(value || '').trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id)) throw new Error('能力 ID 格式不正确')
  return id
}

function parseSkillFile(file, source, installed = false) {
  let text
  try { text = fs.readFileSync(file, 'utf8') } catch (_) { return null }
  const frontmatter = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n/)
  const fields = {}
  if (frontmatter) {
    for (const line of frontmatter[1].split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/)
      if (match) fields[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
    }
  }
  const name = fields.name || path.basename(path.dirname(file))
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return null
  return {
    id: name, name, description: fields.description || '未提供 Skill 简介',
    version: fields.version || 'local', author: fields.author || '本地', source,
    sourcePath: path.dirname(file), installed, kind: 'skill', bodyPreview: text.slice(0, 1200),
  }
}

function scanSkillRoots(roots) {
  const result = []
  for (const rootInfo of roots) {
    const root = rootInfo.path
    if (!fs.existsSync(root)) continue
    let entries = []
    try { entries = fs.readdirSync(root, { withFileTypes: true }) } catch (_) { continue }
    for (const entry of entries) {
      const candidate = path.join(root, entry.name)
      const skill = entry.isDirectory()
        ? parseSkillFile(path.join(candidate, 'SKILL.md'), rootInfo.label, rootInfo.installed)
        : (entry.isFile() && entry.name.toLowerCase().endsWith('.md') ? parseSkillFile(candidate, rootInfo.label, rootInfo.installed) : null)
      if (skill) result.push(skill)
    }
  }
  return result
}

function copyTree(source, target) {
  const stat = fs.statSync(source)
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true })
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      copyTree(path.join(source, entry.name), path.join(target, entry.name))
    }
  } else if (stat.isFile()) {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(source, target)
  }
}

function createCapabilityRegistry(options = {}) {
  const { dataDir, dshHome, harnessDir } = resolveDpaPaths(options)
  const marketDir = path.join(dataDir, 'market')
  const managedSkillRoot = path.join(dshHome, 'skills', 'dpa-market')
  const appearance = createAppearanceService({ dataDir })
  const market = createExtensionMarket({ dataDir, dshHome, harnessDir, githubAuth: options.githubAuth, pnpmCommand: options.pnpmCommand, githubRequester: options.githubRequester })

  function listSkills(query = {}) {
    const roots = [
      { label: '项目 .dsh/skills', path: path.join(path.resolve(query.projectRoot || process.cwd()), '.dsh', 'skills'), installed: false },
      { label: '项目 .agents/skills', path: path.join(path.resolve(query.projectRoot || process.cwd()), '.agents', 'skills'), installed: false },
      { label: 'DPA 用户 Skill', path: path.join(dshHome, 'skills'), installed: false },
      { label: 'DPA 市场安装', path: managedSkillRoot, installed: true },
    ]
    const local = scanSkillRoots(roots)
    const catalog = readJson(path.join(marketDir, 'skills.json'), [])
    const all = [...local, ...(Array.isArray(catalog) ? catalog.map((item) => ({ ...item, kind: 'skill', installed: Boolean(item.installed) })) : [])]
    const dedup = new Map()
    for (const item of all) if (!dedup.has(item.id)) dedup.set(item.id, item)
    const q = String(query.query || '').trim().toLowerCase()
    return [...dedup.values()].filter((item) => !q || `${item.name} ${item.description} ${item.author}`.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name))
  }

  function installSkill(payload = {}) {
    const id = safeId(payload.id || payload.name)
    const sourcePath = path.resolve(String(payload.sourcePath || ''))
    if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error('Skill 来源目录不存在')
    const skillFile = fs.statSync(sourcePath).isDirectory() ? path.join(sourcePath, 'SKILL.md') : sourcePath
    if (!fs.existsSync(skillFile)) throw new Error('Skill 必须包含 SKILL.md')
    const parsed = parseSkillFile(skillFile, '用户导入', true)
    if (!parsed || parsed.id !== id) throw new Error('Skill 名称与市场条目不一致')
    const sourceRoot = fs.statSync(sourcePath).isDirectory() ? sourcePath : path.dirname(sourcePath)
    const target = path.join(managedSkillRoot, id)
    if (!path.resolve(target).startsWith(`${path.resolve(managedSkillRoot)}${path.sep}`)) throw new Error('Skill 安装路径超出管理目录')
    if (path.resolve(target) === path.resolve(sourceRoot)) throw new Error('不能把 Skill 安装到自身目录')
    if (fs.existsSync(target) && !payload.overwrite) throw new Error('Skill 已安装；如需覆盖请明确选择更新')
    const backup = fs.existsSync(target) ? `${target}.backup-${Date.now()}` : ''
    if (backup) fs.renameSync(target, backup)
    try {
      copyTree(sourceRoot, target)
      const installed = parseSkillFile(path.join(target, 'SKILL.md'), 'DPA 市场安装', true)
      if (!installed) throw new Error('安装后的 Skill 校验失败')
      if (backup) fs.rmSync(backup, { recursive: true, force: true })
      return installed
    } catch (error) {
      if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true })
      if (backup && fs.existsSync(backup)) fs.renameSync(backup, target)
      throw error
    }
  }

  async function installRemoteSkill(payload = {}) {
    const downloaded = await market.downloadSkill(payload)
    if (downloaded.requiresConfirmation) return downloaded
    try {
      const installed = installSkill({ id:downloaded.id, sourcePath:downloaded.sourcePath, overwrite:Boolean(payload.overwrite) })
      return { ok:true, installed, source:{ repo:downloaded.repo, ref:downloaded.ref, skillPath:downloaded.skillPath }, fileCount:downloaded.fileCount, totalBytes:downloaded.totalBytes }
    } finally {
      market.cleanupSkillDownload(downloaded.sourcePath)
    }
  }

  function uninstallSkill(idValue) {
    const id = safeId(idValue)
    const target = path.join(managedSkillRoot, id)
    if (!path.resolve(target).startsWith(`${path.resolve(managedSkillRoot)}${path.sep}`)) throw new Error('Skill 卸载路径超出管理目录')
    if (!fs.existsSync(target)) throw new Error('该 Skill 不在 DPA 市场安装目录')
    const trash = path.join(dataDir, 'skill-trash', `${id}-${Date.now()}`)
    fs.mkdirSync(path.dirname(trash), { recursive: true })
    fs.renameSync(target, trash)
    return { ok: true, id, recoverable: true, trash }
  }

  function capabilities() {
    const appearanceState = appearance.state()
    return {
      themes: { count: appearanceState.themes.length, custom: appearanceState.customThemeCount, writable: true, global: true },
      skills: { writable: true, installRoot: managedSkillRoot, recoverableDelete: true },
      plugins: { writable: true, snapshotBeforeChange: true, automaticRollback: true, trialBoot: false },
      github: { publicSearch: true, oauthConfigured: Boolean(process.env.DPA_GITHUB_CLIENT_ID) },
      agentTeam: { supported: fs.existsSync(path.join(harnessDir, 'packages', 'experimental', 'agent-team')), featureFlag: 'DPA_CLUSTER_RUNTIME', defaultRuntime: process.env.DPA_CLUSTER_RUNTIME || 'dpa' },
    }
  }

  return {
    themeState: appearance.state, setTheme: appearance.setTheme, setTypography: appearance.setTypography, saveTheme: appearance.saveTheme,
    setBackground: appearance.setBackground, removeBackground: appearance.removeBackground,
    importTheme: appearance.importTheme, removeTheme: appearance.removeTheme, exportTheme: appearance.exportTheme,
    listSkills, installSkill, uninstallSkill, listPlugins: market.installedPlugins,
    searchExtensions: market.search, preflightExtension: market.preflight, mutatePlugin: market.mutate,
    preflightRemoteSkill: market.preflightSkill, installRemoteSkill,
    listExtensionBackups: market.backups, restoreExtensionBackup: market.restore, capabilities,
    paths: { dataDir, dshHome, harnessDir, managedSkillRoot, themesDir: appearance.paths.themesDir, backgroundsDir: appearance.paths.backgroundsDir },
  }
}

module.exports = { BUILTIN_THEMES, createCapabilityRegistry, parseSkillFile }
