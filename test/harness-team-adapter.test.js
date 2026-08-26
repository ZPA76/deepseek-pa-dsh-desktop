'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { detectHarnessTeam, selectClusterRuntime } = require('../harness-team-adapter.js')

test('Agent Team 适配层检测上游能力并默认回退到 DPA 执行器', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpa-team-'))
  try {
    fs.mkdirSync(path.join(root, 'packages', 'experimental', 'agent-team'), { recursive: true })
    fs.mkdirSync(path.join(root, 'packages', 'experimental', 'tool-agent-team'), { recursive: true })
    assert.equal(detectHarnessTeam(root).supported, true)
    assert.equal(selectClusterRuntime(root, 'dpa').id, 'dpa')
    assert.equal(selectClusterRuntime(root, 'harness-team').id, 'harness-team')
    assert.equal(selectClusterRuntime(path.join(root, 'missing'), 'harness-team').id, 'dpa')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
