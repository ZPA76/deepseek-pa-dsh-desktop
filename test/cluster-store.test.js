'use strict'

const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')

const { ClusterStore } = require('../cluster-store')

function createStore(t) {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dpa-cluster-store-'))
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }))
  return { store: new ClusterStore({ homeDir }), homeDir }
}

test('项目保存兼容旧版 JSON，并建立项目房间集合', (t) => {
  const { store, homeDir } = createStore(t)
  fs.writeFileSync(path.join(homeDir, 'clusters', 'legacy.json'), JSON.stringify({
    id: 'legacy', name: '旧项目', goal: '保留历史', mode: 'team', members: [],
  }))

  assert.equal(store.listProjects()[0].name, '旧项目')
  const saved = store.saveProject({ id: 'legacy', status: 'active', phase: 'kickoff' })

  assert.equal(saved.goal, '保留历史')
  assert.equal(saved.schemaVersion, 4)
  assert.equal(store.getProject('legacy').status, 'active')
  assert.ok(fs.existsSync(path.join(homeDir, 'clusters', 'projects', 'legacy', 'project.json')))
})

test('事件日志保持严格递增序号并可增量读取', (t) => {
  const { store } = createStore(t)
  store.saveProject({ id: 'alpha', name: 'Alpha', goal: '测试事件', members: [] })
  const first = store.appendEvent('alpha', { type: 'user.message', text: '开始项目' })
  const second = store.appendEvent('alpha', { type: 'agent.message', text: '收到' })

  assert.equal(first.seq, 1)
  assert.equal(second.seq, 2)
  assert.deepEqual(store.listEvents('alpha', { after: 1 }).map((event) => event.text), ['收到'])
})

test('事件频道区分公开讨论、工作轨迹并兼容旧事件', (t) => {
  const { store } = createStore(t)
  store.saveProject({ id: 'channels', name: '频道测试', members: [] })
  const user = store.appendEvent('channels', { type: 'user.message', text: '用户要求', meta: { target: 'project' } })
  const meeting = store.appendEvent('channels', { type: 'agent.message.completed', phase: 'discussion', text: '会议发言' })
  const tool = store.appendEvent('channels', { type: 'tool.call', text: '调用工具' })
  const activity = store.appendEvent('channels', { type: 'agent.activity', text: '处理中' })
  assert.equal(user.channel, 'room')
  assert.equal(user.visibility, 'participants')
  assert.equal(meeting.channel, 'room')
  assert.equal(tool.channel, 'worklog')
  assert.equal(activity.channel, 'activity')
  fs.appendFileSync(store.eventsFile('channels'), '{malformed-json}\n', 'utf8')
  const events = store.listEvents('channels', { limit: 20 })
  assert.equal(events.length, 4)
  assert.ok(events.every((event) => event.channel && event.purpose && event.visibility))
})

test('高事件量读取有上限且异常行不会阻断恢复', (t) => {
  const { store } = createStore(t)
  store.saveProject({ id: 'load', name: '负载测试', members: [] })
  for (let index = 0; index < 260; index += 1) {
    store.appendEvent('load', { type: 'agent.activity', text: `事件 ${index}` })
  }
  fs.appendFileSync(store.eventsFile('load'), 'not-json\n', 'utf8')
  const events = store.listEvents('load', { limit: 2000 })
  assert.equal(events.length, 260)
  assert.equal(events[0].seq, 1)
  assert.equal(events.at(-1).seq, 260)
})
test('损坏 JSON 快照会隔离保留而不是反复触发解析错误', (t) => {
  const { store } = createStore(t)
  store.saveProject({ id: 'corrupt', name: '损坏快照', members: [] })
  fs.writeFileSync(store.collectionFile('corrupt', 'tasks'), '{not-json', 'utf8')
  assert.deepEqual(store.listTasks('corrupt'), [])
  const files = fs.readdirSync(store.projectDir('corrupt')).filter((name) => name.startsWith('tasks.json.corrupt-'))
  assert.equal(files.length, 1)
})
test('任务、审批和交付物支持幂等更新', (t) => {
  const { store } = createStore(t)
  store.saveProject({ id: 'beta', name: 'Beta', members: [] })
  store.saveTask('beta', { id: 'task-1', title: '调研', status: 'todo' })
  store.saveTask('beta', { id: 'task-1', status: 'done' })
  store.saveApproval('beta', { id: 'approval-1', kind: 'plan', status: 'pending' })
  store.saveArtifact('beta', { id: 'artifact-1', title: '方案', content: '正文' })

  assert.equal(store.listTasks('beta').length, 1)
  assert.equal(store.listTasks('beta')[0].status, 'done')
  assert.equal(store.getProjectOverview('beta').artifacts[0].content, '正文')
})

test('员工配置可持久化且禁止路径穿越', (t) => {
  const { store } = createStore(t)
  const employee = store.saveEmployee({
    id: 'researcher', name: '研究员', persona: '重视证据', skills: ['检索'],
  })

  assert.equal(employee.status, 'available')
  assert.equal(store.listEmployees()[0].name, '研究员')
  assert.throws(() => store.saveProject({ id: '../outside', name: '非法' }), /格式无效/)
})
test('员工培养使用候选、考核、晋升与可回退版本，不直接覆盖当前档案', (t) => {
  const { store } = createStore(t)
  const v1 = store.saveEmployee({ id: 'reviewer', name: '审查员', persona: '先查证据', skills: ['审查'] })
  const v2 = store.saveEmployee({ id: 'reviewer', persona: '先查证据，再分级风险', skills: ['审查', '风险分级'] })
  assert.equal(v1.version, 1)
  assert.equal(v2.version, 2)
  assert.deepEqual(store.listEmployeeVersions('reviewer').map((item) => item.version), [2, 1])

  const run = store.saveTrainingRun('reviewer', {
    goal: '强化验证',
    candidate: { persona: '先查证据、分级风险，并给出验证命令', skills: ['审查', '风险分级', '验证'] },
    evaluation: { score: 8, passed: true, reasons: ['目标更明确'], risks: [] },
  })
  assert.equal(store.getEmployee('reviewer').version, 2)
  const promoted = store.promoteTrainingRun('reviewer', run.id)
  assert.equal(promoted.version, 3)
  assert.equal(promoted.metrics.evalScore, 8)

  const restored = store.restoreEmployeeVersion('reviewer', 1)
  assert.equal(restored.version, 4)
  assert.equal(restored.development.restoredFromVersion, 1)
})

test('未通过考核不能晋升，未参与项目的员工删除会进入可恢复回收目录', (t) => {
  const { store } = createStore(t)
  store.saveEmployee({ id: 'temporary', name: '临时员工' })
  const run = store.saveTrainingRun('temporary', {
    candidate: { persona: '未经验证的候选' },
    evaluation: { score: 4, passed: false },
  })
  assert.throws(() => store.promoteTrainingRun('temporary', run.id), /未通过独立考核/)
  const deleted = store.deleteEmployee('temporary')
  assert.equal(deleted.recoverable, true)
  assert.ok(fs.existsSync(deleted.trashPath))
})

test('项目列表主状态只投影为休息、交付待审批或运行中', (t) => {
  const { store } = createStore(t)
  store.saveProject({ id: 'status-project', name: '状态项目', status: 'draft', members: [] })
  assert.equal(store.listProjects()[0].displayStatus, 'rest')
  store.saveApproval('status-project', { id: 'approval', status: 'pending', subject: '审批' })
  assert.equal(store.listProjects()[0].displayStatus, 'awaiting')
  store.saveApproval('status-project', { id: 'approval', status: 'approved' })
  store.saveProject({ id: 'status-project', status: 'active' })
  assert.equal(store.listProjects()[0].displayStatus, 'running')
})


test('项目支持编辑、归档、回收站和恢复，并保留项目事件', (t) => {
  const { store } = createStore(t)
  store.saveProject({ id: 'lifecycle', name: '原项目', goal: '原目标', members: [] })
  store.updateProject('lifecycle', { name: '新项目', goal: '新目标' })
  assert.equal(store.getProject('lifecycle').name, '新项目')
  store.archiveProject('lifecycle')
  assert.equal(store.getProject('lifecycle').lifecycleState, 'archived')
  store.trashProject('lifecycle')
  assert.equal(store.listProjects().length, 0)
  assert.equal(store.listTrashedProjects()[0].lifecycleState, 'trashed')
  store.restoreProject('lifecycle')
  assert.equal(store.listProjects()[0].name, '新项目')
  assert.ok(store.listEvents('lifecycle').some((event) => event.type === 'project.trashed'))
})

test('项目重要性为五级，回收站支持单项永久删除和清空且保留工作目录', (t) => {
  const { store, homeDir } = createStore(t)
  const workspaceA = path.join(homeDir, 'external-a')
  const workspaceB = path.join(homeDir, 'external-b')
  fs.mkdirSync(workspaceA, { recursive: true })
  fs.mkdirSync(workspaceB, { recursive: true })
  store.saveProject({ id: 'priority-a', name: '最高项目', workspace: workspaceA, members: [] })
  store.saveProject({ id: 'priority-b', name: '普通项目', workspace: workspaceB, members: [] })
  assert.equal(store.getProject('priority-a').importanceLevel, 3)
  assert.equal(store.setProjectImportance('priority-a', 5).importanceLevel, 5)
  assert.throws(() => store.setProjectImportance('priority-a', 6), /1–5/)
  store.trashProject('priority-a')
  store.trashProject('priority-b')
  const deleted = store.deleteProjectForever('priority-a')
  assert.equal(deleted.workspaceDeleted, false)
  assert.equal(fs.existsSync(workspaceA), true)
  assert.throws(() => store.getProject('priority-a'), /未找到/)
  const emptied = store.emptyProjectTrash()
  assert.equal(emptied.deletedCount, 1)
  assert.equal(emptied.failedCount, 0)
  assert.equal(fs.existsSync(workspaceB), true)
  assert.equal(store.listTrashedProjects().length, 0)
})