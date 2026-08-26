'use strict'

// DPA 桌面版的唯一发布入口：构建到暂存目录，校验后原子轮换到 dist。
// 旧版本只进入 .dpa-backups，不再作为启动路径存在。
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const distDir = path.join(root, 'dist')
const stagingDir = path.join(root, 'dist-staging')
const legacyDir = path.join(root, 'dist-rebuilt')
const backupRoot = path.join(root, '.dpa-backups')
const packagePath = path.join(root, 'package.json')

function fail(message) {
  throw new Error(message)
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: false,
    shell: false,
  })
  if (result.error) throw result.error
  if (result.status !== 0) fail(`${command} ${args.join(' ')} 执行失败（退出码 ${result.status}）`)
}

function dpaProcesses() {
  if (process.platform !== 'win32') return []
  const result = spawnSync('tasklist.exe', [
    '/FI', 'IMAGENAME eq DeepSeek-PA.exe', '/FO', 'CSV', '/NH',
  ], { encoding: 'utf8', windowsHide: true })
  if (result.error || result.status !== 0) return []
  return String(result.stdout || '').split(/\r?\n/).filter((line) => /"DeepSeek-PA\.exe"/i.test(line))
}

function readVersion() {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
  if (!pkg.version) fail('package.json 缺少版本号')
  return String(pkg.version)
}

function assertRelease(directory) {
  const exe = path.join(directory, 'win-unpacked', 'DeepSeek-PA.exe')
  const asar = path.join(directory, 'win-unpacked', 'resources', 'app.asar')
  if (!fs.existsSync(exe) || !fs.existsSync(asar)) {
    fail(`暂存发布包不完整：${directory}`)
  }
  return { exe, asar }
}

function timestamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
}

function moveToBackup(source, label, stamp) {
  if (!fs.existsSync(source)) return null
  fs.mkdirSync(backupRoot, { recursive: true })
  const target = path.join(backupRoot, `${label}-${stamp}`)
  fs.renameSync(source, target)
  return target
}

function powershellQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function knownFolder(name, fallbackParts) {
  const profile = process.env.USERPROFILE || ''
  const candidate = path.join(profile, ...fallbackParts)
  if (fs.existsSync(candidate)) return candidate
  if (process.platform === 'win32') {
    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-Command', `[Environment]::GetFolderPath('${name}')`,
    ], { encoding: 'utf8', windowsHide: true })
    const discovered = String(result.stdout || '').trim()
    if (discovered && fs.existsSync(discovered)) return discovered
  }
  fail(`找不到当前用户的 ${name} 目录，未创建快捷方式`)
}

function desktopPath() {
  return knownFolder('Desktop', ['Desktop'])
}

function programsPath() {
  return knownFolder('Programs', ['AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs'])
}

function writeShortcut(link, target) {
  const workdir = path.dirname(target)
  const command = [
    '$shell=New-Object -ComObject WScript.Shell',
    `$shortcut=$shell.CreateShortcut(${powershellQuote(link)})`,
    `$shortcut.TargetPath=${powershellQuote(target)}`,
    `$shortcut.WorkingDirectory=${powershellQuote(workdir)}`,
    `$shortcut.IconLocation=${powershellQuote(`${target},0`)}`,
    `$shortcut.Description='DeepSeek-PA（DPA）'`,
    '$shortcut.Save()',
  ].join('; ')
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command,
  ], { encoding: 'utf8', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) fail(`创建快捷方式失败：${String(result.stderr || result.stdout || '').trim()}`)
  return link
}

function createShortcuts() {
  if (process.platform !== 'win32') return []
  const target = path.join(distDir, 'win-unpacked', 'DeepSeek-PA.exe')
  const links = [
    writeShortcut(path.join(desktopPath(), 'DPA.lnk'), target),
    writeShortcut(path.join(programsPath(), 'DeepSeek-PA.lnk'), target),
  ]
  // 只清理已确认的历史错误别名，绝不模糊匹配或删除其他快捷方式。
  for (const legacyName of ['Deepseek-P.lnk', 'DeepSeek-P.lnk']) {
    const legacy = path.join(programsPath(), legacyName)
    if (fs.existsSync(legacy)) fs.rmSync(legacy, { force: true })
  }
  return links
}
function writeReleaseMetadata(version, stamp) {
  const metadata = {
    product: 'DeepSeek-PA',
    version,
    publishedAt: new Date().toISOString(),
    executable: 'win-unpacked/DeepSeek-PA.exe',
    updatePolicy: 'atomic-staging-with-rollback',
  }
  fs.writeFileSync(path.join(distDir, 'release.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
  return stamp
}

function main() {
  const processes = dpaProcesses()
  if (processes.length) {
    fail('检测到 DPA 正在运行。请先正常退出 DPA（包括托盘图标），再执行发布；为保护未保存内容，发布器不会强制结束进程。')
  }

  const version = readVersion()
  const stamp = timestamp()
  if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true })

  console.log(`开始构建 DPA ${version}（暂存目录：${stagingDir}）`)
  const npmCommand = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm'
  const npmPrefix = process.platform === 'win32' ? ['/d', '/s', '/c'] : []
  const npmArgs = (script) => process.platform === 'win32' ? [...npmPrefix, `npm run ${script}`] : ['run', script]
  run(npmCommand, npmArgs('sync:app-src'))
  run(npmCommand, npmArgs('dist:dir'))
  assertRelease(stagingDir)

  const oldDist = moveToBackup(distDir, 'desktop-dist-legacy', stamp)
  const oldRebuilt = moveToBackup(legacyDir, 'desktop-dist-rebuilt-legacy', stamp)
  fs.renameSync(stagingDir, distDir)
  writeReleaseMetadata(version, stamp)
  const shortcuts = createShortcuts()

  console.log(`DPA ${version} 已发布到：${distDir}`)
  if (oldDist) console.log(`旧正式目录已归档：${oldDist}`)
  if (oldRebuilt) console.log(`旧临时目录已归档：${oldRebuilt}`)
  for (const shortcut of shortcuts) console.log(`快捷方式已更新：${shortcut}`)
  console.log('以后只从桌面 DPA.lnk 或 dist\\win-unpacked\\DeepSeek-PA.exe 启动。')
}

try {
  main()
} catch (error) {
  console.error(`发布未完成：${error.message || error}`)
  process.exitCode = 1
}