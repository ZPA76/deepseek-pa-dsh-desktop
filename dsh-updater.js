'use strict'

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const TAG_PREFIX = 'dsh-v'

function parseVersion(value) {
  const match = String(value || '').trim().match(/^(?:dsh-v|v)?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/)
  if (!match) return null
  return {
    raw: match[0],
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

function compareIdentifiers(left, right) {
  const leftNumber = /^\d+$/.test(left) ? Number(left) : null
  const rightNumber = /^\d+$/.test(right) ? Number(right) : null
  if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber
  if (leftNumber !== null) return -1
  if (rightNumber !== null) return 1
  return left.localeCompare(right)
}

function compareVersions(leftValue, rightValue) {
  const left = parseVersion(leftValue)
  const right = parseVersion(rightValue)
  if (!left || !right) throw new Error(`无法比较 DSH 版本：${leftValue} / ${rightValue}`)
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] - right[key]
  }
  if (!left.prerelease.length && right.prerelease.length) return 1
  if (left.prerelease.length && !right.prerelease.length) return -1
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    if (left.prerelease[index] === undefined) return -1
    if (right.prerelease[index] === undefined) return 1
    const compared = compareIdentifiers(left.prerelease[index], right.prerelease[index])
    if (compared !== 0) return compared
  }
  return 0
}

function latestTagFromLsRemote(output) {
  const tags = String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/)[1] || '')
    .map((ref) => ref.replace(/^refs\/tags\//, ''))
    .filter((tag) => tag.startsWith(TAG_PREFIX) && parseVersion(tag))
  return tags.sort(compareVersions).at(-1) || null
}

function readPackageVersion(harnessDir) {
  const packagePath = path.join(harnessDir, 'package.json')
  if (!fs.existsSync(packagePath)) throw new Error(`DSH 运行时不完整：缺少 ${packagePath}`)
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
  if (!parseVersion(pkg.version)) throw new Error(`DSH 版本格式无效：${pkg.version || '未知'}`)
  return String(pkg.version)
}

function resolveExportTarget(value) {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return null
  return value.default || value.require || value.import || value.node || null
}

function findClientPackageManifests(harnessDir) {
  const root = path.join(harnessDir, 'packages', 'client')
  if (!fs.existsSync(root)) return []
  const manifests = []
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(entryPath)
      else if (entry.isFile() && entry.name === 'package.json') manifests.push(entryPath)
    }
  }
  visit(root)
  return manifests
}

function validateBuildArtifacts(harnessDir) {
  const root = path.resolve(harnessDir)
  const webEntryCandidates = [
    path.join(root, 'apps', 'web', 'dist', 'index.html'),
    path.join(root, 'packages', 'client', 'web', 'lib', 'index.js'),
  ]
  const webEntry = webEntryCandidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).size > 0)
  if (!webEntry) throw new Error("DSH build artifacts incomplete: web client entry not found; checked " + webEntryCandidates.join(", "))

  const recordPath = path.join(root, '.dsh-build', 'client-build-environment.json')
  if (fs.existsSync(recordPath)) {
    let buildRecord
    try {
      buildRecord = JSON.parse(fs.readFileSync(recordPath, 'utf8'))
    } catch (error) {
      throw new Error('DSH build record is corrupted: ' + recordPath + ' (' + error.message + ')')
    }
    const fileCount = Number(buildRecord && buildRecord.artifacts && buildRecord.artifacts.fileCount)
    if (!Number.isFinite(fileCount) || fileCount <= 0) throw new Error('DSH build record has no client files: ' + recordPath)
  }

  const required = []
  for (const manifestPath of findClientPackageManifests(root)) {
    let manifest
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    } catch (error) {
      throw new Error('DSH client package manifest is corrupted: ' + manifestPath + ' (' + error.message + ')')
    }
    const clientConfig = manifest && manifest.dsh && manifest.dsh.client
    const exportTarget = manifest && manifest.exports && manifest.exports['./client']
    if (!clientConfig || !exportTarget) continue
    const target = resolveExportTarget(exportTarget)
    if (!target || !target.startsWith('./')) continue
    required.push({
      package: manifest.name || path.basename(path.dirname(manifestPath)),
      path: path.resolve(path.dirname(manifestPath), target),
    })
  }
  if (!required.length) throw new Error('DSH build artifacts incomplete: no dsh.client package with ./client export found')
  const missing = required.filter((item) => !fs.existsSync(item.path) || fs.statSync(item.path).size === 0)
  if (missing.length) {
    const detail = missing.slice(0, 12).map((item) => item.package + ': ' + item.path).join('\n')
    const suffix = missing.length > 12 ? '\n... and ' + (missing.length - 12) + ' more' : ''
    throw new Error('DSH build artifacts incomplete: ' + missing.length + ' client entry files are missing\n' + detail + suffix)
  }
  return {
    harnessDir: root,
    webEntry,
    requiredCount: required.length,
    required: required.map((item) => item.path),
    buildRecord: fs.existsSync(recordPath) ? recordPath : null,
  }
}

function runProcess(command, args, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 120000)
  const usesCmdShim = process.platform === 'win32' && /\.cmd$/i.test(command)
  const executable = usesCmdShim ? (process.env.ComSpec || 'cmd.exe') : command
  const executableArgs = usesCmdShim ? ['/d', '/s', '/c', command, ...args] : args
  return new Promise((resolve, reject) => {
    const child = spawn(executable, executableArgs, {
      cwd: options.cwd,
      env: options.env || process.env,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const append = (kind, chunk) => {
      const text = chunk.toString()
      if (kind === 'stdout') stdout += text
      else stderr += text
      if (typeof options.onOutput === 'function') options.onOutput({ kind, text })
    }
    child.stdout.on('data', (chunk) => append('stdout', chunk))
    child.stderr.on('data', (chunk) => append('stderr', chunk))
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${command} 执行超时（${Math.round(timeoutMs / 1000)} 秒）`))
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve({ stdout, stderr })
      else {
        const detail = (stderr || stdout).trim().split(/\r?\n/).slice(-12).join('\n')
        reject(new Error(`${command} ${args.join(' ')} 执行失败（退出码 ${code}）${detail ? `\n${detail}` : ''}`))
      }
    })
  })
}

class DshUpdater {
  constructor(options) {
    this.harnessDir = path.resolve(options.harnessDir)
    this.gitCommand = options.gitCommand || 'git.exe'
    this.pnpmCommand = options.pnpmCommand || (process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
    this.logDir = path.resolve(options.logDir || path.join(this.harnessDir, '.dsh-updater-logs'))
    this.logFile = path.join(this.logDir, options.logFile || 'dsh-updater.log')
    this.transactionFile = path.join(this.logDir, options.transactionFile || 'dsh-update-transaction.json')
    this.logLimit = Number(options.logLimit || 5 * 1024 * 1024)
    this.running = false
    fs.mkdirSync(this.logDir, { recursive: true })
  }

  readTransaction() {
    if (!fs.existsSync(this.transactionFile)) return null
    let transaction
    try {
      transaction = JSON.parse(fs.readFileSync(this.transactionFile, 'utf8'))
    } catch (error) {
      throw new Error('DSH update transaction is corrupted: ' + this.transactionFile + ' (' + error.message + ')')
    }
    const commit = transaction && transaction.before && transaction.before.commit
    if (transaction.version !== 1 || !/^[0-9a-f]{40}$/i.test(String(commit || ''))) {
      throw new Error('DSH update transaction is invalid: ' + this.transactionFile)
    }
    return transaction
  }

  writeTransaction(transaction) {
    const next = { ...transaction, version: 1, updatedAt: new Date().toISOString() }
    const temporary = this.transactionFile + '.tmp'
    fs.mkdirSync(this.logDir, { recursive: true })
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2), 'utf8')
    fs.renameSync(temporary, this.transactionFile)
    return next
  }

  updateTransaction(transaction, phase, details = {}) {
    return this.writeTransaction({ ...transaction, ...details, phase })
  }

  clearTransaction() {
    fs.rmSync(this.transactionFile, { force: true })
  }

  async runPnpm(args, onProgress, timeoutMs) {
    return runProcess(this.pnpmCommand, args, {
      cwd: this.harnessDir,
      timeoutMs,
      onOutput: (output) => this.output(onProgress, output),
    })
  }

  async rebuildRuntime(onProgress) {
    await this.runPnpm(['install', '--frozen-lockfile'], onProgress, 900000)
    await this.runPnpm(['run', 'clean'], onProgress, 300000)
    await this.runPnpm(['run', 'build'], onProgress, 1200000)
  }

  async recoverInterruptedUpdate(onProgress = () => {}) {
    const transaction = this.readTransaction()
    if (!transaction) return { recovered: false }
    if (this.running) throw new Error('DSH update already running')
    this.running = true
    this.appendLog('interrupted-update-detected', { transaction })
    try {
      this.progress(onProgress, { phase: 'recovery', message: '检测到上次更新未完成，正在恢复 DSH ' + transaction.before.version + '…' })
      const recovering = this.updateTransaction(transaction, 'recovering', { recoveryStartedAt: new Date().toISOString() })
      await this.git(['reset', '--hard', recovering.before.commit], {
        timeoutMs: 120000,
        onOutput: (output) => this.output(onProgress, output),
      })
      await this.rebuildRuntime(onProgress)
      const restored = await this.inspect()
      const artifacts = validateBuildArtifacts(this.harnessDir)
      if (restored.commit !== recovering.before.commit || !restored.clean) {
        throw new Error('Interrupted update recovery did not restore the recorded clean commit')
      }
      this.clearTransaction()
      this.progress(onProgress, { phase: 'recovery-complete', message: '已恢复 DSH ' + restored.version })
      this.appendLog('interrupted-update-recovered', { transaction: recovering, restored, artifacts })
      return { recovered: true, restored, artifacts, requestedTag: recovering.requestedTag }
    } catch (error) {
      try {
        this.updateTransaction(transaction, 'recovery-required', { recoveryError: error.message })
      } catch (_) {}
      this.appendLog('interrupted-update-recovery-failed', { transaction, error: error.message })
      throw error
    } finally {
      this.running = false
    }
  }

  appendLog(event, details = {}) {
    try {
      fs.mkdirSync(this.logDir, { recursive: true })
      if (fs.existsSync(this.logFile) && fs.statSync(this.logFile).size > this.logLimit) {
        const rotated = this.logFile + '.1'
        if (fs.existsSync(rotated)) fs.rmSync(rotated, { force: true })
        fs.renameSync(this.logFile, rotated)
      }
      fs.appendFileSync(this.logFile, JSON.stringify({ timestamp: new Date().toISOString(), event, ...details }) + '\n', 'utf8')
    } catch (_) {
      // Logging must never make an update fail.
    }
  }

  progress(onProgress, event) {
    this.appendLog('progress', event)
    if (typeof onProgress === 'function') onProgress(event)
  }

  output(onProgress, output) {
    this.appendLog('process-output', output)
    if (typeof onProgress === 'function') onProgress(output)
  }

  async git(args, options = {}) {
    return runProcess(this.gitCommand, args, {
      cwd: this.harnessDir,
      timeoutMs: options.timeoutMs,
      onOutput: options.onOutput,
    })
  }

  async inspect() {
    const version = readPackageVersion(this.harnessDir)
    const [{ stdout: commit }, { stdout: status }] = await Promise.all([
      this.git(['rev-parse', 'HEAD']),
      this.git(['status', '--porcelain']),
    ])
    return {
      harnessDir: this.harnessDir,
      version,
      tag: `${TAG_PREFIX}${version}`,
      commit: commit.trim(),
      clean: status.trim() === '',
    }
  }

  async check() {
    const installed = await this.inspect()
    const { stdout } = await this.git(['ls-remote', '--tags', '--refs', 'origin', 'refs/tags/dsh-v*'], {
      timeoutMs: 60000,
    })
    const latestTag = latestTagFromLsRemote(stdout)
    if (!latestTag) throw new Error('没有从 DSH 上游读取到有效版本标签')
    const result = {
      ...installed,
      latestTag,
      latestVersion: latestTag.slice(TAG_PREFIX.length),
      updateAvailable: compareVersions(latestTag, installed.version) > 0,
    }
    this.appendLog('check', result)
    return result

  }

  async apply(tag, onProgress = () => {}) {
    if (this.running) throw new Error('DSH update already running')
    if (!parseVersion(tag) || !String(tag).startsWith(TAG_PREFIX)) throw new Error('Invalid DSH update tag: ' + tag)
    this.running = true
    let before = null
    let backupBranch = null
    let transactionStarted = false
    let transaction = null
    try {
      before = await this.inspect()
      this.appendLog('start', { requestedTag: tag, before })
      if (!before.clean) throw new Error('DSH runtime has local changes; update stopped to avoid overwriting them.')
      if (compareVersions(tag, before.version) <= 0) return { updated: false, before, after: before }

      const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
      backupBranch = 'backup/dpa-auto-update-' + before.version + '-' + stamp
      this.progress(onProgress, { phase: 'backup', message: 'Creating rollback point...' })
      await this.git(['branch', backupBranch, before.commit])
      transactionStarted = true
      transaction = this.writeTransaction({
        status: 'in-progress',
        phase: 'backup',
        startedAt: new Date().toISOString(),
        requestedTag: tag,
        before,
        backupBranch,
      })

      this.progress(onProgress, { phase: 'fetch', message: 'Downloading ' + tag + '...' })
      transaction = this.updateTransaction(transaction, 'fetch')
      await this.git(['fetch', '--tags', 'origin', tag], { timeoutMs: 180000, onOutput: (output) => this.output(onProgress, output) })
      transaction = this.updateTransaction(transaction, 'merge')
      await this.git(['merge', '--ff-only', tag], { timeoutMs: 60000, onOutput: (output) => this.output(onProgress, output) })

      this.progress(onProgress, { phase: 'install', message: 'Installing DSH dependencies...' })
      transaction = this.updateTransaction(transaction, 'install')
      await this.runPnpm(['install', '--frozen-lockfile'], onProgress, 900000)

      this.progress(onProgress, { phase: 'build', message: 'Building DSH...' })
      transaction = this.updateTransaction(transaction, 'clean')
      await this.runPnpm(['run', 'clean'], onProgress, 300000)
      transaction = this.updateTransaction(transaction, 'build')
      await this.runPnpm(['run', 'build'], onProgress, 1200000)

      this.progress(onProgress, { phase: 'validate', message: 'Validating client artifacts...' })
      transaction = this.updateTransaction(transaction, 'validate')
      const artifacts = validateBuildArtifacts(this.harnessDir)
      const after = await this.inspect()
      if (!after.clean) throw new Error('DSH update left uncommitted files in the runtime')
      this.clearTransaction()
      this.progress(onProgress, { phase: 'complete', message: 'DSH updated to ' + after.version })
      this.appendLog('complete', { requestedTag: tag, before, after, backupBranch, artifacts })
      return { updated: true, before, after, backupBranch, artifacts, logFile: this.logFile }
    } catch (error) {
      const originalMessage = error.message
      let rollback = { attempted: false, ok: false }
      if (transactionStarted && before) {
        rollback.attempted = true
        this.progress(onProgress, { phase: 'rollback', message: 'Update failed; restoring the previous version...' })
        try {
          await this.git(['reset', '--hard', before.commit], { timeoutMs: 120000, onOutput: (output) => this.output(onProgress, output) })
          if (transaction) transaction = this.updateTransaction(transaction, 'rollback')
          await this.rebuildRuntime(onProgress)
          const restored = await this.inspect()
          const artifacts = validateBuildArtifacts(this.harnessDir)
          rollback = { attempted: true, ok: restored.commit === before.commit && restored.clean, restored, artifacts }
          if (!rollback.ok) throw new Error('Rollback did not restore a clean worktree')
          this.clearTransaction()
          this.progress(onProgress, { phase: 'rollback-complete', message: 'Restored DSH ' + restored.version })
        } catch (rollbackError) {
          rollback.error = rollbackError.message
          try {
            if (transaction) this.updateTransaction(transaction, 'rollback-required', { rollbackError: rollbackError.message })
          } catch (_) {}
          this.progress(onProgress, { phase: 'rollback-error', message: 'Automatic rollback failed: ' + rollbackError.message })
        }
      }
      this.appendLog('failed', { requestedTag: tag, before, backupBranch, originalMessage, rollback })
      error.message = originalMessage + '\nUpdate log: ' + this.logFile + (rollback.attempted ? '\nRollback: ' + (rollback.ok ? 'succeeded' : 'failed (' + (rollback.error || 'unknown') + ')') : '')
      error.rollback = rollback
      throw error
    } finally {
      this.running = false
    }
  }
}

module.exports = {
  DshUpdater,
  compareVersions,
  latestTagFromLsRemote,
  parseVersion,
  readPackageVersion,
  runProcess,
  validateBuildArtifacts,
}
