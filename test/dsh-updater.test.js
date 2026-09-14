'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DshUpdater, compareVersions, latestTagFromLsRemote, parseVersion, validateBuildArtifacts } = require('../dsh-updater.js')

test('DSH 版本解析支持候选版和正式版', () => {
  assert.equal(parseVersion('dsh-v0.1.0-rc.8').prerelease.join('.'), 'rc.8')
  assert.equal(parseVersion('0.2.0').major, 0)
  assert.equal(parseVersion('not-a-version'), null)
})

test('DSH 更新排序遵循 SemVer 候选版规则', () => {
  assert.ok(compareVersions('dsh-v0.1.0-rc.8', '0.1.0-rc.5') > 0)
  assert.ok(compareVersions('0.1.0', '0.1.0-rc.8') > 0)
  assert.ok(compareVersions('0.2.0-rc.1', '0.1.9') > 0)
  assert.equal(compareVersions('v1.2.3', '1.2.3'), 0)
})

test('从 git 远程标签中选择最新 DSH 版本', () => {
  const output = [
    'aaa\trefs/tags/dsh-v0.1.0-rc.5',
    'bbb\trefs/tags/unrelated-v9.0.0',
    'ccc\trefs/tags/dsh-v0.1.0-rc.8',
    'ddd\trefs/tags/dsh-v0.1.0-rc.7',
  ].join('\n')
  assert.equal(latestTagFromLsRemote(output), 'dsh-v0.1.0-rc.8')
})

test('DSH artifact validation follows client manifests and rejects missing entries', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-artifacts-'))
  const webDist = path.join(root, 'apps', 'web', 'dist')
  const clientPackage = path.join(root, 'packages', 'client', 'ui-demo')
  fs.mkdirSync(webDist, { recursive: true })
  fs.mkdirSync(path.join(clientPackage, 'lib'), { recursive: true })
  fs.writeFileSync(path.join(webDist, 'index.html'), '<!doctype html>')
  fs.writeFileSync(path.join(clientPackage, 'package.json'), JSON.stringify({
    name: '@dsh/ui-demo',
    exports: { './client': { default: './lib/client.js' } },
    dsh: { client: { platform: 'web' } },
  }))
  fs.writeFileSync(path.join(clientPackage, 'lib', 'client.js'), 'module.exports = {}')
  try {
    assert.equal(validateBuildArtifacts(root).requiredCount, 1)
    fs.unlinkSync(path.join(clientPackage, 'lib', 'client.js'))
    assert.throws(() => validateBuildArtifacts(root), /client entry files are missing/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('DSH updater persists and clears an interruption-safe transaction journal', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-transaction-'))
  const logDir = path.join(root, 'logs')
  const updater = new DshUpdater({ harnessDir: root, logDir })
  const before = { commit: 'a'.repeat(40), version: '0.1.1-rc.2', clean: true }
  try {
    assert.equal(updater.readTransaction(), null)
    let transaction = updater.writeTransaction({ status: 'in-progress', phase: 'backup', requestedTag: 'dsh-v0.1.2-alpha.1', before })
    assert.equal(updater.readTransaction().before.commit, before.commit)
    transaction = updater.updateTransaction(transaction, 'install')
    assert.equal(updater.readTransaction().phase, 'install')
    updater.clearTransaction()
    assert.equal(updater.readTransaction(), null)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('DSH updater refuses a corrupted recovery transaction without touching Git', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-corrupt-transaction-'))
  const logDir = path.join(root, 'logs')
  fs.mkdirSync(logDir, { recursive: true })
  fs.writeFileSync(path.join(logDir, 'dsh-update-transaction.json'), '{broken json', 'utf8')
  const updater = new DshUpdater({ harnessDir: root, logDir })
  try {
    await assert.rejects(updater.recoverInterruptedUpdate(), /transaction is corrupted/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})