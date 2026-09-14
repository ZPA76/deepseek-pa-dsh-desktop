'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const asar = require('@electron/asar')
const { verifyRelease } = require('../scripts/release-integrity')
const { verifyStaging } = require('../scripts/verify-staging')

async function fixture(t, { omit = [], manifest = ['main.js', 'adapter.js', 'package.json'], directoryName = 'dist' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpa-release-integrity-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const packed = path.join(root, 'packed')
  const directory = path.join(root, directoryName)
  fs.mkdirSync(packed, { recursive: true })
  fs.mkdirSync(path.join(directory, 'win-unpacked', 'resources'), { recursive: true })
  const pkg = { name: 'deepseek-pa', version: '0.6.0', main: 'main.js', build: { files: manifest } }
  const sources = { 'main.js': "require('./adapter')", 'adapter.js': 'module.exports = {}', 'package.json': JSON.stringify(pkg) }
  for (const [file, text] of Object.entries(sources)) {
    fs.writeFileSync(path.join(root, file), text)
    if (!omit.includes(file)) fs.writeFileSync(path.join(packed, file), text)
  }
  fs.writeFileSync(path.join(directory, 'win-unpacked', 'DeepSeek-PA.exe'), 'fixture executable')
  await asar.createPackage(packed, path.join(directory, 'win-unpacked', 'resources', 'app.asar'))
  return { root, directory }
}

test('release archive rejects a missing adapter before promotion', async t => {
  const f = await fixture(t, { omit: ['adapter.js'] })
  assert.throws(() => verifyRelease(f.root, f.directory), /app.asar 缺少模块：adapter.js/)
})
test('release archive rejects stale source even if file timestamps match', async t => {
  const f = await fixture(t)
  fs.writeFileSync(path.join(f.root, 'adapter.js'), 'module.exports = { changed: true }')
  assert.throws(() => verifyRelease(f.root, f.directory), /源码内容不一致：adapter.js/)
})
test('release manifest rejects an undeclared relative runtime dependency', async t => {
  const f = await fixture(t, { manifest: ['main.js', 'package.json'] })
  assert.throws(() => verifyRelease(f.root, f.directory), /未打包模块：adapter.js/)
})
test('release metadata verifies the exact archived package and version', async t => {
  const f = await fixture(t)
  const result = verifyRelease(f.root, f.directory)
  fs.writeFileSync(path.join(f.directory, 'release.json'), JSON.stringify(result))
  assert.equal(verifyRelease(f.root, f.directory, { requireMetadata: true }).version, '0.6.0')
  fs.writeFileSync(path.join(f.directory, 'release.json'), JSON.stringify({ ...result, archiveSha256: 'stale' }))
  assert.throws(() => verifyRelease(f.root, f.directory, { requireMetadata: true }), /SHA256/)
})

test('staging verifier checks the directory build without requiring promoted release metadata', async t => {
  const f = await fixture(t, { directoryName: 'dist-staging' })
  assert.equal(verifyStaging(f.root).version, '0.6.0')
})

test('external ACP config resources must exist outside ASAR and match source', async t => {
  const f = await fixture(t)
  const pkgFile = path.join(f.root, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
  pkg.build.files.push('dpa-acp.patch.yml')
  pkg.build.extraResources = [{ from: 'dpa-acp.patch.yml', to: 'dpa-acp.patch.yml' }]
  fs.writeFileSync(pkgFile, JSON.stringify(pkg))
  fs.writeFileSync(path.join(f.root, 'dpa-acp.patch.yml'), 'plugins: {}')
  assert.throws(() => verifyRelease(f.root, f.directory), /缺少外部资源/)
  const external = path.join(f.directory, 'win-unpacked', 'resources', 'dpa-acp.patch.yml')
  fs.writeFileSync(external, 'plugins: {}')
  assert.equal(verifyRelease(f.root, f.directory).version, '0.6.0')
  fs.writeFileSync(external, 'plugins: stale')
  assert.throws(() => verifyRelease(f.root, f.directory), /源码内容不一致/)
})

test('production dependencies are resolved with native archive path separators', async t => {
  const f = await fixture(t)
  const pkgFile = path.join(f.root, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
  pkg.dependencies = { yaml: '2.8.1' }
  fs.writeFileSync(pkgFile, JSON.stringify(pkg))
  const nested = path.join(f.root, 'packed', 'node_modules', 'yaml')
  fs.mkdirSync(nested, { recursive: true })
  fs.writeFileSync(path.join(nested, 'package.json'), JSON.stringify({ name: 'yaml', version: '2.8.1' }))
  const archive = path.join(f.directory, 'win-unpacked', 'resources', 'app.asar')
  await asar.createPackage(path.join(f.root, 'packed'), archive)
  asar.uncache(archive)
  assert.equal(verifyRelease(f.root, f.directory).version, '0.6.0')
})
