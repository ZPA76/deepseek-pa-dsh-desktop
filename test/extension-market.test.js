'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createExtensionMarket, inferKind, safePluginSpec } = require('../extension-market.js')

test('扩展来源只接受 npm 与 GitHub 安全格式', () => {
  assert.equal(safePluginSpec('dshmarket'), 'dshmarket')
  assert.equal(safePluginSpec('github:dsh-market/dsh-market#abc123'), 'github:dsh-market/dsh-market#abc123')
  assert.throws(() => safePluginSpec('dshmarket & calc.exe'), /不受支持|危险/)
  assert.equal(inferKind({ name:'catppuccin-theme', description:'theme for harness', topics:[] }), 'theme')
  assert.equal(inferKind({ name:'review-skill', description:'agent skill', topics:[] }), 'skill')
})

test('插件变更先创建快照，命令失败时恢复原 profile', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpa-market-'))
  const dataDir = path.join(root, 'data')
  const dshHome = path.join(root, 'home')
  const harnessDir = path.join(root, 'harness')
  const profile = path.join(dshHome, 'profiles', 'web')
  fs.mkdirSync(profile, { recursive:true }); fs.mkdirSync(harnessDir, { recursive:true })
  const manifest = path.join(profile, 'package.json')
  fs.writeFileSync(manifest, JSON.stringify({ dependencies:{ existing:'1.0.0' } }), 'utf8')
  try {
    const market = createExtensionMarket({
      dataDir, dshHome, harnessDir,
      runner:async () => {
        fs.writeFileSync(manifest, JSON.stringify({ dependencies:{ broken:'9.9.9' } }), 'utf8')
        const error = new Error('模拟安装失败'); error.result = { output:'failure' }; throw error
      },
    })
    await assert.rejects(() => market.mutate({ action:'add', spec:'dshmarket', confirmed:true }), /已恢复/)
    assert.deepEqual(JSON.parse(fs.readFileSync(manifest, 'utf8')).dependencies, { existing:'1.0.0' })
    assert.equal(market.backups().length, 1)
  } finally { fs.rmSync(root, { recursive:true, force:true }) }
})

test('未确认的插件安装只返回预检，不执行命令', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpa-market-confirm-'))
  let called = false
  try {
    const market = createExtensionMarket({ dataDir:path.join(root,'data'), dshHome:path.join(root,'home'), harnessDir:path.join(root,'harness'), runner:async () => { called = true; return { code:0, output:'' } } })
    const result = await market.mutate({ action:'add', spec:'dshmarket' })
    assert.equal(result.requiresConfirmation, true)
    assert.equal(called, false)
  } finally { fs.rmSync(root, { recursive:true, force:true }) }
})


test('插件命令成功但 profile 清单损坏时也会自动恢复', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpa-market-health-'))
  const dshHome = path.join(root, 'dsh-home')
  const profileRoot = path.join(dshHome, 'profiles', 'web')
  fs.mkdirSync(profileRoot, { recursive: true })
  fs.writeFileSync(path.join(profileRoot, 'package.json'), JSON.stringify({ dependencies: { stable: '1.0.0' } }))
  const market = createExtensionMarket({
    dataDir: path.join(root, 'data'), dshHome, harnessDir: root,
    runner: async () => {
      fs.writeFileSync(path.join(profileRoot, 'package.json'), '{invalid json')
      return { code: 0, output: 'installed' }
    },
  })
  await assert.rejects(
    market.mutate({ action: 'add', spec: 'example-plugin', confirmed: true }),
    /已恢复变更前的 web profile/,
  )
  const restored = JSON.parse(fs.readFileSync(path.join(profileRoot, 'package.json'), 'utf8'))
  assert.equal(restored.dependencies.stable, '1.0.0')
})
