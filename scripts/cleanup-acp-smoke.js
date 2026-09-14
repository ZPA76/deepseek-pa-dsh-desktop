'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
module.exports = function cleanupAcpSmoke(directory) {
  if (process.platform !== 'win32') return fs.rmSync(directory, { recursive: true, force: true })
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'cleanup-acp-smoke.ps1'), '-Directory', directory], { windowsHide: true, encoding: 'utf8' })
  if (result.error || result.status !== 0) throw new Error('Isolated smoke cleanup failed: ' + (result.error?.message || result.stderr))
}
