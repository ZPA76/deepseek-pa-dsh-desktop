'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.join(__dirname, '..')
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8')

test('桌面端包含本地崩溃诊断与有限恢复门禁', () => {
  const main = read('main.js')
  assert.match(main, /crashReporter\.start\(/)
  assert.match(main, /uploadToServer:\s*false/)
  assert.match(main, /uncaughtExceptionMonitor/)
  assert.match(main, /unhandledRejection/)
  assert.match(main, /render-process-gone/)
  assert.match(main, /child-process-gone/)
  assert.match(main, /serverRestartAttempts < 2/)
})

test('事件管线明确分离公开聊天并限制前端缓存', () => {
  const ui = read('cluster-ui.js')
  const runtime = read('cluster-runtime.js')
  assert.match(ui, /function isPublicMessage\(/)
  assert.match(ui, /MAX_RENDERED_EVENTS = 2000/)
  assert.match(ui, /MAX_RENDERED_STREAMS = 16/)
  assert.match(ui, /if \(!stream\) return/)
  assert.match(runtime, /channel: data\.channel \|\| ''/)
  assert.match(runtime, /const channel = options\.channel \|\| 'worklog'/)
  assert.match(runtime, /purpose: 'discussion'/)
})

test('事件持久化使用原子写入和 fsync', () => {
  const store = read('cluster-store.js')
  assert.match(store, /fs\.fsyncSync\(descriptor\)/)
  assert.match(store, /normalizeEventShape\(/)
  assert.match(store, /EVENT_CHANNELS/)
})
test('DPA 持久化追踪自己启动的 3080 服务并在更新前结束实际监听进程', () => {
  const main = read('main.js')
  assert.match(main, /dsh-server-process\.json/)
  assert.match(main, /function listenerPidForServer\(/)
  assert.match(main, /function recordManagedServerListener\(/)
  assert.match(main, /function stopManagedServerFromMarker\(/)
  assert.match(main, /listenerPid === marker\.pid/)
  assert.match(main, /stopManagedServerFromMarker\(\)/)
})