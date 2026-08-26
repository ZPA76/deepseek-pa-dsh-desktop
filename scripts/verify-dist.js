'use strict'
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')
const relative = process.env.DPA_DIST_DIR || 'dist'
const unpacked = path.join(root, relative, 'win-unpacked')
const exe = path.join(unpacked, 'DeepSeek-PA.exe')
const asar = path.join(unpacked, 'resources', 'app.asar')
const release = path.join(root, relative, 'release.json')
for (const file of [exe, asar, release]) if (!fs.existsSync(file)) throw new Error('正式发布产物缺失：' + file)
if (fs.existsSync(path.join(root, 'dist-rebuilt'))) throw new Error('检测到旧版 dist-rebuilt，请先执行 npm run publish:desktop')
if (fs.existsSync(path.join(root, 'dist-staging'))) throw new Error('检测到未发布的 dist-staging，请先执行 npm run publish:desktop')
const sourceFiles = ['main.js', 'shell.html', 'capabilities.html', 'capabilities.js', 'capabilities.css', 'capability-registry.js', 'appearance-service.js', 'extension-market.js', 'github-auth.js', 'cluster-store.js', 'cluster-runtime.js', 'harness-team-adapter.js', 'cluster-ui.js', 'cluster.html', 'cluster-ui.css', 'dpa.cordis.yml', 'package.json']
const newestSource = Math.max(...sourceFiles.map((file) => fs.statSync(path.join(root, file)).mtimeMs))
const packageTime = fs.statSync(asar).mtimeMs
if (packageTime < newestSource) throw new Error('桌面包早于源码：请重新构建并更新快捷方式')
console.log('DPA desktop package verified:', path.join(relative, 'win-unpacked'))
