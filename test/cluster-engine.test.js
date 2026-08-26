'use strict'

const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')

const { ClusterStore, GOVERNANCE_POLICIES, normalizeUsage, runCluster } = require('../cluster-runtime')

function setup(t, mode = 'team') {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dpa-cluster-engine-'))
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }))
  const store = new ClusterStore({ homeDir })
  store.saveEmployee({ id: 'lead', name: '负责人', persona: '负责整合' })
  store.saveEmployee({ id: 'worker', name: '执行员', persona: '负责执行' })
  const project = {
    id: `project-${mode}`,
    name: `${mode} 项目`,
    goal: '产出一份可验收方案',
    mode,
    members: [
      { agent: 'lead', role: '负责人', duty: '整合', rank: 1, brain: { type: 'api' } },
      { agent: 'worker', role: '执行员', duty: '调研', rank: 2, brain: { type: 'api' } },
    ],
  }
  let counter = 0
  const callModel = async ({ onDelta }) => {
    counter += 1
    const text = `模拟产出 ${counter}`
    onDelta(text.slice(0, 3))
    onDelta(text.slice(3))
    return { text, usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 5, totalTokens: 14, cacheHitPercent: 50 } }
  }
  return { store, project, callModel }
}

test('三种项目模式共用同一生命周期，仅治理策略不同', async (t) => {
  for (const mode of Object.keys(GOVERNANCE_POLICIES)) {
    await t.test(mode, async (t) => {
      const { store, project, callModel } = setup(t, mode)
      const result = await runCluster(project, {
        store,
        callModel,
        onApproval: async () => ({ status: 'approved' }),
      })
      const events = store.listEvents(project.id, { limit: 2000 })
      assert.equal(result.status, 'accepted')
      assert.equal(store.getProject(project.id).phase, 'accepted')
      assert.ok(events.some((event) => event.type === 'approval.requested'))
      assert.ok(events.some((event) => event.type === 'task.updated' && event.status === 'done'))
      assert.ok(events.some((event) => event.type === 'run.completed'))
    })
  }
})

test('验收退回会建立版本化返工任务与新成果', async (t) => {
  const { store, project, callModel } = setup(t, 'hierarchy')
  let acceptanceCount = 0
  const result = await runCluster(project, {
    store,
    callModel,
    onApproval: async (approval) => {
      if (approval.kind === 'plan') return { status: 'approved' }
      acceptanceCount += 1
      return acceptanceCount === 1
        ? { status: 'rejected', feedback: '补充风险说明' }
        : { status: 'approved' }
    },
  })
  assert.equal(result.artifact.version, 2)
  assert.equal(store.listArtifacts(project.id).length, 2)
  assert.equal(store.listTasks(project.id).find((task) => task.id.startsWith('revision-')).status, 'done')
})

test('DeepSeek 缓存指标被归一化为项目遥测字段', () => {
  assert.deepEqual(normalizeUsage({
    prompt_tokens: 100,
    completion_tokens: 20,
    total_tokens: 120,
    prompt_cache_hit_tokens: 75,
    prompt_cache_miss_tokens: 25,
  }), {
    inputTokens: 25,
    outputTokens: 20,
    cacheReadTokens: 75,
    cacheWriteTokens: 0,
    totalTokens: 120,
    cacheHitPercent: 75,
  })
})
test('Harness ACP 员工产生可审批权限、工具轨迹、操作台账和用量', async (t) => {
  const { store, project, callModel } = setup(t, 'hierarchy')
  project.members = [{
    ...project.members[0],
    brain: { type: 'dsh-acp' },
    permission: 'ask',
  }]
  let approvalCount = 0
  store.saveEmployee({ ...store.getEmployee('lead'), skillAccess: { mode: 'selected', names: ['code-review'] } })
  let toolPermission = ''
  let blockedPermission = ''
  const result = await runCluster(project, {
    store,
    callModel,
    onApproval: async (approval) => {
      approvalCount += 1
      assert.ok(approval.packet)
      return { status: 'approved' }
    },
    runAgentTask: async (options) => {
      options.onSession('session-test')
      assert.equal(options.skillMode, 'selected')
      assert.match(options.prompt, /\/code-review/)
      options.onEvent({ type: 'tool.call', text: '加载 Skill：code-review', status: 'running', meta: { callId: 'skill-1', tool: 'skill', arguments: '{"name":"code-review"}' } })
      options.onEvent({ type: 'tool.result', text: 'Skill 已加载', status: 'done', meta: { callId: 'skill-1' } })
      toolPermission = await options.onPermission({ toolCall: { title: '在项目工作区写入测试文件' } })
      blockedPermission = await options.onPermission({ toolCall: { arguments: '{"sandbox_permissions":"danger-full-access","path":"../outside"}' } })
      options.onEvent({ type: 'tool.call', text: '调用 write：result.txt', status: 'running', meta: { callId: 'call-1', tool: 'write', arguments: '{"path":"result.txt"}' } })
      options.onEvent({ type: 'tool.result', text: '写入完成', status: 'done', meta: { callId: 'call-1' } })
      options.onEvent({ type: 'telemetry.usage', text: '15 tokens', metrics: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } })
      return {
        text: '已实际完成并验证',
        sessionId: 'session-test',
        toolCalls: 2,
        logFile: 'session.jsonl',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      }
    },
  })
  assert.equal(result.status, 'accepted')
  assert.equal(toolPermission, 'allow')
  assert.equal(blockedPermission, 'reject')
  assert.ok(approvalCount >= 4)
  const actions = store.listActions(project.id)
  assert.ok(actions.some((item) => item.sessionId === 'session-test' && item.status === 'done'))
  assert.ok(actions.some((item) => item.tool === 'write' && item.status === 'done'))
  assert.ok(actions.some((item) => item.tool === 'skill' && item.status === 'done'))
  assert.ok(store.listEvents(project.id, { limit: 2000 }).some((event) => event.type === 'tool.call'))
})

