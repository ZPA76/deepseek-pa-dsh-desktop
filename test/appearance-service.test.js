'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createAppearanceService, normalizeTheme, normalizeTypography } = require('../appearance-service.js')

function customTheme(id = 'test-theme') {
  return {
    id, label:'测试主题', description:'用于自动化测试', colorScheme:'dark', version:'1.0.0', author:'DPA test',
    tokens: {
      background:'#101114', panel:'#181a20', panel2:'#22252d', text:'#f4f5f7', muted:'#a0a5af',
      accent:'#6ea8fe', accentStrong:'#4d8ff7', line:'rgba(255,255,255,.12)', success:'#65c78d',
      warning:'#e7b75f', danger:'#ef7b7b', hover:'#292d35', active:'#343945', shadow:'rgba(0,0,0,.35)',
    },
  }
}

test('全局主题服务支持自定义主题的保存、持久化和删除回退', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpa-theme-'))
  try {
    const appearance = createAppearanceService({ dataDir:root })
    assert.equal(appearance.state().themeId, 'midnight')
    const saved = appearance.saveTheme({ theme:customTheme(), activate:true })
    assert.equal(saved.themeId, 'test-theme')
    assert.equal(saved.theme.dshTokens['--dsw-alias-bg-base'], '#101114')
    const reloaded = createAppearanceService({ dataDir:root })
    assert.equal(reloaded.state().themeId, 'test-theme')
    const removed = reloaded.removeTheme('test-theme')
    assert.equal(removed.themeId, 'midnight')
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'dpa-appearance.json'), 'utf8')).themeId, 'midnight')
  } finally { fs.rmSync(root, { recursive:true, force:true }) }
})

test('字体、字号、行高和缩放独立于主题持久化', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpa-typography-'))
  try {
    const appearance = createAppearanceService({ dataDir:root })
    appearance.setTheme('warm')
    const saved = appearance.setTypography({ uiFont:'yahei', monoFont:'consolas', fontSize:17, lineHeight:1.65, zoom:125, ctrlWheel:'font', chatFont:'yahei', chatFontSize:18 })
    assert.equal(saved.themeId, 'warm')
    assert.equal(saved.typography.fontSize, 17)
    assert.equal(saved.typography.zoom, 125)
    assert.equal(saved.typography.chatFont, 'yahei')
    assert.equal(saved.typography.chatFontSize, 18)
    assert.match(saved.typography.fontFamily, /Microsoft YaHei UI/)
    const reloaded = createAppearanceService({ dataDir:root }).state()
    assert.equal(reloaded.themeId, 'warm')
    assert.equal(reloaded.typography.ctrlWheel, 'font')
    assert.throws(() => normalizeTypography({ fontSize:30 }), /12–22/)
    assert.throws(() => normalizeTypography({ chatFontSize:30 }), /13–22/)
    assert.throws(() => appearance.setTypography({ customFont:'bad;font' }), /不支持/)
  } finally { fs.rmSync(root, { recursive:true, force:true }) }
})

test('主题校验拒绝不完整令牌和可执行 CSS 值', () => {
  const theme = customTheme('unsafe-theme')
  delete theme.tokens.text
  assert.throws(() => normalizeTheme(theme), /text/)
  theme.tokens.text = 'url(https://example.com/a.css)'
  assert.throws(() => normalizeTheme(theme), /text/)
})

test('扩展中心公开完整字体与缩放控件，并接入全局外观广播', () => {
  const root = path.join(__dirname, '..')
  const html = fs.readFileSync(path.join(root, 'capabilities.html'), 'utf8')
  const script = fs.readFileSync(path.join(root, 'capabilities.js'), 'utf8')
  for (const id of ['ui-font','custom-font','mono-font','chat-font','font-size','chat-font-size','line-height','ui-zoom','ctrl-wheel','save-typography','reset-typography','choose-background','save-background','remove-background','background-enabled','background-fit','background-position','background-opacity','background-blur','background-overlay','import-theme-file']) {
    assert.match(html, new RegExp('id="' + id + '"'))
  }
  assert.match(script, /setTypography/)
  assert.match(script, /capability:appearance/)
  assert.match(script, /capability:zoom-step/)
  assert.match(script, /chooseThemeFile/)
  assert.match(script, /chooseBackgroundImage/)
  assert.match(script, /applyBackground/)
})

test('DSH ThemeDefinition 会转换、持久化并落地为 DPA 全局主题', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpa-dsh-theme-'))
  try {
    const appearance = createAppearanceService({ dataDir:root })
    const imported = appearance.importTheme({ theme:{
      id:'dsh-ocean-test', name:'DSH Ocean Test', colorScheme:'dark',
      tokens:{
        '--dsw-alias-bg-base':'#07161d', '--dsw-alias-bg-layer-1':'#0c222c', '--dsw-alias-bg-layer-2':'#12303d',
        '--dsw-alias-label-primary':'#edfafa', '--dsw-alias-label-secondary':'#9bbec4', '--dsw-alias-brand-primary':'#34c3d6',
        '--dsw-alias-button-primary-fill':'#168ca0', '--dsw-alias-border-l1':'#31505a', '--dsw-alias-state-success-primary':'#56c596',
        '--dsw-alias-state-warn-primary':'#e0b868', '--dsw-alias-state-error-primary':'#ef7373',
        '--dsw-alias-interactive-bg-hover':'#173844', '--dsw-alias-interactive-bg-active':'#204a58',
      },
    }, source:'dsh-test', activate:true })
    assert.equal(imported.themeId, 'dsh-ocean-test')
    assert.equal(imported.theme.tokens.background, '#07161d')
    assert.equal(imported.theme.compatibility.sourceFormat, 'dsh')
    assert.equal(imported.theme.compatibility.scope, 'converted-to-dpa')
    assert.ok(imported.theme.compatibility.coverage >= 80)
    assert.equal(createAppearanceService({ dataDir:root }).state().themeId, 'dsh-ocean-test')
  } finally { fs.rmSync(root, { recursive:true, force:true }) }
})

test('图片背景独立于主题持久化，移除后不改变主题或字体', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpa-background-'))
  try {
    const source = path.join(root, 'sample.png')
    fs.writeFileSync(source, Buffer.from('89504e470d0a1a0a', 'hex'))
    const appearance = createAppearanceService({ dataDir:root })
    appearance.setTheme('ocean')
    appearance.setTypography({ fontSize:16 })
    const saved = appearance.setBackground({ sourcePath:source, fit:'contain', opacity:.4, blur:3, overlay:.25 })
    assert.equal(saved.background.enabled, true)
    assert.match(saved.background.dataUrl, /^data:image\/png;base64,/)
    assert.equal(saved.background.fit, 'contain')
    const removed = appearance.removeBackground()
    assert.equal(removed.background.enabled, false)
    assert.equal(removed.themeId, 'ocean')
    assert.equal(removed.typography.fontSize, 16)
  } finally { fs.rmSync(root, { recursive:true, force:true }) }
})