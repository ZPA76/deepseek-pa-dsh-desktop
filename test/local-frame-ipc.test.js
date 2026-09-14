'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { actionId } = require('../cluster-runtime')

const root = path.join(__dirname, '..')

test('action identifiers use a deterministic SHA-256 prefix', () => {
  const input = 'run-1:task-2'
  const expected = crypto.createHash('sha256').update(input).digest('hex').slice(0, 24)
  assert.equal(actionId(input), expected)
  assert.match(actionId(input), /^[a-f0-9]{24}$/)
})

test('local iframe IPC pins file targets and authenticates the expected frame URL', () => {
  const sources = ['shell.html', 'cluster-ui.js', 'capabilities.js'].map((file) => ({
    file,
    text: fs.readFileSync(path.join(root, file), 'utf8'),
  }))
  for (const source of sources) {
    assert.doesNotMatch(source.text, /postMessage\([\s\S]{0,300}?,\s*['"]\*['"]\s*\)/, `${source.file} must not use a wildcard postMessage target`)
    assert.match(source.text, /LOCAL_FILE_TARGET_ORIGIN\s*=\s*['"]file:\/\/['"]/, `${source.file} must pin the file target origin`)
    assert.match(source.text, /LOCAL_FILE_EVENT_ORIGIN\s*=\s*['"]null['"]/, `${source.file} must account for Chromium's opaque file event origin`)
  }
  const shell = sources.find((source) => source.file === 'shell.html').text
  assert.match(shell, /event\.source === frame\.contentWindow/)
  assert.match(shell, /frame\.contentWindow\.location\.href === expectedUrl/)
  for (const file of ['cluster-ui.js', 'capabilities.js']) {
    const child = sources.find((source) => source.file === file).text
    assert.match(child, /event\.source !== window\.parent/)
    assert.match(child, /window\.parent\.location\.href === SHELL_URL/)
  }
})
