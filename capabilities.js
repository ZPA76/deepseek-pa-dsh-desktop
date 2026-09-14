'use strict'

const TOKEN_LABELS = {
  background:'主背景', panel:'面板', panel2:'次级面板', text:'主要文字', muted:'次要文字',
  accent:'强调色', accentStrong:'主按钮', line:'边框', success:'成功', warning:'警告', danger:'危险',
  hover:'悬停', active:'按下', shadow:'阴影',
}
const FONT_STACKS = {
  system:'"Segoe UI Variable Text","Microsoft YaHei UI","Segoe UI",sans-serif',
  yahei:'"Microsoft YaHei UI","Microsoft YaHei",sans-serif',
  dengxian:'DengXian,"Microsoft YaHei UI",sans-serif',
  noto:'"Noto Sans CJK SC","Microsoft YaHei UI",sans-serif',
  sourceHan:'"Source Han Sans SC","Microsoft YaHei UI",sans-serif',
  serif:'"Noto Serif CJK SC",SimSun,serif',
}
const MONO_STACKS = {
  cascadia:'"Cascadia Mono",Consolas,monospace',
  consolas:'Consolas,"Microsoft YaHei UI",monospace',
  jetbrains:'"JetBrains Mono","Cascadia Mono",Consolas,monospace',
}
const TYPOGRAPHY_DEFAULTS = { uiFont:'system', customFont:'', monoFont:'cascadia', fontSize:14, lineHeight:1.5, zoom:100, ctrlWheel:'zoom', chatFont:'inherit', chatFontSize:15 }
const LOCAL_FILE_TARGET_ORIGIN = 'file://'
const LOCAL_FILE_EVENT_ORIGIN = 'null'
const SHELL_URL = new URL('shell.html', window.location.href).href
const state = { appearance:null, skills:[], plugins:[], extensions:[], backups:[], github:null, kind:'all', view:'market', busy:false }
state.market = { page:1, perPage:30, source:'github', sort:'best-match', query:'deepseek-harness', signature:'', requestId:0, loading:false, result:null }

function isTrustedShellMessage(event) {
  if (event.origin !== LOCAL_FILE_EVENT_ORIGIN || event.source !== window.parent || window.parent === window) return false
  try { return window.parent.location.href === SHELL_URL }
  catch (_) { return false }
}

function postToShell(message) {
  if (window.parent === window) return false
  try {
    if (window.parent.location.href !== SHELL_URL) return false
    window.parent.postMessage(message, LOCAL_FILE_TARGET_ORIGIN)
    return true
  } catch (_) { return false }
}

const api = {
  request(method, payload) {
    return new Promise((resolve, reject) => {
      const id = `cap-${Date.now()}-${Math.random().toString(16).slice(2)}`
      const timer = setTimeout(() => { window.removeEventListener('message', listener); reject(new Error('扩展中心请求超时')) }, 120000)
      const listener = (event) => {
        const data = event.data || {}
        if (!isTrustedShellMessage(event) || data.type !== 'capability:response' || data.id !== id) return
        clearTimeout(timer); window.removeEventListener('message', listener)
        if (data.error) reject(new Error(data.error)); else resolve(data.result)
      }
      window.addEventListener('message', listener)
      if (!postToShell({ type:'capability:request', id, method, payload:payload || {} })) {
        clearTimeout(timer); window.removeEventListener('message', listener); reject(new Error('DPA 本地能力桥接不可用'))
      }
    })
  },
  theme(theme) { postToShell({ type:'capability:theme', theme }) },
  appearance(appearance) { postToShell({ type:'capability:appearance', appearance }) },
}
const byId = (id) => document.getElementById(id)
const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]))

function toast(message, error = false) {
  const node = byId('toast'); node.textContent = String(message || ''); node.className = `toast visible${error ? ' error' : ''}`
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { node.className = 'toast' }, 3600)
}

function applyTheme(theme, broadcast = true) {
  if (!theme) return
  const tokens = theme.tokens || {}
  const root = document.documentElement
  root.dataset.dpaTheme = theme.id || 'midnight'
  root.style.colorScheme = theme.colorScheme || 'dark'
  const mapping = { background:'--bg', panel:'--panel', panel2:'--panel-2', text:'--text', muted:'--muted', accent:'--accent', accentStrong:'--accent-strong', line:'--line', success:'--success', warning:'--warning', danger:'--danger', hover:'--hover', active:'--active', shadow:'--shadow' }
  for (const [key, variable] of Object.entries(mapping)) if (tokens[key]) root.style.setProperty(variable, tokens[key])
  if (broadcast) api.theme(theme)
  document.querySelectorAll('.theme-card').forEach((card) => card.classList.toggle('active', card.dataset.theme === theme.id))
}

function applyTypography(typography) {
  const value = { ...TYPOGRAPHY_DEFAULTS, ...(typography || {}) }
  const root = document.documentElement
  root.style.setProperty('--ui-font-family', value.fontFamily || FONT_STACKS[value.uiFont] || FONT_STACKS.system)
  root.style.setProperty('--mono-font-family', value.monoFontFamily || MONO_STACKS[value.monoFont] || MONO_STACKS.cascadia)
  root.style.setProperty('--ui-font-size', String(value.fontSize) + 'px')
  root.style.setProperty('--ui-line-height', String(value.lineHeight))
}

function backgroundPayload() {
  return {
    enabled:byId('background-enabled').checked,
    fit:byId('background-fit').value,
    position:byId('background-position').value,
    opacity:Number(byId('background-opacity').value),
    blur:Number(byId('background-blur').value),
    overlay:Number(byId('background-overlay').value),
  }
}

function applyBackground(background = {}) {
  const root = document.documentElement
  const enabled = Boolean(background.enabled && background.dataUrl)
  root.dataset.dpaWallpaper = enabled ? 'true' : 'false'
  root.style.setProperty('--wallpaper-image', enabled ? `url("${background.dataUrl}")` : 'none')
  root.style.setProperty('--wallpaper-size', background.fit === 'repeat' ? 'auto' : (background.fit || 'cover'))
  root.style.setProperty('--wallpaper-repeat', background.fit === 'repeat' ? 'repeat' : 'no-repeat')
  root.style.setProperty('--wallpaper-position', background.position || 'center')
  root.style.setProperty('--wallpaper-opacity', String(background.opacity == null ? .28 : background.opacity))
  root.style.setProperty('--wallpaper-blur', String(background.blur || 0) + 'px')
  root.style.setProperty('--wallpaper-overlay', String(background.overlay == null ? .42 : background.overlay))
}

function fillBackground(background = {}) {
  byId('background-enabled').checked = Boolean(background.enabled)
  byId('background-fit').value = background.fit || 'cover'
  byId('background-position').value = background.position || 'center'
  byId('background-opacity').value = background.opacity == null ? .28 : background.opacity
  byId('background-blur').value = background.blur || 0
  byId('background-overlay').value = background.overlay == null ? .42 : background.overlay
  byId('background-opacity-value').textContent = `${Math.round(Number(byId('background-opacity').value) * 100)}%`
  byId('background-blur-value').textContent = `${Number(byId('background-blur').value)} px`
  byId('background-overlay-value').textContent = `${Math.round(Number(byId('background-overlay').value) * 100)}%`
  const preview = byId('background-preview')
  preview.classList.toggle('has-image', Boolean(background.dataUrl))
  preview.style.backgroundImage = background.dataUrl ? `linear-gradient(rgba(0,0,0,${background.overlay || 0}),rgba(0,0,0,${background.overlay || 0})),url("${background.dataUrl}")` : 'none'
  preview.style.backgroundSize = background.fit === 'repeat' ? 'auto' : (background.fit || 'cover')
  preview.style.backgroundRepeat = background.fit === 'repeat' ? 'repeat' : 'no-repeat'
  preview.style.backgroundPosition = background.position || 'center'
  preview.innerHTML = `<span>${background.dataUrl ? (background.enabled ? '背景已启用' : '背景已保存但当前关闭') : '尚未设置图片背景'}</span>`
}

function applyAppearance(appearance, broadcast = true) {
  if (!appearance) return
  state.appearance = appearance
  applyTheme(appearance.theme, false)
  applyTypography(appearance.typography)
  applyBackground(appearance.background)
  if (broadcast) api.appearance(appearance)
}

function typographyPayload() {
  return {
    uiFont:byId('ui-font').value, customFont:byId('custom-font').value.trim(), monoFont:byId('mono-font').value,
    fontSize:Number(byId('font-size').value), lineHeight:Number(byId('line-height').value),
    zoom:Number(byId('ui-zoom').value), ctrlWheel:byId('ctrl-wheel').value,
  }
}

function updateFontPreview() {
  const value = typographyPayload()
  const custom = value.customFont ? JSON.stringify(value.customFont) + ',' : ''
  const family = custom + (FONT_STACKS[value.uiFont] || FONT_STACKS.system)
  const mono = MONO_STACKS[value.monoFont] || MONO_STACKS.cascadia
  const preview = byId('font-preview')
  preview.style.setProperty('--preview-font', family)
  preview.style.setProperty('--preview-mono', mono)
  preview.style.setProperty('--preview-size', String(Math.max(12, Math.min(22, value.fontSize || 14))) + 'px')
  preview.style.setProperty('--preview-line', String(Math.max(1.25, Math.min(1.9, value.lineHeight || 1.5))))
  const requested = value.customFont || ({ yahei:'Microsoft YaHei UI', dengxian:'DengXian', noto:'Noto Sans CJK SC', sourceHan:'Source Han Sans SC', serif:'Noto Serif CJK SC' }[value.uiFont])
  byId('font-availability').textContent = requested ? (document.fonts.check('14px ' + JSON.stringify(requested)) ? '已检测到：' + requested : '未检测到 ' + requested + '，将自动使用回退字体') : '正在使用 Windows 中文系统字体栈'
}

function fillTypography(typography) {
  const value = { ...TYPOGRAPHY_DEFAULTS, ...(typography || {}) }
  byId('ui-font').value = value.uiFont
  byId('custom-font').value = value.customFont || ''
  byId('mono-font').value = value.monoFont
  byId('font-size').value = value.fontSize
  byId('line-height').value = value.lineHeight
  byId('ui-zoom').value = value.zoom
  byId('ctrl-wheel').value = value.ctrlWheel
  updateFontPreview()
}

async function saveTypography(value) {
  state.appearance = await api.request('setTypography', value)
  applyAppearance(state.appearance)
  fillTypography(state.appearance.typography)
  toast('字体与缩放已保存并全局应用')
}

function switchView(view) {
  state.view = view
  document.querySelectorAll('.tabs .tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === view))
  document.querySelectorAll('.view').forEach((section) => section.classList.toggle('hidden', section.id !== `view-${view}`))
}

function kindLabel(kind) { return ({ plugin:'插件', skill:'Skill', theme:'主题', mcp:'MCP', bundle:'能力包', repository:'GitHub 仓库' }[kind] || kind || '扩展') }
function trustLabel(value) { return ({ 'community-reviewed':'社区已审阅', community:'社区', runtime:'DSH 内置', unverified:'未验证' }[value] || value || '未知来源') }

function renderMarket() {
  const grid = byId('extension-grid'); grid.innerHTML = ''
  if (!state.extensions.length) { grid.innerHTML = `<div class="market-empty"><strong>${state.market.loading ? '正在寻找匹配的项目…' : '当前没有可展示的结果'}</strong><p>${state.market.loading ? '结果将按 GitHub 排序显示。' : '试试更短的关键词，或选择“全部”以取消追加的分类词。'}</p></div>`; return }
  for (const item of state.extensions) {
    const card = document.createElement('article'); card.className = 'extension-card'
    const installable = (Boolean(item.installSpec) && ['plugin','theme'].includes(item.kind)) || (item.kind === 'skill' && Boolean(item.repo))
    card.innerHTML = `
      <div class="card-head"><div><strong>${esc(item.name)}</strong><div class="muted">${esc(item.publisher || '未知发布者')}</div></div><span class="kind-badge">${esc(kindLabel(item.kind))}</span></div>
      <div class="card-description">${esc(item.description)}</div>
      <div class="card-meta">${item.stars != null ? `★ ${Number(item.stars).toLocaleString()} · ` : ''}${esc(item.license || '')}</div>
      <div><span class="trust-badge ${item.verified === 'community-reviewed' ? 'reviewed' : ''}">${esc(trustLabel(item.verified))}</span></div>
      <div class="card-actions"><button class="btn source">查看源码</button>${item.installed ? '<span class="pill">已安装</span>' : (installable ? '<button class="btn primary install">安装</button>' : '<span class="pill">先审阅源码</span>')}</div>`
    card.querySelector('.source').addEventListener('click', () => openSource(item.sourceUrl))
    const install = card.querySelector('.install'); if (install) install.addEventListener('click', () => installExtension(item))
    grid.append(card)
  }
}

function renderInstalled() {
  const plugins = byId('plugin-list'); plugins.innerHTML = ''
  for (const plugin of state.plugins) {
    const row = document.createElement('article'); row.className = 'installed-row'
    const removable = plugin.source === 'web profile'
    row.innerHTML = `<div><div class="installed-title">${esc(plugin.name)}</div><div class="muted">${esc(plugin.version)} · ${esc(plugin.note || plugin.source)}</div></div><div class="card-actions">${removable ? '<button class="btn update">更新</button><button class="btn danger remove">卸载</button>' : '<span class="pill">DSH 内置</span>'}</div>`
    const update = row.querySelector('.update'); if (update) update.addEventListener('click', () => mutatePlugin('update', plugin.name))
    const remove = row.querySelector('.remove'); if (remove) remove.addEventListener('click', () => mutatePlugin('remove', plugin.name))
    plugins.append(row)
  }
  if (!state.plugins.length) plugins.innerHTML = '<div class="notice">没有读取到 Harness 插件。</div>'

  const skills = byId('skill-grid'); skills.innerHTML = ''
  for (const skill of state.skills) {
    const card = document.createElement('article'); card.className = 'extension-card'
    const installed = Boolean(skill.installed) || skill.source === 'DPA 市场安装'
    card.innerHTML = `<div class="card-head"><strong>${esc(skill.name)}</strong><span class="kind-badge">Skill</span></div><div class="card-description">${esc(skill.description)}</div><div class="card-meta">${esc(skill.author)} · ${esc(skill.version)} · ${esc(skill.source)}</div><div class="card-actions"><button class="btn detail">查看内容</button>${installed ? '<button class="btn danger remove">卸载</button>' : (skill.sourcePath ? '<button class="btn primary install">安装到 DPA</button>' : '')}</div>`
    card.querySelector('.detail').addEventListener('click', () => showInfo(skill.name, `<pre class="log">${esc(skill.bodyPreview || skill.description)}</pre>`))
    const install = card.querySelector('.install'); if (install) install.addEventListener('click', async () => { await api.request('installSkill', { id:skill.id, sourcePath:skill.sourcePath }); await refreshInstalled(); toast('Skill 已安装') })
    const remove = card.querySelector('.remove'); if (remove) remove.addEventListener('click', async () => { if (!confirm(`把 Skill「${skill.name}」移入可恢复回收站？`)) return; await api.request('uninstallSkill', { id:skill.id }); await refreshInstalled(); toast('Skill 已移入回收站') })
    skills.append(card)
  }
  if (!state.skills.length) skills.innerHTML = '<div class="notice">没有发现 Skill。</div>'
}

function renderThemes() {
  const grid = byId('theme-grid'); grid.innerHTML = ''
  const appearance = state.appearance || { themes:[] }
  for (const theme of appearance.themes || []) {
    const card = document.createElement('article'); card.className = `theme-card${theme.id === appearance.themeId ? ' active' : ''}`; card.dataset.theme = theme.id
    card.innerHTML = `<div class="theme-swatch"><span style="background:${esc(theme.tokens.background)}"></span><span style="background:${esc(theme.tokens.panel)}"></span><span style="background:${esc(theme.tokens.accent)}"></span><span style="background:${esc(theme.tokens.text)}"></span></div><div class="theme-name">${esc(theme.label)}</div><div class="muted">${esc(theme.description)} · ${theme.builtIn ? '内置' : esc(theme.author || '自定义')}</div><div class="card-actions"><button class="btn apply">应用</button>${theme.builtIn ? '' : '<button class="btn edit">编辑</button><button class="btn danger remove">删除</button>'}</div>`
    card.querySelector('.apply').addEventListener('click', async () => { state.appearance = await api.request('setTheme', { themeId:theme.id }); applyTheme(state.appearance.theme); renderThemes(); toast(`已应用「${theme.label}」`) })
    const edit = card.querySelector('.edit'); if (edit) edit.addEventListener('click', () => fillEditor(theme))
    const remove = card.querySelector('.remove'); if (remove) remove.addEventListener('click', async () => { if (!confirm(`删除自定义主题「${theme.label}」？`)) return; state.appearance = await api.request('removeTheme', { themeId:theme.id }); applyTheme(state.appearance.theme); renderThemes(); toast('主题已删除') })
    grid.append(card)
  }
}

function fillEditor(theme) {
  byId('theme-editor-panel').open = true
  byId('theme-id').value = theme.id
  byId('theme-label').value = theme.label
  byId('theme-description').value = theme.description || ''
  byId('theme-scheme').value = theme.colorScheme || 'dark'
  for (const key of Object.keys(TOKEN_LABELS)) {
    const text = byId(`token-${key}`); const color = byId(`color-${key}`)
    if (text) text.value = theme.tokens[key] || ''
    if (color && /^#[0-9a-f]{6}$/i.test(theme.tokens[key] || '')) color.value = theme.tokens[key]
  }
  byId('theme-editor-panel').scrollIntoView({ behavior:'smooth', block:'start' })
}

function editorTheme() {
  const tokens = {}
  for (const key of Object.keys(TOKEN_LABELS)) tokens[key] = byId(`token-${key}`).value.trim()
  return { id:byId('theme-id').value.trim(), label:byId('theme-label').value.trim(), description:byId('theme-description').value.trim(), colorScheme:byId('theme-scheme').value, version:'1.0.0', author:'DPA 用户', tokens }
}

function renderTokenEditor() {
  const container = byId('token-editor'); container.innerHTML = ''
  const base = state.appearance && state.appearance.theme && state.appearance.theme.tokens || {}
  for (const [key, label] of Object.entries(TOKEN_LABELS)) {
    const wrapper = document.createElement('label'); wrapper.textContent = label
    const value = base[key] || '#000000'; const colorValue = /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'
    wrapper.innerHTML += `<div class="token-input"><input type="color" id="color-${key}" value="${colorValue}"><input id="token-${key}" value="${esc(value)}"></div>`
    wrapper.querySelector(`#color-${key}`).addEventListener('input', (event) => { byId(`token-${key}`).value = event.target.value })
    container.append(wrapper)
  }
}

function renderBackups() {
  const list = byId('backup-list'); list.innerHTML = ''
  for (const backup of state.backups) {
    const row = document.createElement('article'); row.className = 'backup-row'
    row.innerHTML = `<div><div class="installed-title">${esc(backup.action || '变更')} · ${esc(backup.spec || backup.id)}</div><div class="muted">${esc(backup.createdAt || '')} · ${esc(backup.id)}</div></div><button class="btn restore">恢复此快照</button>`
    row.querySelector('.restore').addEventListener('click', async () => { if (!confirm('恢复后需要重启 Harness，继续吗？')) return; const result = await api.request('restoreExtensionBackup', { id:backup.id }); toast(result.restartRequired ? '已恢复，请重启 DSH' : '已恢复') })
    list.append(row)
  }
  if (!state.backups.length) list.innerHTML = '<div class="notice">当前没有扩展变更备份。</div>'
}

function renderGithub() {
  const button = byId('github-account'); const github = state.github || {}
  button.textContent = github.connected ? `GitHub：${github.login}` : (github.configured ? '连接 GitHub' : 'GitHub：匿名浏览')
  button.classList.toggle('connected', Boolean(github.connected)); button.title = github.message || ''
}

function marketGithubUrl() {
  const market = state.market
  const effectiveQuery = `${market.query}${state.kind !== 'all' ? ` ${state.kind}` : ''}`.trim()
  const params = new URLSearchParams({ q:effectiveQuery, type:'repositories' })
  if (market.sort !== 'best-match') { params.set('s', market.sort); params.set('o', 'desc') }
  return `https://github.com/search?${params}`
}

function renderMarketPagination() {
  const market = state.market; const result = market.result
  const pages = result && result.totalPages || 0
  byId('market-prev').disabled = market.loading || !result || !result.hasPrevious
  byId('market-next').disabled = market.loading || !result || !result.hasNext
  byId('market-page-go').disabled = market.loading || pages < 2
  byId('market-page-input').disabled = market.loading || pages < 2
  byId('market-page-input').max = String(pages || 1)
  byId('market-page-input').value = String(market.page)
  byId('market-page-label').textContent = pages ? `第 ${market.page} / ${pages} 页` : '暂无结果'
  byId('market-open-github').hidden = market.source !== 'github'
  byId('market-sort').disabled = market.source === 'curated'
  byId('market-search-button').textContent = market.source === 'curated' ? '搜索推荐' : '搜索 GitHub'
  byId('extension-grid').setAttribute('aria-busy', String(market.loading))
}

async function searchMarket(options = {}) {
  const market = state.market
  const query = byId('market-search').value.trim()
  const source = byId('market-source').value
  const sort = byId('market-sort').value
  const perPage = Number(byId('market-page-size').value)
  const signature = JSON.stringify([query, source, sort, perPage, state.kind])
  const page = options.reset || signature !== market.signature ? 1 : (options.page || market.page)
  const requestId = ++market.requestId
  Object.assign(market, { page, perPage, source, sort, query, signature, loading:true, result:null })
  state.extensions = []
  const effectiveQuery = `${query}${source === 'github' && state.kind !== 'all' ? ` ${state.kind}` : ''}`.trim()
  byId('market-query-hint').textContent = source === 'github' ? `实际 GitHub 查询：${effectiveQuery || '请输入关键词'} · 分类按钮追加关键词；卡片类型为推测，不会再次过滤搜索结果。` : 'DPA 推荐是独立的小型精选清单；选择“GitHub 全站”可搜索全部可访问的仓库。'
  byId('market-notice').className = 'notice'
  byId('market-notice').textContent = source === 'github' ? '正在查询 GitHub…支持 user:、org:、topic:、language:、stars: 等条件。' : '正在加载 DPA 推荐…'
  byId('market-result-summary').textContent = `正在加载第 ${page} 页…`
  renderMarket(); renderMarketPagination()
  try {
    const response = await api.request('searchExtensions', { query, kind:state.kind, source, sort, perPage, page, refresh:Boolean(options.refresh) })
    if (requestId !== market.requestId) return
    // Older bridge fixtures return an array; production returns the paginated envelope.
    const result = Array.isArray(response) ? { items:response, page:1, perPage, totalCount:response.length, totalPages:response.length ? 1 : 0 } : response
    if (!result || !Array.isArray(result.items)) throw new Error('搜索结果格式不正确，请重新搜索。')
    market.result = result; market.page = result.page || 1; state.extensions = result.items
    const first = state.extensions.length ? (market.page - 1) * perPage + 1 : 0
    const last = first ? first + state.extensions.length - 1 : 0
    byId('market-result-summary').textContent = `共 ${Number(result.totalCount || 0).toLocaleString()} 个结果 · 当前 ${first}–${last} 项${result.cached ? ' · 最近缓存' : ''}`
    const notices = []
    if (result.requiresQuery) notices.push('请输入搜索关键词，或选择 DPA 推荐浏览精选项目。')
    else if (source === 'github') notices.push('按 GitHub 仓库搜索结果逐页展示；搜索到的仓库不等于已兼容 DSH，安装前请检查说明。')
    else notices.push('推荐项目来自社区资料；安装前会显示来源和预检结果。')
    if (result.limited) notices.push('GitHub API 每个查询最多允许翻阅前 1,000 项（并非 DPA 截断）。请用 topic:、language:、stars: 或更具体的关键词缩小范围；也可打开同一 GitHub 搜索。')
    if (result.incompleteResults) notices.push('GitHub 本次检索未完成，返回的总数和结果可能不完整；请重新搜索或缩小查询范围。')
    byId('market-notice').textContent = notices.join(' ')
  } catch (error) {
    if (requestId !== market.requestId) return
    byId('market-result-summary').textContent = '本次搜索未完成'
    byId('market-notice').textContent = `搜索失败：${error.message}`
    byId('market-notice').className = 'notice error'
    toast(error.message, true)
  } finally {
    if (requestId === market.requestId) { market.loading = false; renderMarket(); renderMarketPagination() }
  }
}

async function openSource(url) { try { await api.request('openExternal', { url }) } catch (error) { toast(error.message, true) } }

function confirmOperation(title, html) {
  return new Promise((resolve) => {
    const dialog = byId('operation-dialog'); byId('dialog-title').textContent = title; byId('dialog-content').innerHTML = html
    const button = byId('dialog-confirm')
    const onClose = () => { dialog.removeEventListener('close', onClose); resolve(dialog.returnValue === 'default') }
    dialog.addEventListener('close', onClose); button.hidden = false; dialog.showModal()
  })
}

function showInfo(title, html) {
  byId('dialog-title').textContent = title; byId('dialog-content').innerHTML = html; byId('dialog-confirm').hidden = true; byId('operation-dialog').showModal()
}

async function installExtension(item) {
  if (item.kind === 'skill') return installRemoteSkill(item)
  await mutatePlugin('add', item.installSpec, item)
}

async function installRemoteSkill(item) {
  try {
    toast('正在检查仓库中的 SKILL.md…')
    const preflight = await api.request('preflightRemoteSkill', { repo:item.repo, ref:item.defaultBranch })
    const options = (preflight.candidates || []).map((candidate) => `<option value="${esc(candidate.path)}">${esc(candidate.path)}</option>`).join('')
    const warnings = (preflight.warnings || []).map((warning) => `<li>${esc(warning)}</li>`).join('')
    const approved = await confirmOperation(`安装 Skill：${item.name}`, `<p>仓库：<code>${esc(preflight.repo)}#${esc(preflight.ref)}</code></p><label>选择 Skill<select id="skill-path-choice">${options}</select></label><ul class="preflight-list">${warnings}</ul>`)
    if (!approved) return
    const selected = byId('skill-path-choice') && byId('skill-path-choice').value
    toast('正在受管下载并校验 Skill…')
    const result = await api.request('installRemoteSkill', { repo:preflight.repo, ref:preflight.ref, path:selected, confirmed:true, overwrite:false })
    showInfo('Skill 安装完成', `<p><strong>${esc(result.installed.name)}</strong> 已安装到 DPA 市场目录。</p><p class="muted">${Number(result.fileCount || 0)} 个文件 · ${Number(result.totalBytes || 0).toLocaleString()} bytes</p>`)
    await refreshInstalled(); await searchMarket()
  } catch (error) { toast(error.message, true); showInfo('Skill 安装失败', `<div class="notice error">${esc(error.message)}</div>`) }
}

async function mutatePlugin(action, spec, item = {}) {
  try {
    const preflight = await api.request('preflightExtension', { spec })
    const warnings = (preflight.warnings || []).map((warning) => `<li>${esc(warning)}</li>`).join('')
    const approved = await confirmOperation(`${action === 'remove' ? '卸载' : action === 'update' ? '更新' : '安装'}：${item.name || spec}`, `<p>来源：<code>${esc(spec)}</code></p><ul class="preflight-list">${warnings}</ul><p class="muted">确认后 DPA 先备份 web profile，再调用 Harness 正式插件命令。</p>`)
    if (!approved) return
    toast('正在执行扩展操作，请勿关闭 DPA…')
    const result = await api.request('mutatePlugin', { action, spec, confirmed:true })
    showInfo('扩展操作完成', `<p>${esc(result.spec)} 已完成。${result.restartRequired ? '需要重启 Harness 才能完全生效。' : ''}</p><pre class="log">${esc(result.output || '')}</pre>`)
    await refreshInstalled(); await refreshBackups(); await searchMarket()
  } catch (error) { toast(error.message, true); showInfo('扩展操作失败', `<div class="notice error">${esc(error.message)}</div>`) }
}

async function connectGithub() {
  try {
    if (state.github && state.github.connected) {
      if (!confirm(`断开 GitHub 账号 ${state.github.login}？`)) return
      await api.request('githubDisconnect'); state.github = await api.request('githubStatus'); renderGithub(); await searchMarket({ reset:true, refresh:true }); return
    }
    if (!state.github || !state.github.configured) { showInfo('GitHub 登录尚未配置', '<p>DPA 当前可以匿名搜索公开仓库。若要登录、访问私有仓库或发布扩展，需要为 DPA 注册 GitHub App，启用 Device Flow，并设置 <code>DPA_GITHUB_CLIENT_ID</code>。</p>'); return }
    const flow = await api.request('githubStartLogin')
    showInfo('连接 GitHub', `<p>浏览器已经打开。请输入设备代码：</p><h1>${esc(flow.userCode)}</h1><p class="muted">授权完成后本窗口会自动更新。</p>`)
    const deadline = Date.now() + Number(flow.expiresIn || 900) * 1000
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.max(5, Number(flow.interval || 5)) * 1000))
      const result = await api.request('githubPollLogin', { deviceCode:flow.deviceCode })
      if (!result.pending) { state.github = result.status; renderGithub(); byId('operation-dialog').close(); toast('GitHub 已连接'); await searchMarket({ reset:true, refresh:true }); return }
    }
    throw new Error('GitHub 授权已超时')
  } catch (error) { toast(error.message, true) }
}

async function refreshInstalled() {
  const [plugins, skills] = await Promise.all([api.request('listPlugins'), api.request('listSkills')])
  state.plugins = plugins || []; state.skills = skills || []; renderInstalled()
}
async function refreshBackups() { state.backups = await api.request('listExtensionBackups'); renderBackups() }

async function refresh() {
  const result = await api.request('state')
  state.appearance = result.appearance; state.skills = result.skills || []; state.plugins = result.plugins || []; state.github = result.github; state.backups = result.backups || []
  applyAppearance(state.appearance); renderGithub(); renderThemes(); renderInstalled(); renderBackups(); renderTokenEditor(); fillEditor(state.appearance.theme); fillTypography(state.appearance.typography); fillBackground(state.appearance.background)
  byId('theme-editor-panel').open = false
  byId('runtime-summary').textContent = result.capabilities.agentTeam.supported ? `Harness ${result.capabilities.plugins.writable ? '扩展安装可用' : '只读'} · Agent Team 可用` : 'Harness 扩展中心已连接'
  await searchMarket()
}

document.querySelectorAll('.tabs .tab').forEach((tab) => tab.addEventListener('click', () => switchView(tab.dataset.view)))
document.querySelectorAll('#market-filters .chip').forEach((chip) => chip.addEventListener('click', () => { state.kind = chip.dataset.kind; document.querySelectorAll('#market-filters .chip').forEach((item) => item.classList.toggle('active', item === chip)); searchMarket({ reset:true }) }))
byId('market-search-button').addEventListener('click', () => searchMarket({ reset:true, refresh:true }))
byId('market-search').addEventListener('keydown', (event) => { if (event.key === 'Enter') searchMarket({ reset:true, refresh:true }) })
byId('market-source').addEventListener('change', () => { if (byId('market-source').value === 'curated') byId('market-search').value = ''; searchMarket({ reset:true }) })
for (const id of ['market-sort', 'market-page-size']) byId(id).addEventListener('change', () => searchMarket({ reset:true }))
byId('market-prev').addEventListener('click', () => searchMarket({ page:Math.max(1, state.market.page - 1) }))
byId('market-next').addEventListener('click', () => searchMarket({ page:state.market.page + 1 }))
function jumpMarketPage() {
  const max = state.market.result && state.market.result.totalPages || 1
  searchMarket({ page:Math.max(1, Math.min(max, Math.floor(Number(byId('market-page-input').value) || 1))) })
}
byId('market-page-go').addEventListener('click', jumpMarketPage)
byId('market-page-input').addEventListener('keydown', (event) => { if (event.key === 'Enter' && !state.market.loading) jumpMarketPage() })
byId('market-open-github').addEventListener('click', () => openSource(marketGithubUrl()))
byId('github-account').addEventListener('click', connectGithub)
byId('refresh-installed').addEventListener('click', () => refreshInstalled().catch((error) => toast(error.message, true)))
byId('refresh-backups').addEventListener('click', () => refreshBackups().catch((error) => toast(error.message, true)))
byId('reset-theme').addEventListener('click', async () => { state.appearance = await api.request('setTheme', { themeId:'midnight' }); applyTheme(state.appearance.theme); renderThemes(); fillEditor(state.appearance.theme) })
byId('save-theme').addEventListener('click', async () => { try { state.appearance = await api.request('saveTheme', { theme:editorTheme(), activate:true }); applyTheme(state.appearance.theme); renderThemes(); toast('自定义主题已保存并全局应用') } catch (error) { toast(error.message, true) } })
byId('preview-theme').addEventListener('click', () => { try { applyTheme(editorTheme()); toast('正在临时预览；刷新页面即可恢复已保存主题') } catch (error) { toast(error.message, true) } })
byId('copy-theme-json').addEventListener('click', async () => { try { await navigator.clipboard.writeText(JSON.stringify(editorTheme(), null, 2)); toast('主题 JSON 已复制') } catch (_) { showInfo('主题 JSON', `<pre class="log">${esc(JSON.stringify(editorTheme(), null, 2))}</pre>`) } })
function showThemeImportResult(appearance) {
  const theme = appearance && appearance.theme || {}
  const compatibility = theme.compatibility || { sourceFormat:'dpa', coverage:100, missingTokens:[] }
  const format = ({ dpa:'DPA 原生', dsh:'DSH', vscode:'VS Code' })[compatibility.sourceFormat] || compatibility.sourceFormat
  const missing = Array.isArray(compatibility.missingTokens) && compatibility.missingTokens.length ? `；${compatibility.missingTokens.length} 项使用 DPA 安全回退值` : ''
  byId('theme-import-result').textContent = `${format} → DPA 全局主题，映射覆盖 ${compatibility.coverage == null ? 100 : compatibility.coverage}%${missing}`
}
byId('import-theme-json').addEventListener('click', async () => { try { const theme = JSON.parse(byId('theme-import-json').value); state.appearance = await api.request('importTheme', { theme, source:'json-import', activate:true }); applyAppearance(state.appearance); renderThemes(); fillEditor(state.appearance.theme); showThemeImportResult(state.appearance); toast('主题已转换、安装并全局应用') } catch (error) { toast(error.message, true) } })
byId('import-theme-file').addEventListener('click', async () => { try { const result = await api.request('chooseThemeFile'); if (result.cancelled) return; state.appearance = result.appearance; applyAppearance(state.appearance); renderThemes(); fillEditor(state.appearance.theme); showThemeImportResult(state.appearance); toast('主题文件已转换并全局应用') } catch (error) { toast(error.message, true) } })
byId('choose-background').addEventListener('click', async () => { try { const result = await api.request('chooseBackgroundImage', backgroundPayload()); if (result.cancelled) return; state.appearance = result.appearance; applyAppearance(state.appearance); fillBackground(state.appearance.background); toast('背景图片已复制并全局应用') } catch (error) { toast(error.message, true) } })
byId('save-background').addEventListener('click', async () => { try { state.appearance = await api.request('setBackground', backgroundPayload()); applyAppearance(state.appearance); fillBackground(state.appearance.background); toast('背景设置已保存并全局应用') } catch (error) { toast(error.message, true) } })
byId('remove-background').addEventListener('click', async () => { try { if (!confirm('移除 DPA 图片背景？主题和字体不会改变。')) return; state.appearance = await api.request('removeBackground'); applyAppearance(state.appearance); fillBackground(state.appearance.background); toast('图片背景已移除') } catch (error) { toast(error.message, true) } })
for (const id of ['background-enabled','background-fit','background-position','background-opacity','background-blur','background-overlay']) byId(id).addEventListener('input', () => { const background = { ...(state.appearance && state.appearance.background || {}), ...backgroundPayload() }; fillBackground(background); applyBackground(background) })
for (const id of ['ui-font','custom-font','mono-font','chat-font','font-size','chat-font-size','line-height','ui-zoom','ctrl-wheel']) byId(id).addEventListener('input', updateFontPreview)
byId('save-typography').addEventListener('click', () => saveTypography(typographyPayload()).catch((error) => toast(error.message, true)))
byId('reset-typography').addEventListener('click', () => saveTypography(TYPOGRAPHY_DEFAULTS).catch((error) => toast(error.message, true)))
window.addEventListener('wheel', (event) => {
  if (!event.ctrlKey || !state.appearance || state.appearance.typography.ctrlWheel === 'off') return
  event.preventDefault()
  postToShell({ type:'capability:zoom-step', direction:event.deltaY < 0 ? 1 : -1 })
}, { passive:false })
window.addEventListener('message', (event) => {
  const data = event.data || {}
  if (!isTrustedShellMessage(event)) return
  if (data.type === 'capability:theme' && data.theme) applyTheme(data.theme, false)
  if (data.type === 'capability:appearance' && data.appearance) { applyAppearance(data.appearance, false); fillTypography(data.appearance.typography); fillBackground(data.appearance.background) }
})
refresh().catch((error) => { byId('runtime-summary').textContent = `扩展中心读取失败：${error.message}`; toast(error.message, true) })
