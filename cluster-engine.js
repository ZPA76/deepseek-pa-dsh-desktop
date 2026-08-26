'use strict'

// 兼容旧入口。新的项目房间、统一治理与事件流实现在 cluster-runtime.js。
module.exports = require('./cluster-runtime')

if (require.main === module) {
  const { loadProject, runCluster } = module.exports
  const id = process.argv[2]
  if (!id) {
    console.error('用法：node cluster-engine.js <项目id>')
    process.exit(1)
  }
  runCluster(loadProject(id), {
    onStep: (event) => console.log(`[${event.eventType}] ${event.role || event.from || ''} ${String(event.text || '').slice(0, 100)}`),
  }).then((result) => console.log(`\n===== 最终成果 =====\n${result.final}`))
    .catch((error) => { console.error('执行失败：', error.message); process.exit(1) })
}
