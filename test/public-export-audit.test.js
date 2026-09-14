'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { inspectPath, inspectText, auditRepository } = require('../scripts/public-export-audit')

test('public export blocks real credential filenames and generated/runtime data paths', () => {
  for (const filename of ['.env', '.env.local', '.credentials.yaml', 'config/github-auth.json']) {
    assert.ok(inspectPath(filename).includes('credential-file'), filename)
  }
  for (const filename of ['dist/DeepSeek-PA.exe', 'node_modules/pkg/index.js', '.dpa-backups/old/main.js', 'dsh-home/clusters/real.json']) {
    assert.ok(inspectPath(filename).includes('private-or-generated-directory'), filename)
  }
  assert.deepEqual(inspectPath('.env.example'), [])
  assert.deepEqual(inspectPath('test/credential-parser.test.js'), [])
  assert.deepEqual(inspectPath('docs/images/demo.png'), [])
})

test('public export permits documentation placeholders and synthetic test keywords', () => {
  const text = [
    'DEEPSEEK_API_KEY and .credentials.yaml are resolved at runtime.',
    'const fixture = { apiKey: "synthetic-key", token: "test-account" }',
    'Use C:' + '\\path\\to\\deepseek-harness',
    'Use C:' + '\\Users\\<username>\\project',
    'Use /home/' + 'test-user/project',
  ].join('\n')
  assert.deepEqual(inspectText(text), [])
})

test('public export identifies actual machine paths including escaped Windows forms without echoing content', () => {
  const personal = 'Z:' + '\\TOBETHEBEST\\private\\project'
  const home = 'C:' + '\\Users\\actual-person\\documents'
  const text = personal + '\n' + JSON.stringify(home)
  const findings = inspectText(text)
  assert.deepEqual(findings.map((item) => item.rule), ['personal-machine-path', 'personal-home-path'])
  assert.deepEqual(findings.map((item) => item.line), [1, 2])
  assert.equal(JSON.stringify(findings).includes('actual-person'), false)
})

test('public export detects high-confidence tokens and private keys but does not return values', () => {
  const token = 'ghp_' + 'A'.repeat(36)
  const provider = 'sk-' + 'B'.repeat(32)
  const pem = '-----BEGIN ' + 'PRIVATE KEY-----'
  const findings = inspectText([token, provider, pem].join('\n'))
  assert.deepEqual(findings.map((item) => item.rule), ['github-token', 'provider-token', 'private-key'])
  assert.equal(JSON.stringify(findings).includes(token), false)
})

test('public export catches forcibly tracked ignored artifacts and unignored new files, skips removed files', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpa-public-audit-'))
  t.after(() => fs.rmSync(root, { recursive:true, force:true }))
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd:root, encoding:'utf8', windowsHide:true })
    assert.equal(result.status, 0, result.stderr)
  }
  git('init', '--quiet')
  fs.writeFileSync(path.join(root, '.gitignore'), 'dist/\n.env\n')
  fs.mkdirSync(path.join(root, 'dist'))
  fs.writeFileSync(path.join(root, 'dist', 'app.exe'), 'fixture')
  fs.writeFileSync(path.join(root, 'removed.js'), 'fixture')
  git('add', '.gitignore', 'removed.js')
  git('add', '--force', 'dist/app.exe')
  fs.unlinkSync(path.join(root, 'removed.js'))
  fs.writeFileSync(path.join(root, 'new-file.js'), 'const token = "' + 'ghp_' + 'A'.repeat(36) + '"')
  const result = auditRepository(root)
  assert.equal(result.ok, false)
  assert.ok(result.findings.some((item) => item.file === 'dist/app.exe' && item.rule === 'private-or-generated-directory'))
  assert.ok(result.findings.some((item) => item.file === 'new-file.js' && item.rule === 'github-token'))
  assert.equal(result.findings.some((item) => item.file === 'removed.js'), false)
  assert.equal(auditRepository(root, { includeUntracked:false }).findings.some((item) => item.file === 'new-file.js'), false)
})
