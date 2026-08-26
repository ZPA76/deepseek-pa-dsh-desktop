'use strict'

const fs = require('fs')
const path = require('path')

const TOKEN_KEYS = Object.freeze([
  'background', 'panel', 'panel2', 'text', 'muted', 'accent', 'accentStrong',
  'line', 'success', 'warning', 'danger', 'hover', 'active', 'shadow',
])

const DEFAULT_BACKGROUND = Object.freeze({
  enabled: false,
  assetName: '',
  fit: 'cover',
  position: 'center',
  opacity: 0.28,
  blur: 0,
  overlay: 0.42,
})

const BACKGROUND_MIME = Object.freeze({
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.gif': 'image/gif',
})

const DSH_TOKEN_MAP = Object.freeze({
  background: ['--dsw-alias-bg-base'],
  panel: ['--dsw-alias-bg-layer-1', '--dsw-specific-sidebar-fill'],
  panel2: ['--dsw-alias-bg-layer-2', '--dsw-specific-input-major'],
  text: ['--dsw-alias-label-primary'],
  muted: ['--dsw-alias-label-secondary', '--dsw-alias-label-tertiary'],
  accent: ['--dsw-alias-brand-primary', '--dsw-alias-state-business-primary'],
  accentStrong: ['--dsw-alias-button-primary-fill', '--dsw-alias-brand-primary'],
  line: ['--dsw-alias-border-l1', '--dsw-alias-border-l2'],
  success: ['--dsw-alias-state-success-primary'],
  warning: ['--dsw-alias-state-warn-primary'],
  danger: ['--dsw-alias-state-error-primary'],
  hover: ['--dsw-alias-interactive-bg-hover', '--dsw-alias-bg-layer-3'],
  active: ['--dsw-alias-interactive-bg-active', '--dsw-alias-bg-layer-3'],
  shadow: ['--dsw-alias-shadow', '--dsw-static-shadow'],
})

const VSCODE_TOKEN_MAP = Object.freeze({
  background: ['editor.background'],
  panel: ['sideBar.background', 'activityBar.background', 'editorWidget.background'],
  panel2: ['input.background', 'dropdown.background', 'editorGroupHeader.tabsBackground'],
  text: ['foreground', 'editor.foreground'],
  muted: ['descriptionForeground', 'sideBar.foreground'],
  accent: ['focusBorder', 'textLink.foreground', 'button.background'],
  accentStrong: ['button.background', 'button.hoverBackground'],
  line: ['panel.border', 'sideBar.border', 'contrastBorder'],
  success: ['testing.iconPassed', 'gitDecoration.addedResourceForeground'],
  warning: ['editorWarning.foreground', 'list.warningForeground'],
  danger: ['editorError.foreground', 'list.errorForeground'],
  hover: ['list.hoverBackground', 'button.secondaryHoverBackground'],
  active: ['list.activeSelectionBackground', 'list.inactiveSelectionBackground'],
})

const FONT_OPTIONS = Object.freeze({
  system: '\"Segoe UI Variable Text\", \"Microsoft YaHei UI\", \"Segoe UI\", sans-serif',
  yahei: '\"Microsoft YaHei UI\", \"Microsoft YaHei\", sans-serif',
  dengxian: 'DengXian, \"Microsoft YaHei UI\", sans-serif',
  noto: '\"Noto Sans CJK SC\", \"Microsoft YaHei UI\", sans-serif',
  sourceHan: '\"Source Han Sans SC\", \"Microsoft YaHei UI\", sans-serif',
  serif: '\"Noto Serif CJK SC\", SimSun, serif',
})
const MONO_FONT_OPTIONS = Object.freeze({
  cascadia: '\"Cascadia Mono\", Consolas, monospace',
  consolas: 'Consolas, \"Microsoft YaHei UI\", monospace',
  jetbrains: '\"JetBrains Mono\", \"Cascadia Mono\", Consolas, monospace',
})
const DEFAULT_TYPOGRAPHY = Object.freeze({
  uiFont: 'system', customFont: '', monoFont: 'cascadia', fontSize: 14,
  lineHeight: 1.5, zoom: 100, ctrlWheel: 'zoom', chatFont: 'inherit', chatFontSize: 15,
})

const BUILTIN_THEMES = Object.freeze([
  theme('midnight', '深夜蓝', 'DPA 默认深色主题', 'dark', {
    background: '#141417', panel: '#1d1f23', panel2: '#24262b', text: '#ececec',
    muted: '#9ea0a3', accent: '#5b9bff', accentStrong: '#3f78f2', line: 'rgba(255,255,255,.12)',
    success: '#4cc38a', warning: '#e7b85c', danger: '#ff7474', hover: '#292b31',
    active: '#32353c', shadow: 'rgba(0,0,0,.36)',
  }),
  theme('ocean', '深海青', '适合长时间工作的低刺激配色', 'dark', {
    background: '#0e1a20', panel: '#14262d', panel2: '#1b343c', text: '#e7fbfa',
    muted: '#9bbdbc', accent: '#39c6c0', accentStrong: '#159d9a', line: 'rgba(105,225,218,.18)',
    success: '#58d6a4', warning: '#e9bf72', danger: '#ff8585', hover: '#203b43',
    active: '#28505a', shadow: 'rgba(0,0,0,.42)',
  }),
  theme('slate', '石墨灰', '高对比度的中性工作台', 'dark', {
    background: '#17191d', panel: '#24272d', panel2: '#30343b', text: '#f2f4f7',
    muted: '#abb2bd', accent: '#b2c1d6', accentStrong: '#7d94b0', line: 'rgba(255,255,255,.18)',
    success: '#73c991', warning: '#dbb86a', danger: '#ef8080', hover: '#363a42',
    active: '#424751', shadow: 'rgba(0,0,0,.38)',
  }),
  theme('warm', '暖白纸', '柔和的浅色工作台', 'light', {
    background: '#f4f0ea', panel: '#fffdf9', panel2: '#ebe5dc', text: '#28241f',
    muted: '#756c61', accent: '#b56b42', accentStrong: '#8e4e2e', line: 'rgba(62,47,33,.16)',
    success: '#38845c', warning: '#a36a13', danger: '#b94a48', hover: '#e5ddd2',
    active: '#d8cbbc', shadow: 'rgba(73,51,30,.18)',
  }),
  theme('github-light', 'GitHub 清晨', '参考 GitHub Primer 的明亮工作台', 'light', {
    background: '#f6f8fa', panel: '#ffffff', panel2: '#f0f3f6', text: '#1f2328',
    muted: '#59636e', accent: '#0969da', accentStrong: '#0550ae', line: '#d0d7de',
    success: '#1a7f37', warning: '#9a6700', danger: '#cf222e', hover: '#eaeef2',
    active: '#d8dee4', shadow: 'rgba(31,35,40,.16)',
  }),
  theme('high-contrast', '高对比度', '面向低视力与强对比审阅', 'dark', {
    background: '#000000', panel: '#0b0b0b', panel2: '#171717', text: '#ffffff',
    muted: '#d7d7d7', accent: '#00e5ff', accentStrong: '#00b8d4', line: '#ffffff',
    success: '#5cff9d', warning: '#ffe86a', danger: '#ff6b6b', hover: '#242424',
    active: '#333333', shadow: 'rgba(0,0,0,.8)',
  }),
])

function theme(id, label, description, colorScheme, tokens) {
  return Object.freeze({
    schemaVersion: 1,
    id,
    label,
    description,
    colorScheme,
    version: '1.0.0',
    author: 'DPA',
    builtIn: true,
    tokens: Object.freeze({ ...tokens }),
    dshTokens: Object.freeze(toDshTokens(tokens)),
  })
}

function toDshTokens(tokens) {
  return {
    '--dsw-alias-bg-base': tokens.background,
    '--dsw-alias-bg-layer-1': tokens.panel,
    '--dsw-alias-bg-layer-2': tokens.panel2,
    '--dsw-alias-bg-layer-3': tokens.active,
    '--dsw-alias-bg-overlay': tokens.panel,
    '--dsw-alias-label-primary': tokens.text,
    '--dsw-alias-label-secondary': tokens.muted,
    '--dsw-alias-label-tertiary': tokens.muted,
    '--dsw-alias-brand-primary': tokens.accent,
    '--dsw-alias-state-business-primary': tokens.accent,
    '--dsw-alias-state-success-primary': tokens.success,
    '--dsw-alias-state-warn-primary': tokens.warning,
    '--dsw-alias-state-error-primary': tokens.danger,
    '--dsw-alias-border-l1': tokens.line,
    '--dsw-alias-border-l2': tokens.line,
    '--dsw-alias-interactive-bg-hover': tokens.hover,
    '--dsw-alias-interactive-bg-active': tokens.active,
    '--dsw-alias-button-primary-fill': tokens.accentStrong,
    '--dsw-alias-button-primary-hover': tokens.accent,
  }
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (_) { return fallback }
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.renameSync(temporary, file)
}

function safeId(value) {
  const id = String(value || '').trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(id)) throw new Error('主题 ID 只能使用 2-64 位小写字母、数字、点、横线或下划线')
  return id
}

function normalizeTypography(input = {}) {
  const uiFont = Object.prototype.hasOwnProperty.call(FONT_OPTIONS, input.uiFont) ? input.uiFont : DEFAULT_TYPOGRAPHY.uiFont
  const monoFont = Object.prototype.hasOwnProperty.call(MONO_FONT_OPTIONS, input.monoFont) ? input.monoFont : DEFAULT_TYPOGRAPHY.monoFont
  const chatFont = input.chatFont === 'inherit' || Object.prototype.hasOwnProperty.call(FONT_OPTIONS, input.chatFont) ? input.chatFont : DEFAULT_TYPOGRAPHY.chatFont
  const customFont = String(input.customFont || '').trim().slice(0, 100)
  if (/[;{}<>]/.test(customFont)) throw new Error('自定义字体名称包含不支持的字符')
  const fontSize = Math.round(Number(input.fontSize == null ? DEFAULT_TYPOGRAPHY.fontSize : input.fontSize))
  const lineHeight = Number(Number(input.lineHeight == null ? DEFAULT_TYPOGRAPHY.lineHeight : input.lineHeight).toFixed(2))
  const zoom = Math.round(Number(input.zoom == null ? DEFAULT_TYPOGRAPHY.zoom : input.zoom))
  const chatFontSize = Math.round(Number(input.chatFontSize == null ? DEFAULT_TYPOGRAPHY.chatFontSize : input.chatFontSize))
  const ctrlWheel = ['zoom', 'font', 'off'].includes(input.ctrlWheel) ? input.ctrlWheel : DEFAULT_TYPOGRAPHY.ctrlWheel
  if (!Number.isFinite(fontSize) || fontSize < 12 || fontSize > 22) throw new Error('界面字号必须在 12–22 px 之间')
  if (!Number.isFinite(chatFontSize) || chatFontSize < 13 || chatFontSize > 22) throw new Error('聊天字号必须在 13–22 px 之间')
  if (!Number.isFinite(lineHeight) || lineHeight < 1.25 || lineHeight > 1.9) throw new Error('行高必须在 1.25–1.90 之间')
  if (!Number.isFinite(zoom) || zoom < 80 || zoom > 200) throw new Error('界面缩放必须在 80%–200% 之间')
  return { uiFont, customFont, monoFont, fontSize, lineHeight, zoom, ctrlWheel, chatFont, chatFontSize }
}

function typographyCss(typography) {
  const value = normalizeTypography(typography)
  const custom = value.customFont ? JSON.stringify(value.customFont) + ', ' : ''
  return {
    ...value,
    fontFamily: custom + FONT_OPTIONS[value.uiFont],
    monoFontFamily: MONO_FONT_OPTIONS[value.monoFont],
    chatFontFamily: value.chatFont === 'inherit' ? custom + FONT_OPTIONS[value.uiFont] : FONT_OPTIONS[value.chatFont],
  }
}

function validateColor(value, key) {
  const text = String(value || '').trim()
  const valid = /^#[0-9a-f]{3,8}$/i.test(text)
    || /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+(?:\s*,\s*[\d.]+)?\s*\)$/i.test(text)
    || /^hsla?\(\s*[-\d.]+(?:deg)?(?:\s*,|\s+)\s*[\d.]+%(?:\s*,|\s+)\s*[\d.]+%(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/i.test(text)
  if (!valid) throw new Error(`主题令牌 ${key} 不是受支持的颜色值`)
  return text
}

function supportedColor(value) {
  try { return validateColor(value, 'source') } catch (_) { return '' }
}

function mappedColor(source, candidates) {
  for (const key of candidates || []) {
    const value = supportedColor(source && source[key])
    if (value) return { key, value }
  }
  return { key: '', value: '' }
}

function detectThemeFormat(input) {
  const tokens = input && input.tokens && typeof input.tokens === 'object' ? input.tokens : {}
  if (TOKEN_KEYS.every((key) => Object.prototype.hasOwnProperty.call(tokens, key))) return 'dpa'
  if (Object.keys(tokens).some((key) => key.startsWith('--dsw-'))) return 'dsh'
  if (input && input.colors && typeof input.colors === 'object') return 'vscode'
  return 'dpa'
}

function convertThemeInput(input) {
  const format = detectThemeFormat(input)
  if (format === 'dpa') return { format, tokens: input.tokens || {}, mapped: TOKEN_KEYS.length, missing: [] }
  const colorScheme = input.colorScheme === 'light' || String(input.type || '').toLowerCase() === 'light' ? 'light' : 'dark'
  const fallback = BUILTIN_THEMES.find((themeValue) => themeValue.colorScheme === colorScheme) || BUILTIN_THEMES[0]
  const source = format === 'dsh' ? input.tokens : input.colors
  const map = format === 'dsh' ? DSH_TOKEN_MAP : VSCODE_TOKEN_MAP
  const tokens = {}
  const missing = []
  let mapped = 0
  for (const key of TOKEN_KEYS) {
    const match = mappedColor(source, map[key])
    if (match.value) {
      tokens[key] = match.value
      mapped += 1
    } else {
      tokens[key] = fallback.tokens[key]
      missing.push(key)
    }
  }
  return { format, tokens, mapped, missing }
}

function normalizeTheme(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('主题文件必须是 JSON 对象')
  const conversion = convertThemeInput(input)
  const suggestedId = String(input.id || input.name || input.label || `imported-${Date.now()}`).toLowerCase().trim()
    .replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
  const id = safeId(suggestedId.length > 1 ? suggestedId : `theme-${Date.now().toString(36)}`)
  const tokens = {}
  for (const key of TOKEN_KEYS) tokens[key] = validateColor(conversion.tokens[key], key)
  const colorScheme = input.colorScheme === 'light' || String(input.type || '').toLowerCase() === 'light' ? 'light' : 'dark'
  const previousCompatibility = input.compatibility && typeof input.compatibility === 'object' ? input.compatibility : null
  const sourceFormat = previousCompatibility && previousCompatibility.sourceFormat || conversion.format
  const compatibility = previousCompatibility || {
    sourceFormat,
    mappedTokens: conversion.mapped,
    totalTokens: TOKEN_KEYS.length,
    coverage: Math.round(conversion.mapped / TOKEN_KEYS.length * 100),
    missingTokens: conversion.missing,
    scope: sourceFormat === 'dpa' ? 'full-dpa' : 'converted-to-dpa',
  }
  return {
    schemaVersion: 2,
    id,
    label: String(input.label || input.name || id).trim().slice(0, 80),
    description: String(input.description || '用户自定义主题').trim().slice(0, 240),
    colorScheme,
    version: String(input.version || '1.0.0').trim().slice(0, 40),
    author: String(input.author || '用户').trim().slice(0, 80),
    source: String(options.source || input.source || 'custom').slice(0, 500),
    builtIn: false,
    tokens,
    dshTokens: toDshTokens(tokens),
    compatibility,
  }
}

function normalizeBackground(input = {}) {
  const source = input && typeof input === 'object' ? input : {}
  const fit = ['cover', 'contain', 'auto', 'repeat'].includes(source.fit) ? source.fit : DEFAULT_BACKGROUND.fit
  const position = ['center', 'top', 'bottom', 'left', 'right'].includes(source.position) ? source.position : DEFAULT_BACKGROUND.position
  const opacity = Number(source.opacity == null ? DEFAULT_BACKGROUND.opacity : source.opacity)
  const blur = Number(source.blur == null ? DEFAULT_BACKGROUND.blur : source.blur)
  const overlay = Number(source.overlay == null ? DEFAULT_BACKGROUND.overlay : source.overlay)
  if (!Number.isFinite(opacity) || opacity < 0.05 || opacity > 1) throw new Error('背景透明度必须在 0.05–1.00 之间')
  if (!Number.isFinite(blur) || blur < 0 || blur > 24) throw new Error('背景模糊必须在 0–24 px 之间')
  if (!Number.isFinite(overlay) || overlay < 0 || overlay > 0.9) throw new Error('背景遮罩必须在 0–0.90 之间')
  const assetName = String(source.assetName || '')
  if (assetName && !/^background\.(?:png|jpe?g|webp|bmp|gif)$/i.test(assetName)) throw new Error('背景资源名称无效')
  return { enabled: Boolean(source.enabled && assetName), assetName, fit, position, opacity, blur, overlay }
}

function createAppearanceService(options = {}) {
  const dataDir = path.resolve(options.dataDir)
  const appearanceFile = path.join(dataDir, 'dpa-appearance.json')
  const themesDir = path.join(dataDir, 'themes')
  const backgroundsDir = path.join(dataDir, 'backgrounds')

  function backgroundState(input) {
    const background = normalizeBackground(input)
    const file = background.assetName ? path.join(backgroundsDir, background.assetName) : ''
    if (!file || !fs.existsSync(file)) return { ...background, enabled: false, dataUrl: '' }
    const extension = path.extname(file).toLowerCase()
    const mime = BACKGROUND_MIME[extension]
    if (!mime) return { ...background, enabled: false, dataUrl: '' }
    return { ...background, dataUrl: `data:${mime};base64,${fs.readFileSync(file).toString('base64')}` }
  }

  function customThemes() {
    if (!fs.existsSync(themesDir)) return []
    const result = []
    for (const entry of fs.readdirSync(themesDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue
      const value = readJson(path.join(themesDir, entry.name), null)
      try { result.push(normalizeTheme(value, { source: value && value.source || 'installed' })) } catch (_) {}
    }
    return result.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
  }

  function themes() {
    const merged = new Map(BUILTIN_THEMES.map((item) => [item.id, item]))
    for (const item of customThemes()) if (!merged.has(item.id)) merged.set(item.id, item)
    return [...merged.values()]
  }

  function state() {
    const saved = readJson(appearanceFile, { themeId: 'midnight', typography: DEFAULT_TYPOGRAPHY, background: DEFAULT_BACKGROUND })
    const all = themes()
    const active = all.find((item) => item.id === saved.themeId) || BUILTIN_THEMES[0]
    const typography = typographyCss({ ...DEFAULT_TYPOGRAPHY, ...(saved.typography || {}) })
    const background = backgroundState({ ...DEFAULT_BACKGROUND, ...(saved.background || {}) })
    return { themeId: active.id, theme: active, themes: all, typography, background, customThemeCount: all.filter((item) => !item.builtIn).length }
  }

  function persist(next = {}) {
    const saved = readJson(appearanceFile, {})
    atomicWriteJson(appearanceFile, {
      themeId: next.themeId || saved.themeId || 'midnight',
      typography: normalizeTypography(next.typography || saved.typography || DEFAULT_TYPOGRAPHY),
      background: normalizeBackground(next.background || saved.background || DEFAULT_BACKGROUND),
      updatedAt: new Date().toISOString(),
    })
  }

  function setTheme(themeId) {
    const active = themes().find((item) => item.id === String(themeId || ''))
    if (!active) throw new Error('主题不存在或已被卸载')
    persist({ themeId: active.id })
    return state()
  }

  function setTypography(payload = {}) {
    const current = state().typography
    persist({ typography: normalizeTypography({ ...current, ...payload }) })
    return state()
  }

  function setBackground(payload = {}) {
    const current = state().background
    let assetName = current.assetName
    if (payload.sourcePath) {
      const sourcePath = path.resolve(String(payload.sourcePath))
      if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) throw new Error('背景图片不存在')
      const extension = path.extname(sourcePath).toLowerCase()
      if (!BACKGROUND_MIME[extension]) throw new Error('背景仅支持 PNG、JPG、WEBP、BMP 或 GIF')
      const size = fs.statSync(sourcePath).size
      if (size > 8 * 1024 * 1024) throw new Error('背景图片不能超过 8 MB')
      fs.mkdirSync(backgroundsDir, { recursive: true })
      assetName = `background${extension === '.jpeg' ? '.jpg' : extension}`
      const target = path.join(backgroundsDir, assetName)
      const temporary = `${target}.tmp-${process.pid}-${Date.now()}`
      fs.copyFileSync(sourcePath, temporary)
      try { fs.renameSync(temporary, target) }
      catch (error) {
        if (!['EEXIST', 'EPERM', 'EACCES'].includes(error.code)) throw error
        fs.copyFileSync(temporary, target)
        fs.rmSync(temporary, { force: true })
      }
      for (const entry of fs.readdirSync(backgroundsDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name !== assetName && /^background\./i.test(entry.name)) fs.rmSync(path.join(backgroundsDir, entry.name), { force: true })
      }
    }
    const background = normalizeBackground({ ...current, ...payload, assetName, enabled: payload.enabled !== false && Boolean(assetName) })
    persist({ background })
    return state()
  }

  function removeBackground() {
    if (fs.existsSync(backgroundsDir)) {
      for (const entry of fs.readdirSync(backgroundsDir, { withFileTypes: true })) {
        if (entry.isFile() && /^background\./i.test(entry.name)) fs.rmSync(path.join(backgroundsDir, entry.name), { force: true })
      }
    }
    persist({ background: DEFAULT_BACKGROUND })
    return state()
  }

  function saveTheme(payload = {}) {
    const normalized = normalizeTheme(payload.theme || payload, { source: payload.source || 'custom-editor' })
    if (BUILTIN_THEMES.some((item) => item.id === normalized.id)) throw new Error('不能覆盖 DPA 内置主题')
    atomicWriteJson(path.join(themesDir, `${normalized.id}.json`), normalized)
    if (payload.activate !== false) setTheme(normalized.id)
    return state()
  }

  function importTheme(payload = {}) {
    let value = payload.theme
    let source = payload.source || 'import'
    if (!value && payload.sourcePath) {
      const sourcePath = path.resolve(String(payload.sourcePath))
      if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) throw new Error('主题文件不存在')
      if (path.extname(sourcePath).toLowerCase() !== '.json') throw new Error('当前只支持导入 JSON 主题')
      value = readJson(sourcePath, null)
      source = sourcePath
    }
    return saveTheme({ theme: value, source, activate: payload.activate })
  }

  function removeTheme(themeId) {
    const id = safeId(themeId)
    if (BUILTIN_THEMES.some((item) => item.id === id)) throw new Error('内置主题不能删除')
    const target = path.join(themesDir, `${id}.json`)
    if (!fs.existsSync(target)) throw new Error('自定义主题不存在')
    const wasActive = state().themeId === id
    fs.rmSync(target, { force: true })
    if (wasActive) setTheme('midnight')
    return state()
  }

  function exportTheme(themeId, destination) {
    const active = themes().find((item) => item.id === String(themeId || ''))
    if (!active) throw new Error('主题不存在')
    const target = path.resolve(String(destination || ''))
    if (!target || path.extname(target).toLowerCase() !== '.json') throw new Error('导出路径必须以 .json 结尾')
    atomicWriteJson(target, active)
    return { ok: true, path: target }
  }

  return { state, setTheme, setTypography, setBackground, removeBackground, saveTheme, importTheme, removeTheme, exportTheme, themes, paths: { appearanceFile, themesDir, backgroundsDir } }
}

module.exports = {
  BUILTIN_THEMES, TOKEN_KEYS, FONT_OPTIONS, MONO_FONT_OPTIONS, DEFAULT_TYPOGRAPHY, DEFAULT_BACKGROUND,
  createAppearanceService, normalizeTheme, normalizeTypography, normalizeBackground, typographyCss, toDshTokens, detectThemeFormat,
}
