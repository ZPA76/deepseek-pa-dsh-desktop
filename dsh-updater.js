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
    this.running = false
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
    return {
      ...installed,
      latestTag,
      latestVersion: latestTag.slice(TAG_PREFIX.length),
      updateAvailable: compareVersions(latestTag, installed.version) > 0,
    }
  }

  async apply(tag, onProgress = () => {}) {
    if (this.running) throw new Error('DSH 更新正在进行，请勿重复操作')
    if (!parseVersion(tag) || !String(tag).startsWith(TAG_PREFIX)) throw new Error(`无效的 DSH 更新标签：${tag}`)
    this.running = true
    try {
      const before = await this.inspect()
      if (!before.clean) throw new Error('托管 DSH 运行时存在本地修改。为避免覆盖，自动更新已停止。')
      if (compareVersions(tag, before.version) <= 0) return { updated: false, before, after: before }

      const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
      const backupBranch = `backup/dpa-auto-update-${before.version}-${stamp}`
      onProgress({ phase: 'backup', message: '正在建立更新回退点…' })
      await this.git(['branch', backupBranch, before.commit])

      onProgress({ phase: 'fetch', message: `正在下载 ${tag}…` })
      await this.git(['fetch', '--tags', 'origin', tag], { timeoutMs: 180000, onOutput: onProgress })
      await this.git(['merge', '--ff-only', tag], { timeoutMs: 60000, onOutput: onProgress })

      onProgress({ phase: 'install', message: '正在同步 DSH 依赖…' })
      await runProcess(this.pnpmCommand, ['install', '--frozen-lockfile'], {
        cwd: this.harnessDir,
        timeoutMs: 900000,
        onOutput: onProgress,
      })

      onProgress({ phase: 'build', message: '正在构建新版 DSH…' })
      await runProcess(this.pnpmCommand, ['run', 'build'], {
        cwd: this.harnessDir,
        timeoutMs: 1200000,
        onOutput: onProgress,
      })

      const after = await this.inspect()
      if (!after.clean) throw new Error('DSH 更新完成后工作区出现未提交文件，请检查构建配置')
      onProgress({ phase: 'complete', message: `DSH 已更新到 ${after.version}` })
      return { updated: true, before, after, backupBranch }
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
}
