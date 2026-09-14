'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const asar = require('@electron/asar')

function digest(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

// Inspect archive bytes, not just timestamps: missing dependencies and stale
// packages must be rejected before replacing the user's installed application.
function verifyRelease(root, directory, { requireMetadata = false } = {}) {
  root = path.resolve(root)
  directory = path.resolve(directory)
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const archive = path.join(directory, 'win-unpacked', 'resources', 'app.asar')
  const executable = path.join(directory, 'win-unpacked', 'DeepSeek-PA.exe')
  for (const file of [archive, executable]) {
    if (!fs.existsSync(file) || !fs.statSync(file).size) throw new Error('发布文件缺失或为空：' + file)
  }
  const files = pkg.build.files
  if (!Array.isArray(files) || !files.length) throw new Error('缺少发布源文件清单')
  const hashes = {}
  const declared = new Set(files)
  const resources = new Map((pkg.build.extraResources || []).map(entry => [entry.from, entry.to]))
  for (const relative of files) {
    if (typeof relative !== 'string' || !/^[\w./-]+$/.test(relative) || relative.split('/').includes('..')) {
      throw new Error('发布清单必须列出明确的应用文件：' + relative)
    }
    const source = fs.readFileSync(path.join(root, relative))
    let packed
    if (resources.has(relative)) {
      const target = resources.get(relative)
      if (typeof target !== 'string' || !/^[\w./-]+$/.test(target) || target.split('/').includes('..') || path.isAbsolute(target)) throw new Error('非法外部资源路径：' + relative)
      try { packed = fs.readFileSync(path.join(path.dirname(archive), target)) } catch (_) { throw new Error('发布包缺少外部资源：' + relative) }
    } else {
      try { packed = asar.extractFile(archive, path.normalize(relative)) } catch (_) { throw new Error('app.asar 缺少模块：' + relative) }
    }
    if (relative === 'package.json') {
      const built = JSON.parse(packed.toString('utf8'))
      if (built.version !== pkg.version || built.main !== pkg.main || built.name !== pkg.name) throw new Error('app.asar 版本或入口与源码不一致')
    } else if (digest(source) !== digest(packed)) {
      throw new Error('app.asar 与本轮源码内容不一致：' + relative)
    }
    hashes[relative] = digest(packed)
    if (relative.endsWith('.js')) {
      for (const match of source.toString('utf8').matchAll(/require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g)) {
        let dep = path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1]))
        if (!path.posix.extname(dep)) dep += '.js'
        if (!declared.has(dep)) throw new Error(`${relative} 引用了未打包模块：${dep}`)
      }
    }
  }
  for (const dependency of Object.keys(pkg.dependencies || {})) {
    try { asar.extractFile(archive, path.join('node_modules', dependency, 'package.json')) } catch (_) {
      throw new Error('app.asar 缺少运行依赖：' + dependency)
    }
  }
  const archiveSha256 = digest(fs.readFileSync(archive))
  if (requireMetadata) {
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'release.json'), 'utf8'))
    if (metadata.version !== pkg.version) throw new Error('发布记录版本与程序不一致')
    if (metadata.archiveSha256 !== archiveSha256) throw new Error('发布包 SHA256 与发布记录不一致')
  }
  return { version: pkg.version, executable, archive, archiveSha256, files: hashes }
}

module.exports = { verifyRelease }
