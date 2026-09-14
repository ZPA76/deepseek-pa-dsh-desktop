'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { parseAuthenticatedDshUrl, redactDshTokens } = require('../dsh-web-auth.js')

test('DSH authentication URL is accepted only for the configured local origin', () => {
  const token = 'a'.repeat(48)
  const output = 'booting\ndsh web: http://127.0.0.1:3080/?token=' + token + '\nready\n'
  assert.equal(parseAuthenticatedDshUrl(output, 'http://127.0.0.1:3080'), 'http://127.0.0.1:3080/?token=' + token)
  assert.equal(parseAuthenticatedDshUrl('dsh web: http://evil.example/?token=' + token, 'http://127.0.0.1:3080'), null)
  assert.equal(parseAuthenticatedDshUrl('dsh web: http://127.0.0.1:3080/?token=short', 'http://127.0.0.1:3080'), null)
})

test('DSH launch tokens are redacted before diagnostic buffering', () => {
  const input = 'dsh web: http://127.0.0.1:3080/?token=super-secret-value-1234567890'
  const redacted = redactDshTokens(input)
  assert.doesNotMatch(redacted, /super-secret/)
  assert.match(redacted, /token=\[redacted\]/)
})
test('desktop shell loads the validated authentication URL instead of a bare web root', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const root = path.join(__dirname, '..')
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8')
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8')
  const shell = fs.readFileSync(path.join(root, 'shell.html'), 'utf8')
  assert.match(main, /redactDshTokens\(output\)/)
  assert.match(main, /parseAuthenticatedDshUrl\(serverOutputBuffer, SERVER_URL\)/)
  assert.match(preload, /authenticatedUrl: \(\) => ipcRenderer\.invoke\('dsh:authenticated-url'\)/)
  assert.match(shell, /<webview id="view" src="about:blank"><\/webview>/)
  assert.match(shell, /serverAPI\.authenticatedUrl\(\)/)
})