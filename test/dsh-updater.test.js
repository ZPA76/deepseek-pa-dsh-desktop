'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { compareVersions, latestTagFromLsRemote, parseVersion } = require('../dsh-updater.js')

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
