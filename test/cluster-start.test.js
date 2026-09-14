'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { loadCredentialEnv, resolveAcpLaunch, runAcpTask, redactSensitive, AcpHarnessClient, createLogProjector } = require('../cluster-acp-client')
const { ClusterStore, runCluster, callLLMStream, validateProjectStart, outsideProjectWorkspace, hasPermissionDetails } = require('../cluster-runtime')

function temp(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dpa-start-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}

test('DSH version 1 refs and legacy YAML credentials use the same resolver without consuming record payloads', (t) => {
  const home = temp(t)
  fs.writeFileSync(path.join(home, '.credentials.yaml'), 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: "synthetic-key"\n  ZHIPU_API_KEY: "synthetic-glm"\nrecords:\n  "provider:test":\n    key: private-record\n')
  assert.deepEqual(loadCredentialEnv(home), { DEEPSEEK_API_KEY: 'synthetic-key', ZHIPU_API_KEY: 'synthetic-glm' })
  fs.writeFileSync(path.join(home, '.credentials.yaml'), 'DEEPSEEK_API_KEY: "legacy-key"\n')
  assert.deepEqual(loadCredentialEnv(home), { DEEPSEEK_API_KEY: 'legacy-key' })
})

test('managed credentials override project and home dotenv; parser errors never echo secret source', (t) => {
  const home = temp(t)
  const cwd = temp(t)
  fs.writeFileSync(path.join(home, '.env'), 'DEEPSEEK_API_KEY=home-key\nZHIPU_API_KEY=home-glm\n')
  fs.writeFileSync(path.join(cwd, '.env'), 'DEEPSEEK_API_KEY=project-key\n')
  assert.equal(loadCredentialEnv(home, cwd).DEEPSEEK_API_KEY, 'project-key')
  fs.writeFileSync(path.join(home, '.credentials.yaml'), 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: managed-key\n')
  assert.equal(loadCredentialEnv(home, cwd).DEEPSEEK_API_KEY, 'managed-key')
  fs.writeFileSync(path.join(home, '.credentials.yaml'), 'refs: [SECRET-SHOULD-NOT-LEAK')
  assert.throws(() => loadCredentialEnv(home), (error) => /凭据文件格式/.test(error.message) && !error.message.includes('SECRET'))
})

test('meeting API request reads versioned saved credential instead of falsely reporting it missing', async (t) => {
  const home = temp(t)
  const originalFetch = global.fetch
  const oldKey = process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  t.after(() => { global.fetch = originalFetch; if (oldKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = oldKey })
  fs.writeFileSync(path.join(home, '.credentials.yaml'), 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: synthetic-key\n')
  global.fetch = async (_url, request) => {
    assert.equal(request.headers.Authorization, 'Bearer synthetic-key')
    return new Response(JSON.stringify({ choices: [{ message: { content: '讨论结果' } }] }), { headers: { 'Content-Type': 'application/json' } })
  }
  const result = await callLLMStream({ provider: 'deepseek', system: 'fixture', user: 'fixture', homeDir: home })
  assert.equal(result.text, '讨论结果')
})

test('failed employee message terminates its stream; retry preserves conversation and clears lastError', async (t) => {
  const store = new ClusterStore({ homeDir: temp(t) })
  store.saveEmployee({ id: 'employee', name: '演示员工' })
  const project = store.saveProject({ id: 'retry', name: '测试项目', goal: 'fixture', members: [{ agent: 'employee', role: '负责人', brain: { type: 'api' } }] })
  store.appendEvent(project.id, { type: 'user.message', actor: { id: 'user', kind: 'user' }, text: '原始项目要求' })
  await assert.rejects(runCluster(project, { store, callModel: async () => { throw new Error('synthetic model unavailable') } }), /synthetic model/)
  const failed = store.getProject(project.id)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.activeRunId, '')
  const events = store.listEvents(project.id, { limit: 500 })
  const started = events.find((event) => event.type === 'agent.message.started')
  const ended = events.find((event) => event.type === 'agent.message.failed')
  assert.equal(started.meta.messageId, ended.meta.messageId)
  assert.equal(ended.channel, 'activity')
  assert.ok(events.some((event) => event.type === 'run.failed'))
  await runCluster(failed, { store, callModel: async () => ({ text: '合成结果' }), onApproval: async () => ({ status: 'approved' }) })
  assert.equal(store.getProject(project.id).status, 'accepted')
  assert.equal(store.getProject(project.id).lastError, '')
  assert.ok(store.listEvents(project.id, { limit: 500 }).some((event) => event.text === '原始项目要求'))
})

test('ACP launcher prefers supported profile CLI and retains legacy runtime compatibility', (t) => {
  const runtime = temp(t)
  const oldBin = path.join(runtime, 'packages/examples/acp-demo/src/bin.ts')
  fs.mkdirSync(path.dirname(oldBin), { recursive: true })
  fs.writeFileSync(oldBin, '')
  assert.equal(resolveAcpLaunch({ harnessDir: runtime }).modern, false)
  const modernBin = path.join(runtime, 'apps/cli/lib/bin.js')
  fs.mkdirSync(path.dirname(modernBin), { recursive: true })
  fs.writeFileSync(modernBin, '')
  const launch = resolveAcpLaunch({ harnessDir: runtime })
  assert.equal(launch.modern, true)
  assert.deepEqual(launch.args.slice(0, 4), [modernBin, '--profile', 'acp', '--patch'])
  assert.match(launch.args[4], /dpa-acp\.patch\.yml$/)
})

test('already aborted ACP task does not create workspace or launch a subprocess', async (t) => {
  const directory = path.join(temp(t), 'never-created')
  await assert.rejects(runAcpTask({ workspace: directory, signal: AbortSignal.abort() }), { name: 'AbortError' })
  assert.equal(fs.existsSync(directory), false)
})

test('source checkout uses the official tsx loader even when partial built CLI exists', (t) => {
  const runtime = temp(t)
  const sourceBin = path.join(runtime, 'apps/cli/src/bin.ts')
  const builtBin = path.join(runtime, 'apps/cli/lib/bin.js')
  for (const bin of [sourceBin, builtBin]) { fs.mkdirSync(path.dirname(bin), { recursive: true }); fs.writeFileSync(bin, '') }
  const loader = path.join(runtime, 'node_modules/tsx')
  fs.mkdirSync(loader, { recursive: true })
  fs.writeFileSync(path.join(loader, 'package.json'), JSON.stringify({ name: 'tsx', exports: { './esm': './esm.mjs' } }))
  fs.writeFileSync(path.join(loader, 'esm.mjs'), '')
  const launch = resolveAcpLaunch({ harnessDir: runtime })
  assert.deepEqual(launch.args.slice(0, 6), ['--import', 'tsx/esm', sourceBin, '--profile', 'acp', '--patch'])
})

test('source file without a resolvable loader cannot replace a built distribution', (t) => {
  const runtime = temp(t)
  const sourceBin = path.join(runtime, 'apps/cli/src/bin.ts')
  fs.mkdirSync(path.dirname(sourceBin), { recursive: true })
  fs.writeFileSync(sourceBin, '')
  assert.throws(() => resolveAcpLaunch({ harnessDir: runtime }), /执行入口不完整/)
  const builtBin = path.join(runtime, 'apps/cli/lib/bin.js')
  fs.mkdirSync(path.dirname(builtBin), { recursive: true })
  fs.writeFileSync(builtBin, '')
  assert.equal(resolveAcpLaunch({ harnessDir: runtime }).args[0], builtBin)
})

test('cancelling an employee model wait promptly closes the project run', async (t) => {
  const store = new ClusterStore({ homeDir: temp(t) })
  store.saveEmployee({ id: 'employee', name: '演示员工' })
  const project = store.saveProject({ id: 'cancel', name: '取消测试', members: [{ agent: 'employee', role: '负责人', brain: { type: 'api' } }] })
  const controller = new AbortController()
  const running = runCluster(project, { store, signal: controller.signal, callModel: () => new Promise(() => {}) })
  const timer = setTimeout(() => controller.abort(), 20)
  t.after(() => clearTimeout(timer))
  await assert.rejects(running, { name: 'AbortError' })
  assert.equal(store.getProject(project.id).status, 'cancelled')
  assert.equal(store.getProject(project.id).activeRunId, '')
})

test('preflight rejects unsupported tool provider before the meeting but accepts GLM dialogue', (t) => {
  const home = temp(t)
  fs.writeFileSync(path.join(home, '.credentials.yaml'), 'version: 1\nrefs:\n  ZHIPU_API_KEY: synthetic-key\n')
  const store = new ClusterStore({ homeDir: home })
  store.saveEmployee({ id: 'employee', name: '演示员工', provider: 'glm' })
  const project = { members: [{ agent: 'employee', brain: { type: 'dsh-acp' } }] }
  assert.throws(() => validateProjectStart(project, store), /工具执行目前需要 DeepSeek/)
  project.members[0].brain.type = 'api'
  assert.deepEqual(validateProjectStart(project, store), { ready: true })
})

test('credential diagnostics redact complete Bearer and Basic payloads', () => {
  assert.ok(!redactSensitive('Authorization: Bearer synthetic-secret').includes('synthetic-secret'))
  assert.ok(!redactSensitive('authorization=Basic abcdef==').includes('abcdef'))
})

test('Windows paths with spaces preserve project boundaries and escalation is rejected', () => {
  const workspace = 'Z:\\Work Area\\Project A'
  assert.equal(outsideProjectWorkspace({ toolCall: { rawInput: { path: 'Z:\\Work Area\\Project A\\report.md' } } }, workspace), false)
  assert.equal(outsideProjectWorkspace({ toolCall: { arguments: JSON.stringify({ path: 'Z:\\Work Area\\Project B\\report.md' }) } }, workspace), true)
  assert.equal(outsideProjectWorkspace({ toolCall: { rawInput: { path: '..\\secret.txt' } } }, workspace), true)
  assert.equal(outsideProjectWorkspace({ toolCall: { rawInput: { sandbox_permissions: 'require_escalated' } } }, workspace), true)
  assert.equal(hasPermissionDetails({ toolCall: { toolCallId: 'opaque-id' } }), false)
})

test('ACP permission requests are enriched from their exact session tool notification', async () => {
  let supplied
  const client = new AcpHarnessClient({ onPermission: (params) => { supplied = params; return 'reject' } })
  client.write = () => {}
  client.handleFrame({ method: 'session/update', params: { sessionId: 's1', update: { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'write', rawInput: { path: 'report.txt' } } } })
  client.handleFrame({ id: 1, method: 'session/request_permission', params: { sessionId: 's1', toolCall: { toolCallId: 't1' }, options: [] } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(supplied.toolCall.rawInput.path, 'report.txt')
  client.handleFrame({ id: 2, method: 'session/request_permission', params: { sessionId: 'different', toolCall: { toolCallId: 't1' }, options: [] } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(supplied.toolCall.rawInput, undefined)
})

test('concurrent ACP close calls await the same child exit', async () => {
  const client = new AcpHarnessClient({})
  let finish
  client.exitPromise = new Promise((resolve) => { finish = resolve })
  client.child = { stdin: { end() {} }, kill() {} }
  const first = client.close()
  const second = client.close()
  assert.equal(first, second)
  let ended = false
  second.then(() => { ended = true })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(ended, false)
  client.closed = true
  finish({ code: 0 })
  await second
  assert.equal(ended, true)
})

test('versioned ACP logs preserve cached usage totals and never select another session', (t) => {
  const directory = temp(t)
  const session = path.join(directory, 'session-id')
  fs.mkdirSync(session)
  fs.writeFileSync(path.join(session, 'session.v3.jsonl'), JSON.stringify({ seq: 1, type: 'assistant/message', data: { usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 30, totalTokens: 45 } } }) + '\n')
  const projector = createLogProjector({ sessionsRoot: directory })
  projector.setSessionId('not-this-session')
  projector.flush()
  assert.equal(projector.summary().usage.totalTokens, 0)
  projector.setSessionId('session-id')
  projector.flush()
  assert.equal(projector.summary().usage.totalTokens, 45)
  projector.flush()
  assert.equal(projector.summary().usage.totalTokens, 45)
})

test('parallel employee failure cancels and joins sibling teardown before allowing retry', async (t) => {
  const store = new ClusterStore({ homeDir: temp(t) })
  store.saveEmployee({ id: 'one', name: '员工一' })
  store.saveEmployee({ id: 'two', name: '员工二' })
  const project = store.saveProject({ id: 'parallel-failure', name: '并行测试', mode: 'team', members: [
    { agent: 'one', role: '负责人', rank: 1, brain: { type: 'dsh-acp' }, permission: 'full' },
    { agent: 'two', role: '执行员', rank: 2, brain: { type: 'dsh-acp' }, permission: 'full' },
  ] })
  let releaseFirst
  const secondStarted = new Promise((resolve) => { releaseFirst = resolve })
  let invocation = 0
  let siblingCleaned = false
  const running = runCluster(project, {
    store, callModel: async () => ({ text: '合成讨论与计划' }), onApproval: async () => ({ status: 'approved' }),
    runAgentTask: async (options) => {
      invocation += 1
      if (invocation === 1) {
        assert.equal(await options.onPermission({ sessionId: 's', toolCall: { toolCallId: 'unknown' } }), 'reject')
        await secondStarted
        throw new Error('first employee failed')
      }
      releaseFirst()
      await new Promise((resolve) => options.signal.addEventListener('abort', resolve, { once: true }))
      await new Promise((resolve) => setTimeout(resolve, 30))
      siblingCleaned = true
      throw Object.assign(new Error('cancelled'), { name: 'AbortError' })
    },
  })
  await assert.rejects(running, /first employee failed/)
  assert.equal(siblingCleaned, true)
  assert.equal(store.getProject(project.id).status, 'failed')
})
