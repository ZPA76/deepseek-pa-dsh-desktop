'use strict'

// Read-only export gate. Matches are never printed: reports identify only the
// relative filename, line number and rule so CI logs cannot disclose a secret.
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const PRIVATE_DIRECTORIES = new Set([
  'node_modules', 'dist', 'dist-staging', 'dist-rebuilt', '.dpa-backups',
  'app-src', '.runtime', 'dsh-home', 'dsh-desktop-data', '.sessions',
  '.agent-presets', '.cache', 'secrets', '.visual-check',
])
const PRIVATE_FILES = new Set([
  '.credentials.yaml', '.credentials.yml', 'auth.json', 'github-auth.json',
  'github-credentials.json', 'credentials.json', 'state.sqlite',
])
const GENERATED_EXTENSION = /\.(?:exe|dll|asar|zip|7z|tar|tgz|gz|dump|dmp|sqlite|db|pfx|p12|key)$/i
const ROOT_DATA_DIRECTORY = /^(?:logs|caches|sessions|clusters|workspaces|\.tmp-[^/]+)\//i
const MAX_TEXT_BYTES = 5 * 1024 * 1024
const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|ico|avif)$/i

function inspectPath(filename) {
  const normalized = String(filename).replace(/\\/g, '/')
  const segments = normalized.toLowerCase().split('/')
  const basename = segments.at(-1)
  const issues = []
  if (segments.some((segment) => PRIVATE_DIRECTORIES.has(segment)) || ROOT_DATA_DIRECTORY.test(normalized)) {
    issues.push('private-or-generated-directory')
  }
  if (PRIVATE_FILES.has(basename) || (/^\.env(?:\.|$)/i.test(basename) && !/^\.env\.(?:example|sample|template)$/i.test(basename))) {
    issues.push('credential-file')
  }
  if (GENERATED_EXTENSION.test(basename) || /\.(?:log|tmp)$/i.test(basename)) issues.push('generated-or-sensitive-artifact')
  return issues
}

function inspectText(text) {
  const findings = []
  const rules = [
    ['personal-machine-path', /[a-z]:[\\/]+(?:TOBETHEBEST|CodexData)(?:[\\/]|$)/i],
    ['personal-home-path', /(?:[a-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+|\/(?:Users|home)\/)(?!Public(?:[\\/]|$)|Default(?:[\\/]|$)|(?:example|demo|test-user|your-user|username)(?:[\\/]|$)|<)[^\\/<>"'\s]+[\\/]/i],
    ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
    ['provider-token', /\bsk-(?:(?:proj|svcacct)-)?[A-Za-z0-9_-]{32,}\b/],
    ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ]
  for (const [index, line] of String(text).split(/\r?\n/).entries()) {
    // JSON/JS escaped Windows paths are still actual machine-specific paths.
    const normalized = line.replace(/\\\\/g, '\\')
    for (const [rule, pattern] of rules) {
      if (pattern.test(normalized)) findings.push({ line:index + 1, rule })
    }
  }
  return findings
}

function listExportFiles(root, includeUntracked = true) {
  const args = ['ls-files', '--cached', ...(includeUntracked ? ['--others', '--exclude-standard'] : []), '-z']
  const result = spawnSync('git', args, { cwd:root, encoding:'utf8', windowsHide:true, maxBuffer:16 * 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error('Could not list public export files. Run this audit inside the Git repository.')
  return [...new Set(result.stdout.split('\0').filter(Boolean))].sort()
}

function auditRepository(root, options = {}) {
  const directory = path.resolve(root)
  const findings = []
  let checked = 0
  for (const filename of listExportFiles(directory, options.includeUntracked !== false)) {
    const target = path.resolve(directory, filename)
    if (!target.startsWith(directory + path.sep)) {
      findings.push({ file:filename, rule:'path-outside-repository' })
      continue
    }
    let stat
    try { stat = fs.lstatSync(target) } catch (error) {
      if (error.code === 'ENOENT') continue // A pending tracked deletion is not part of the next export.
      throw new Error('Could not inspect an export file.')
    }
    checked++
    const pathIssues = inspectPath(filename)
    for (const rule of pathIssues) findings.push({ file:filename, rule })
    if (stat.isSymbolicLink()) {
      findings.push({ file:filename, rule:'symlink-requires-public-export-review' })
      continue
    }
    if (!stat.isFile() || pathIssues.length) continue
    // Screenshot privacy is reviewed separately; do not interpret image bytes as source text.
    if (IMAGE_EXTENSION.test(filename)) continue
    if (stat.size > MAX_TEXT_BYTES) {
      findings.push({ file:filename, rule:'oversized-source-file' })
      continue
    }
    const content = fs.readFileSync(target)
    if (content.includes(0)) {
      findings.push({ file:filename, rule:'unexpected-binary-file' })
      continue
    }
    for (const finding of inspectText(content.toString('utf8'))) findings.push({ file:filename, ...finding })
  }
  return { ok:findings.length === 0, checked, findings }
}

if (require.main === module) {
  try {
    const result = auditRepository(path.resolve(__dirname, '..'))
    if (result.ok) console.log('Public export audit passed: ' + result.checked + ' source files checked.')
    else {
      console.error('Public export audit failed. Matched contents are intentionally omitted:')
      for (const finding of result.findings) console.error(finding.file + (finding.line ? ':' + finding.line : '') + ' [' + finding.rule + ']')
      process.exitCode = 1
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

module.exports = { inspectPath, inspectText, listExportFiles, auditRepository }
