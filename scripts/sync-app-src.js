'use strict'

// app-src 是发行暂存镜像。只同步 electron-builder 需要的应用源，不触碰 DSH 或用户数据。
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const destination = path.join(root, 'app-src')
const files = [
  'main.js',
  'preload.js',
  'dsh-updater.js',
  'harness-team-adapter.js',
  'cluster-engine.js',
  'cluster-runtime.js',
  'cluster-acp-client.js',
  'cluster-store.js',
  'cluster.html',
  'cluster-ui.css',
  'cluster-ui.js',
  'shell.html',
  'capabilities.html',
  'capabilities.css',
  'capabilities.js',
  'capability-registry.js',
  'appearance-service.js',
  'extension-market.js',
  'github-auth.js',
  'loading.html',
  'codex-theme.css',
  'icon.png',
  'icon.ico',
  'dpa.cordis.yml',
  'package.json',
]

fs.mkdirSync(destination, { recursive: true })
for (const file of files) {
  const source = path.join(root, file)
  if (!fs.existsSync(source)) throw new Error(`缺少待同步文件：${file}`)
  fs.copyFileSync(source, path.join(destination, file))
}
console.log(`已同步 ${files.length} 个 DPA 应用文件到 app-src`)
