'use strict'

const fs = require('fs')
const path = require('path')
const https = require('https')
const { spawn } = require('child_process')

const CURATED = Object.freeze([
  {
    id: 'dshmarket', kind: 'plugin', name: 'DSH Market', publisher: 'dsh-market',
    description: '在 Harness 设置页内浏览、搜索、安装、更新和卸载社区插件与主题。',
    sourceUrl: 'https://github.com/dsh-market/dsh-market', installSpec: 'dshmarket', verified: 'community-reviewed',
    tags: ['market', 'plugins', 'themes'],
  },
  {
    id: 'dsh-skill-hub', kind: 'plugin', name: 'DSH Skill Hub', publisher: 'cheshireez',
    description: '基于 Harness 正式 Skill 注册表的浏览、启停、诊断、更新与回收站。',
    sourceUrl: 'https://github.com/cheshireez/dsh-skill-hub', installSpec: 'dsh-skill-hub', verified: 'community',
    tags: ['skills', 'manager'],
  },
  {
    id: 'deepseek-harness-themes', kind: 'theme', name: 'Harness Themes', publisher: 'orxz',
    description: '基于 Harness 官方 ctx.theme 扩展点的 Dracula、Catppuccin、Tokyo Night、Nord 等主题集合。',
    sourceUrl: 'https://github.com/orxz/deepseek-harness-themes', installSpec: '@dshthemes/ui', verified: 'community-reviewed',
    tags: ['themes', 'appearance'],
  },
  {
    id: 'dsh-agent-plugins-market', kind: 'plugin', name: 'Agent Plugins Market', publisher: 'Sivan757',
    description: '把 Claude Code、Codex、Cursor 市场中的 Skill、MCP、Hook 和命令接入 DSH。',
    sourceUrl: 'https://github.com/Sivan757/dsh-agent-plugins-market', installSpec: 'dsh-agent-plugins-market', verified: 'unverified',
    tags: ['skills', 'mcp', 'hooks', 'bridge'],
  },
])

function redact(text) {
  return String(text || '')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1***:***@')
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]+\b/g, '[REDACTED_GITHUB_TOKEN]')
    .slice(-20000)
}

function safePluginSpec(value) {
  const spec = String(value || '').trim()
  const npm = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[a-zA-Z0-9][a-zA-Z0-9._+-]*)?$/
  const github = /^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:#[A-Za-z0-9._/-]+)?$/
  if (!npm.test(spec) && !github.test(spec)) throw new Error('扩展来源格式不受支持；只允许 npm 包名或 github:owner/repo#ref')
  if (/[;&|`$<>\r\n]/.test(spec)) throw new Error('扩展来源包含危险字符')
  return spec
}

function copyTree(source, target) {
  const stat = fs.statSync(source)
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true })
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      copyTree(path.join(source, entry.name), path.join(target, entry.name))
    }
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(source, target)
  }
}

function assertChild(root, candidate) {
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(candidate)
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error('路径超出 DPA 管理目录')
  return resolved
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      const result = { code, output: redact(output) }
      if (code === 0) resolve(result)
      else reject(Object.assign(new Error(`扩展命令执行失败（退出码 ${code}）`), { result }))
    })
  })
}

function githubRequest(pathname, token) {
  return new Promise((resolve, reject) => {
    const request = https.get({
      hostname: 'api.github.com',
      path: pathname,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'DeepSeek-PA',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      timeout: 20000,
    }, (response) => {
      let text = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { text += chunk })
      response.on('end', () => {
        let value
        try { value = JSON.parse(text || '{}') } catch (_) { value = { message: text } }
        if ((response.statusCode || 500) >= 400) return reject(new Error(value.message || `GitHub 搜索失败（${response.statusCode}）`))
        resolve(value)
      })
    })
    request.on('timeout', () => request.destroy(new Error('GitHub 搜索超时')))
    request.on('error', reject)
  })
}

function inferKind(repository) {
  const haystack = `${repository.name} ${repository.description || ''} ${(repository.topics || []).join(' ')}`.toLowerCase()
  if (/theme|skin|主题|皮肤/.test(haystack)) return 'theme'
  if (/\bskill\b|skills|技能/.test(haystack) && !/plugin-market|marketplace/.test(haystack)) return 'skill'
  if (/\bmcp\b|mcp-server/.test(haystack)) return 'mcp'
  return 'plugin'
}

function mapRepository(repository) {
  const kind = inferKind(repository)
  return {
    id: `github:${repository.full_name}`,
    kind,
    name: repository.name,
    publisher: repository.owner && repository.owner.login || '',
    description: repository.description || 'GitHub 项目未提供简介',
    sourceUrl: repository.html_url,
    installSpec: kind === 'plugin' || kind === 'theme' ? `github:${repository.full_name}` : '',
    repo: repository.full_name,
    defaultBranch: repository.default_branch || '',
    verified: 'unverified',
    stars: repository.stargazers_count || 0,
    updatedAt: repository.updated_at,
    tags: repository.topics || [],
    license: repository.license && repository.license.spdx_id || '',
  }
}

function createExtensionMarket(options = {}) {
  const dataDir = path.resolve(options.dataDir)
  const dshHome = path.resolve(options.dshHome)
  const harnessDir = path.resolve(options.harnessDir)
  const githubAuth = options.githubAuth
  const backupRoot = path.join(dataDir, 'extension-backups')
  const profileRoot = path.join(dshHome, 'profiles', 'web')
  const pnpm = options.pnpmCommand || (process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
  const processRunner = options.runner || run
  const githubRequester = options.githubRequester || githubRequest
  const skillDownloadRoot = path.join(dataDir, 'skill-downloads')

  function installedPlugins() {
    const manifests = [
      { file: path.join(harnessDir, 'package.json'), source: 'DSH 内置' },
      { file: path.join(profileRoot, 'package.json'), source: 'web profile' },
    ]
    const dedup = new Map()
    for (const manifest of manifests) {
      let pkg = {}
      try { pkg = JSON.parse(fs.readFileSync(manifest.file, 'utf8')) } catch (_) {}
      const dependencies = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
      for (const [name, version] of Object.entries(dependencies)) {
        if (manifest.source === 'DSH 内置' && !name.startsWith('@deepseek-ai/dsh-')) continue
        dedup.set(name, {
          id: name, kind: 'plugin', name, version: String(version), installed: true,
          source: manifest.source, status: 'installed', trust: manifest.source === 'DSH 内置' ? 'runtime' : 'community',
          note: manifest.source === 'DSH 内置' ? 'Harness 托管运行时组件' : '安装在 DSH web profile',
        })
      }
    }
    return [...dedup.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  function installedSpecs() {
    return new Set(installedPlugins().map((item) => item.id))
  }

  async function search(payload = {}) {
    const query = String(payload.query || '').trim()
    const kind = String(payload.kind || 'all')
    const installed = installedSpecs()
    let entries = CURATED.map((item) => ({ ...item, installed: installed.has(item.installSpec) || installed.has(item.id) }))
    if (query) {
      const token = githubAuth ? await githubAuth.token() : ''
      const qualifiers = kind === 'theme'
        ? `${query} deepseek harness theme`
        : kind === 'skill'
          ? `${query} deepseek harness skill`
          : `${query} deepseek harness`
      const result = await githubRequester(`/search/repositories?q=${encodeURIComponent(qualifiers)}&sort=stars&order=desc&per_page=24`, token)
      entries.push(...(result.items || []).map(mapRepository).map((item) => ({ ...item, installed: installed.has(item.installSpec) })))
    }
    const needle = query.toLowerCase()
    const dedup = new Map()
    for (const item of entries) {
      if (kind !== 'all' && item.kind !== kind) continue
      if (!query || `${item.name} ${item.description} ${item.publisher} ${(item.tags || []).join(' ')}`.toLowerCase().includes(needle) || String(item.id).startsWith('github:')) {
        if (!dedup.has(item.sourceUrl || item.id)) dedup.set(item.sourceUrl || item.id, item)
      }
    }
    return [...dedup.values()]
  }

  function safeGithubRepo(value) {
    const repo = String(value || '').trim().replace(/^github:/, '')
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || repo.includes('..')) throw new Error('GitHub Skill 仓库格式不正确')
    return repo
  }

  function safeRef(value) {
    const ref = String(value || '').trim()
    if (!ref || ref.length > 200 || !/^[A-Za-z0-9._/-]+$/.test(ref) || ref.includes('..') || ref.startsWith('/')) throw new Error('GitHub ref 格式不正确')
    return ref
  }

  function safeSkillPath(value) {
    const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '')
    if (!normalized || normalized.startsWith('/') || normalized.includes('../') || !normalized.endsWith('SKILL.md')) throw new Error('Skill 路径不正确')
    return normalized
  }

  async function skillRepository(payload = {}) {
    const repo = safeGithubRepo(payload.repo || payload.id)
    const token = githubAuth ? await githubAuth.token() : ''
    const metadata = await githubRequester(`/repos/${repo}`, token)
    const ref = safeRef(payload.ref || metadata.default_branch || 'main')
    const tree = await githubRequester(`/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, token)
    if (tree.truncated) throw new Error('仓库文件树过大，GitHub 返回了截断结果；请改用更小的 Skill 仓库')
    const entries = Array.isArray(tree.tree) ? tree.tree : []
    const candidates = entries.filter((item) => item.type === 'blob' && /(^|\/)SKILL\.md$/i.test(item.path || ''))
      .slice(0, 50).map((item) => ({ path:item.path, directory:path.posix.dirname(item.path) === '.' ? '' : path.posix.dirname(item.path), size:Number(item.size || 0), sha:item.sha }))
    if (!candidates.length) throw new Error('仓库中没有找到 SKILL.md')
    return { repo, ref, metadata, entries, candidates, token }
  }

  async function preflightSkill(payload = {}) {
    const info = await skillRepository(payload)
    return {
      ok: true, repo:info.repo, ref:info.ref,
      candidates:info.candidates.map(({ path:skillPath, directory, size }) => ({ path:skillPath, directory, size })),
      warnings:[
        '远程 Skill 可能包含脚本、提示词和工具说明；安装后员工可按权限策略调用。',
        'DPA 只下载所选 Skill 目录，不执行安装脚本，并在写入前校验路径、体积与 SKILL.md。',
        '覆盖已有 Skill 前会使用受管安装器备份；卸载会进入可恢复回收站。',
      ],
      requiresSelection: info.candidates.length > 1,
    }
  }

  async function downloadSkill(payload = {}) {
    if (payload.confirmed !== true) return { requiresConfirmation:true, preflight:await preflightSkill(payload) }
    const info = await skillRepository(payload)
    const skillPath = safeSkillPath(payload.path || (info.candidates.length === 1 ? info.candidates[0].path : ''))
    const candidate = info.candidates.find((item) => item.path === skillPath)
    if (!candidate) throw new Error('所选 SKILL.md 不在当前仓库文件树中')
    const prefix = candidate.directory ? `${candidate.directory}/` : ''
    const files = info.entries.filter((item) => item.type === 'blob' && (candidate.directory ? String(item.path || '').startsWith(prefix) : true))
    if (files.length > 250) throw new Error('所选 Skill 超过 250 个文件，拒绝自动安装')
    const declaredBytes = files.reduce((sum, item) => sum + Number(item.size || 0), 0)
    if (declaredBytes > 10 * 1024 * 1024) throw new Error('所选 Skill 超过 10MB，拒绝自动安装')
    fs.mkdirSync(skillDownloadRoot, { recursive:true })
    const temporary = assertChild(skillDownloadRoot, path.join(skillDownloadRoot, `${Date.now()}-${Math.random().toString(16).slice(2)}`))
    fs.mkdirSync(temporary, { recursive:true })
    let actualBytes = 0
    try {
      for (const item of files) {
        const relative = candidate.directory ? String(item.path).slice(prefix.length) : String(item.path)
        if (!relative || relative.startsWith('/') || relative.includes('../') || relative.includes('\\')) throw new Error('仓库包含不安全的文件路径')
        const blob = await githubRequester(`/repos/${info.repo}/git/blobs/${item.sha}`, info.token)
        if (blob.encoding !== 'base64' || typeof blob.content !== 'string') throw new Error(`无法解码 Skill 文件：${item.path}`)
        const content = Buffer.from(blob.content.replace(/\s/g, ''), 'base64')
        actualBytes += content.length
        if (actualBytes > 10 * 1024 * 1024) throw new Error('所选 Skill 实际内容超过 10MB')
        const target = assertChild(temporary, path.join(temporary, ...relative.split('/')))
        fs.mkdirSync(path.dirname(target), { recursive:true })
        fs.writeFileSync(target, content)
      }
      const manifest = path.join(temporary, 'SKILL.md')
      const text = fs.readFileSync(manifest, 'utf8')
      const name = (text.match(/^---[\s\S]*?^name\s*:\s*['"]?([a-z0-9]+(?:-[a-z0-9]+)*)['"]?\s*$/mi) || [])[1]
      if (!name) throw new Error('SKILL.md 缺少合法的 kebab-case name')
      fs.writeFileSync(path.join(temporary, '.dpa-source.json'), `${JSON.stringify({ repo:info.repo, ref:info.ref, skillPath, installedAt:new Date().toISOString() }, null, 2)}\n`, 'utf8')
      return { ok:true, id:name, sourcePath:temporary, repo:info.repo, ref:info.ref, skillPath, fileCount:files.length + 1, totalBytes:actualBytes }
    } catch (error) {
      if (fs.existsSync(temporary)) fs.rmSync(temporary, { recursive:true, force:true })
      throw error
    }
  }

  function cleanupSkillDownload(sourcePath) {
    const target = assertChild(skillDownloadRoot, sourcePath)
    if (fs.existsSync(target)) fs.rmSync(target, { recursive:true, force:true })
  }

  function preflight(payload = {}) {
    const spec = safePluginSpec(payload.spec || payload.installSpec)
    const warnings = [
      'Harness 插件运行在本机进程中，可能访问文件、网络和子进程。',
      'DPA 将在变更前备份 web profile，并在命令失败时自动恢复。',
    ]
    if (spec.startsWith('github:') && !/#/.test(spec)) warnings.push('GitHub 来源未锁定 commit，后续内容可能发生变化。')
    if (/market|bridge|mcp|hook/i.test(spec)) warnings.push('该扩展可能进一步加载其他代码或外部服务，请检查来源与权限。')
    return { ok: true, spec, profile: 'web', warnings, backupRequired: true, validation: 'profile-manifest', trialBoot: false }
  }

  function validateProfile() {
    const manifest = path.join(profileRoot, 'package.json')
    if (!fs.existsSync(manifest)) return { ok: true, status: 'profile-not-created' }
    let pkg
    try { pkg = JSON.parse(fs.readFileSync(manifest, 'utf8')) } catch (error) {
      throw new Error(`web profile 清单损坏：${error.message}`)
    }
    for (const field of ['dependencies', 'devDependencies']) {
      if (pkg[field] !== undefined && (!pkg[field] || typeof pkg[field] !== 'object' || Array.isArray(pkg[field]))) {
        throw new Error(`web profile 的 ${field} 字段格式不正确`)
      }
    }
    return {
      ok: true,
      status: 'manifest-valid',
      dependencyCount: Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }).length,
    }
  }

  function createBackup(action, spec) {
    fs.mkdirSync(backupRoot, { recursive: true })
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
    const target = assertChild(backupRoot, path.join(backupRoot, `${stamp}-${action}-${String(spec).replace(/[^a-z0-9._-]+/gi, '_').slice(0, 60)}`))
    fs.mkdirSync(target, { recursive: true })
    if (fs.existsSync(profileRoot)) copyTree(profileRoot, path.join(target, 'web-profile'))
    fs.writeFileSync(path.join(target, 'metadata.json'), `${JSON.stringify({ action, spec, createdAt: new Date().toISOString(), profileRoot }, null, 2)}\n`, 'utf8')
    return target
  }

  function restoreBackup(backup) {
    const source = assertChild(backupRoot, path.join(backup, 'web-profile'))
    const target = assertChild(dshHome, profileRoot)
    if (!fs.existsSync(source)) throw new Error('备份中没有 web profile')
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true })
    copyTree(source, target)
  }

  async function mutate(payload = {}) {
    const action = ['add', 'remove', 'update'].includes(payload.action) ? payload.action : 'add'
    const spec = safePluginSpec(payload.spec || payload.installSpec)
    const check = preflight({ spec })
    if (payload.confirmed !== true) return { requiresConfirmation: true, preflight: check }
    const backup = createBackup(action, spec)
    try {
      const result = await processRunner(pnpm, ['dsh', 'plugin', '--profile', 'web', action, spec], {
        cwd: harnessDir,
        env: { ...process.env, DSH_HOME: dshHome },
      })
      const health = validateProfile()
      return { ok: true, action, spec, backup, output: result.output, health, restartRequired: true, plugins: installedPlugins() }
    } catch (error) {
      try { restoreBackup(backup) } catch (restoreError) {
        throw new Error(`${error.message}；自动恢复也失败：${restoreError.message}`)
      }
      throw new Error(`${error.message}；已恢复变更前的 web profile。\n${error.result && error.result.output || ''}`)
    }
  }

  function backups() {
    if (!fs.existsSync(backupRoot)) return []
    return fs.readdirSync(backupRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const directory = path.join(backupRoot, entry.name)
        let metadata = {}
        try { metadata = JSON.parse(fs.readFileSync(path.join(directory, 'metadata.json'), 'utf8')) } catch (_) {}
        return { id: entry.name, path: directory, ...metadata }
      })
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  }

  function restore(payload = {}) {
    const id = String(payload.id || '')
    if (!/^[a-zA-Z0-9._-]+$/.test(id)) throw new Error('备份 ID 不正确')
    const backup = assertChild(backupRoot, path.join(backupRoot, id))
    restoreBackup(backup)
    return { ok: true, id, restartRequired: true }
  }

  return { search, preflight, mutate, backups, restore, installedPlugins, preflightSkill, downloadSkill, cleanupSkillDownload, curated: () => CURATED.map((item) => ({ ...item })) }
}

module.exports = { CURATED, createExtensionMarket, inferKind, mapRepository, safePluginSpec }
