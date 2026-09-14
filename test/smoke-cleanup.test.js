'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const cleanup = require('../scripts/cleanup-acp-smoke')
for (const prefix of ['dpa-acp-cleanup-', 'dpa-acp-skill-']) {
test(`ACP smoke cleanup removes junctions without modifying dependency targets (${prefix})`, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'dpa-cleanup-sentinel-'))
  const sentinel = path.join(target, 'keep.txt')
  fs.writeFileSync(sentinel, 'preserve dependency')
  fs.mkdirSync(path.join(root, 'profiles', 'node_modules'), { recursive: true })
  fs.symlinkSync(target, path.join(root, 'profiles', 'node_modules', 'dependency'), process.platform === 'win32' ? 'junction' : 'dir')
  cleanup(root)
  assert.equal(fs.existsSync(root), false)
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'preserve dependency')
  fs.unlinkSync(sentinel)
  fs.rmdirSync(target)
})
}
