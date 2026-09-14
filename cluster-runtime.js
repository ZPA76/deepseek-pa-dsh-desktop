'use strict'

// DPA 集群引擎：员工与项目属于 DPA，模型调用可替换，所有可见活动落入项目事件流。
// 三种模式是治理策略；会议、计划审批、执行、内部复核、用户验收共用同一生命周期。

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { resolveDpaPaths } = require('./dpa-paths')
const { ClusterStore, DEFAULT_DSH_HOME } = require('./cluster-store')
const { runAcpTask, redactSensitive, loadCredentialEnv, resolveAcpLaunch } = require('./cluster-acp-client')

const DSH_HOME = process.env.DSH_DESKTOP_DSH_HOME || process.env.DSH_HOME || DEFAULT_DSH_HOME
const CLUSTERS_DIR = path.join(DSH_HOME, 'clusters')
const PRESETS_DIR = path.join(DSH_HOME, '.agent-presets')

const PROVIDERS = {
  deepseek: {
    endpoint: 'https://api.deepseek.com/chat/completions',
    keyEnv: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-v4-flash',
  },
  glm: {
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    keyEnv: 'ZHIPU_API_KEY',
    defaultModel: 'glm-4.5-air',
  },
}

const GOVERNANCE_POLICIES = Object.freeze({
  hierarchy: Object.freeze({
    id: 'hierarchy',
    name: '分级负责',
    description: '负责人拆解与定稿，成员按等级汇报，关键节点仍由用户批准。',
    discussionRounds: 1,
    execution: 'sequential',
    decision: 'lead',
  }),
  team: Object.freeze({
    id: 'team',
    name: '协作共创',
    description: '成员平等发言，主持人综合方案，任务可并行推进。',
    discussionRounds: 1,
    execution: 'parallel',
    decision: 'facilitated',
  }),
  autonomous: Object.freeze({
    id: 'autonomous',
    name: '授权自治',
    description: '成员多轮协商并并行执行，用户保留计划与成果两道闸门。',
    discussionRounds: 2,
    execution: 'parallel',
    decision: 'consensus',
  }),
})

let defaultStore = null

function getDefaultStore() {
  if (!defaultStore) defaultStore = new ClusterStore({ homeDir: DSH_HOME })
  return defaultStore
}

function readSimpleYaml(file) {
  const text = fs.readFileSync(file, 'utf8')
  const object = {}
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][\w]*):\s*(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    object[match[1]] = value
  }
  return object
}

function loadCredentials(homeDir = DSH_HOME) {
  return loadCredentialEnv(homeDir, process.env.DSH_DESKTOP_HARNESS_DIR || '')
}

function modelConnection(provider, homeDir) {
  const selected = PROVIDERS[provider === 'deepseek-official' ? 'deepseek' : provider || 'deepseek']
  if (!selected) throw new Error(`会议暂不支持模型提供方「${provider}」，请在员工配置中选择 DeepSeek 或 GLM`)
  const credentials = loadCredentials(homeDir || DSH_HOME)
  const key = process.env[selected.keyEnv] || credentials[selected.keyEnv]
  if (!key) throw new Error(`未配置 ${selected.keyEnv}。请到 Agent 的模型设置中保存对应 API Key，然后回到项目点击重试`)
  return { ...selected, key }
}

function validateProjectStart(project, store = getDefaultStore()) {
  if (!project || !Array.isArray(project.members) || !project.members.length) throw new Error('项目至少需要一名员工')
  for (const member of project.members) {
    const agent = loadAgent(member.agent || member.id, store)
    modelConnection(memberProvider(member, agent), store.homeDir)
    const brain = (member.brain && member.brain.type) || (agent.brain && agent.brain.type) || 'dsh-acp'
    if (brain !== 'api') {
      if (memberProvider(member, agent) !== 'deepseek') throw new Error(`员工「${agent.name || agent.id}」的工具执行目前需要 DeepSeek，请切换提供方或选择“仅模型对话”`)
      resolveAcpLaunch({ harnessDir: process.env.DSH_DESKTOP_HARNESS_DIR || store.harnessDir || resolveDpaPaths().harnessDir })
    }
  }
  return { ready: true }
}

function presetAgent(agentId) {
  const directory = path.join(PRESETS_DIR, String(agentId || ''))
  const preset = path.join(directory, 'preset.yml')
  if (!fs.existsSync(preset)) throw new Error(`未找到 DSH 预设员工：${agentId}`)
  const meta = readSimpleYaml(preset)
  return {
    id: String(agentId),
    name: meta.name || String(agentId),
    description: meta.description || '',
    desc: meta.description || '',
    persona: `你是「${meta.name || agentId}」。${meta.description || ''}`,
    provider: meta.provider || 'deepseek',
    model: meta.model || '',
    skills: [],
    skillAccess: { mode: 'all', names: [] },
    status: 'available',
    source: 'dsh-preset',
    readOnly: true,
    brain: { type: 'dsh-acp' },
  }
}

function loadAgent(agentId, store = getDefaultStore()) {
  try {
    const employee = store.getEmployee(agentId)
    return { ...employee, desc: employee.description || employee.desc || '' }
  } catch (_) {
    return presetAgent(agentId)
  }
}

function listAgents(options = {}, store = getDefaultStore()) {
  const agents = new Map()
  for (const employee of store.listEmployees({ includeArchived: Boolean(options && options.includeArchived) })) {
    agents.set(employee.id, { ...employee, desc: employee.description || employee.desc || '' })
  }
  if (fs.existsSync(PRESETS_DIR)) {
    for (const entry of fs.readdirSync(PRESETS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory() || agents.has(entry.name)) continue
      try { agents.set(entry.name, presetAgent(entry.name)) } catch (_) {}
    }
  }
  return [...agents.values()]
}

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function normalizedSkillAccess(agent = {}) {
  const value = agent.skillAccess && typeof agent.skillAccess === 'object' ? agent.skillAccess : {}
  const mode = ['all', 'selected', 'none'].includes(value.mode) ? value.mode : 'all'
  const names = [...new Set((Array.isArray(value.names) ? value.names : [])
    .map((item) => String(item || '').trim())
    .filter((item) => SKILL_NAME_PATTERN.test(item)))]
    .slice(0, 50)
  return { mode, names }
}

function frontmatterValue(frontmatter, key) {
  const lines = String(frontmatter || '').split(/\r?\n/)
  const index = lines.findIndex((line) => line.trimStart().startsWith(key + ':'))
  if (index < 0) return ''
  let value = lines[index].trimStart().slice(key.length + 1).trim()
  if (value === '|' || value === '>') {
    const folded = []
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (lines[cursor] && !/^\s/.test(lines[cursor])) break
      folded.push(lines[cursor].trim())
    }
    value = value === '>' ? folded.join(' ') : folded.join('\n')
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }
  return value.trim()
}

function readSkillSummary(file, source, rank) {
  let text = ''
  try { text = fs.readFileSync(file, 'utf8') } catch (_) { return null }
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) return null
  const name = frontmatterValue(match[1], 'name')
  const description = frontmatterValue(match[1], 'description')
  if (!SKILL_NAME_PATTERN.test(name) || !description) return null
  return {
    name,
    description,
    source,
    rank,
    modelInvocable: frontmatterValue(match[1], 'disable-model-invocation').toLowerCase() !== 'true',
    userInvocable: frontmatterValue(match[1], 'disable-user-invocation').toLowerCase() !== 'true',
  }
}

function scanSkillRoot(root, source, rank) {
  let entries = []
  try { entries = fs.readdirSync(root, { withFileTypes: true }) } catch (_) { return [] }
  const skills = []
  for (const entry of entries) {
    let file = ''
    if (entry.isDirectory()) file = path.join(root, entry.name, 'SKILL.md')
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) file = path.join(root, entry.name)
    if (!file || !fs.existsSync(file)) continue
    const summary = readSkillSummary(file, source, rank)
    if (summary) skills.push(summary)
  }
  return skills
}

function listSkills(payload = {}, store = getDefaultStore()) {
  let workspace = ''
  if (payload && payload.projectId) workspace = store.getProject(String(payload.projectId)).workspace
  const agentConfigRoot = path.resolve(process.env.DSH_AGENTS_HOME || path.join(os.homedir(), '.agents'))
  const roots = []
  if (workspace) {
    roots.push(
      { root: path.join(workspace, '.dsh', 'skills'), source: '项目 DSH', rank: 100 },
      { root: path.join(workspace, '.agents', 'skills'), source: '项目 Agents', rank: 200 },
    )
  }
  roots.push(
    { root: path.join(store.homeDir, 'skills'), source: 'DPA 用户', rank: 400 },
    { root: path.join(agentConfigRoot, 'skills'), source: '共享 Agents', rank: 500 },
  )
  if (process.env.DSH_BUNDLED_SKILL_DIR) {
    roots.push({ root: path.resolve(process.env.DSH_BUNDLED_SKILL_DIR), source: 'Harness 内置', rank: 600 })
  }

  const winners = new Map()
  for (const item of roots) {
    for (const skill of scanSkillRoot(item.root, item.source, item.rank)) {
      const existing = winners.get(skill.name)
      if (!existing || skill.rank < existing.rank) winners.set(skill.name, skill)
    }
  }
  return {
    skills: [...winners.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ rank, ...skill }) => skill),
    roots: roots.map((item) => ({ source: item.source, available: fs.existsSync(item.root) })),
  }
}

function saveAgent(agent, store = getDefaultStore()) {
  return store.saveEmployee(agent)
}

function archiveAgent(agentId, archived = true, store = getDefaultStore()) {
  return store.archiveEmployee(agentId, archived)
}

function listAgentVersions(agentId, store = getDefaultStore()) {
  return store.listEmployeeVersions(agentId)
}

function restoreAgentVersion(agentId, version, store = getDefaultStore()) {
  return store.restoreEmployeeVersion(agentId, version)
}

function listTrainingRuns(agentId, store = getDefaultStore()) {
  return store.listTrainingRuns(agentId)
}

function promoteTrainingRun(agentId, runId, store = getDefaultStore()) {
  return store.promoteTrainingRun(agentId, runId)
}

function deleteAgent(agentId, store = getDefaultStore()) {
  return store.deleteEmployee(agentId)
}

function addProjectMember(projectId, memberInput, store = getDefaultStore()) {
  const project = store.getProject(projectId)
  if (!memberInput || !memberInput.agent) throw new Error('新员工缺少来源员工')
  if (project.members.some((member) => (member.agent || member.id) === memberInput.agent)) throw new Error('该员工已在项目中')
  const members = [...project.members, memberInput]
  const saved = store.saveProject({ ...project, members })
  store.appendEvent(projectId, {
    actor: { id: memberInput.agent, name: memberInput.name || memberInput.role || memberInput.agent, kind: 'employee' },
    type: 'member.added',
    text: `「${memberInput.name || memberInput.role || memberInput.agent}」加入项目（${memberInput.role || '项目成员'}）`,
    meta: { member: memberInput },
  })
  return saved
}

function removeProjectMember(projectId, memberId, store = getDefaultStore()) {
  const project = store.getProject(projectId)
  const target = project.members.find((member) => (member.agent || member.id) === memberId)
  if (!target) throw new Error('该员工不在项目中')
  const members = project.members.filter((member) => (member.agent || member.id) !== memberId)
  const saved = store.saveProject({ ...project, members })
  for (const task of store.listTasks(projectId).filter((item) => item.assigneeId === memberId && item.status === 'todo')) {
    store.saveTask(projectId, { ...task, status: 'cancelled', error: '员工已移出项目' })
  }
  store.appendEvent(projectId, {
    actor: { id: memberId, name: target.name || target.role || memberId, kind: 'employee' },
    type: 'member.removed',
    text: `「${target.name || target.role || memberId}」移出项目，未开始任务已取消`,
  })
  return saved
}

function parseJsonObject(text, label = '模型输出') {
  const value = String(text || '').trim()
  const start = value.indexOf('{')
  const end = value.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error(`${label}不是有效 JSON`)
  try { return JSON.parse(value.slice(start, end + 1)) } catch (error) {
    throw new Error(`${label}解析失败：${error.message}`)
  }
}

function flattenText(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(flattenText).filter(Boolean).join('\n')
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, item]) => `${key}：${flattenText(item)}`)
      .filter((line) => line && !line.endsWith('：'))
      .join('\n')
  }
  return String(value)
}

function normalizeCandidate(candidate, current = {}) {
  return {
    name: String(candidate.name == null ? current.name || '' : candidate.name).trim(),
    description: flattenText(candidate.description == null ? current.description || '' : candidate.description).trim(),
    persona: flattenText(candidate.persona == null ? current.persona || '' : candidate.persona).trim(),
    provider: String(candidate.provider || current.provider || 'deepseek'),
    model: String(candidate.model == null ? current.model || '' : candidate.model).trim(),
    skills: Array.isArray(candidate.skills) ? candidate.skills.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 20) : (current.skills || []),
    brain: candidate.brain && typeof candidate.brain === 'object' ? candidate.brain : (current.brain || { type: 'dsh-acp' }),
    developmentSummary: String(candidate.developmentSummary || '').trim(),
  }
}

async function draftAgent(payload = {}, store = getDefaultStore()) {
  const mentor = payload.mentorId ? loadAgent(payload.mentorId, store) : null
  const provider = payload.provider || (mentor && mentor.provider) || 'deepseek'
  const model = payload.model || (mentor && mentor.model) || ''
  const mentorContext = mentor
    ? `你以员工「${mentor.name}」的身份担任培养导师。导师准则：${mentor.persona || mentor.description || '务实、可检验。'}`
    : '你是 DPA 的员工架构师。'
  const result = await callLLMStream({
    provider,
    model,
    temperature: 0.35,
    homeDir: store.homeDir,
    system: [
      mentorContext,
      '根据用户的岗位要求起草一名可长期培养的数字员工。直接输出 JSON，不要 markdown。',
      '字段：name、description、persona、skills（数组）、provider、model、brain（固定为 {"type":"dsh-acp"}）。',
      'persona 必须包含职责边界、证据标准、协作方式和禁止事项；不得冒充已经掌握未验证能力。',
    ].join('\n'),
    user: `岗位培养要求：\n${String(payload.brief || payload.description || '').trim() || '请起草一名通用项目员工。'}`,
  })
  const candidate = normalizeCandidate(parseJsonObject(result.text, '员工草案'))
  return {
    ...candidate,
    lineage: { mentorId: mentor ? mentor.id : '', draftedAt: new Date().toISOString() },
  }
}

async function trainAgent(payload = {}, store = getDefaultStore()) {
  const employeeId = String(payload.employeeId || payload.id || '')
  const current = store.getEmployee(employeeId)
  const mentor = payload.mentorId ? loadAgent(payload.mentorId, store) : null
  const goal = String(payload.goal || '').trim()
  if (!goal) throw new Error('请填写本次培养目标')
  const mentorProvider = (mentor && mentor.provider) || current.provider || 'deepseek'
  const mentorModel = (mentor && mentor.model) || current.model || ''
  const proposalResult = await callLLMStream({
    provider: mentorProvider,
    model: mentorModel,
    temperature: 0.35,
    homeDir: store.homeDir,
    system: [
      mentor ? `你是培养导师「${mentor.name}」。${mentor.persona || mentor.description || ''}` : '你是 DPA 的员工培养教练。',
      '你只生成候选版本，不直接覆盖员工。依据现状、培养目标和情境样例强化身份与能力。',
      '直接输出 JSON：description、persona、skills（数组）、developmentSummary。不要 markdown。',
      '保留员工稳定身份；新增能力必须写明证据标准和边界，不得虚构真实训练数据或能力提升。',
    ].join('\n'),
    user: `当前员工档案：\n${JSON.stringify({ name: current.name, description: current.description, persona: current.persona, skills: current.skills }, null, 2)}\n\n培养目标：${goal}\n\n情境任务/学习材料：\n${String(payload.sample || payload.material || '（未提供）')}`,
  })
  const candidate = normalizeCandidate(parseJsonObject(proposalResult.text, '培养候选版本'), current)
  const evaluationResult = await callLLMStream({
    provider: current.provider || 'deepseek',
    model: current.model || '',
    temperature: 0.1,
    homeDir: store.homeDir,
    system: [
      '你是独立员工考核员，不参与候选版本撰写。检查候选是否更贴合目标，同时避免身份漂移和虚构能力。',
      '直接输出 JSON：score（0-10）、passed（布尔）、reasons（数组）、risks（数组）。7 分及以上才可 passed=true。',
    ].join('\n'),
    user: `培养目标：${goal}\n\n原档案：\n${JSON.stringify(current, null, 2)}\n\n候选档案：\n${JSON.stringify(candidate, null, 2)}\n\n情境样例：\n${String(payload.sample || payload.material || '（未提供）')}`,
  })
  const rawEvaluation = parseJsonObject(evaluationResult.text, '考核结果')
  const score = Math.max(0, Math.min(10, Number(rawEvaluation.score || 0)))
  const evaluation = {
    score,
    passed: Boolean(rawEvaluation.passed) && score >= 7,
    reasons: Array.isArray(rawEvaluation.reasons) ? rawEvaluation.reasons.map(String).slice(0, 8) : [],
    risks: Array.isArray(rawEvaluation.risks) ? rawEvaluation.risks.map(String).slice(0, 8) : [],
  }
  return store.saveTrainingRun(employeeId, {
    mentorId: mentor ? mentor.id : '',
    goal,
    sample: String(payload.sample || payload.material || ''),
    status: 'candidate',
    baseVersion: current.version,
    candidate,
    evaluation,
  })
}

function normalizeUsage(raw = {}) {
  const reportedInputTokens = Number(raw.prompt_tokens || raw.input_tokens || 0)
  const outputTokens = Number(raw.completion_tokens || raw.output_tokens || 0)
  const cacheReadTokens = Number(
    raw.prompt_cache_hit_tokens ||
    (raw.prompt_tokens_details && (raw.prompt_tokens_details.cached_tokens || raw.prompt_tokens_details.cache_read_tokens)) ||
    0
  )
  const cacheWriteTokens = Number((raw.prompt_tokens_details && raw.prompt_tokens_details.cache_write_tokens) || 0)
  const inputTokens = Number.isFinite(Number(raw.prompt_cache_miss_tokens))
    ? Number(raw.prompt_cache_miss_tokens)
    : Math.max(0, reportedInputTokens - cacheReadTokens)
  const denominator = inputTokens + cacheReadTokens + cacheWriteTokens
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: Number(raw.total_tokens || inputTokens + outputTokens),
    cacheHitPercent: denominator > 0 ? Math.round((cacheReadTokens / denominator) * 1000) / 10 : 0,
  }
}

function applyStreamPayload(payload, state, onDelta) {
  if (!payload || typeof payload !== 'object') return
  if (payload.usage) state.usage = payload.usage
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : null
  const delta = choice && choice.delta && choice.delta.content
  if (typeof delta === 'string' && delta) {
    state.text += delta
    if (onDelta) onDelta(delta)
  }
  const complete = choice && choice.message && choice.message.content
  if (typeof complete === 'string' && complete && !state.text) {
    state.text = complete
    if (onDelta) onDelta(complete)
  }
}

async function readOpenAIStream(response, onDelta) {
  const state = { text: '', usage: {} }
  const contentType = String(response.headers.get('content-type') || '')
  if (!contentType.includes('text/event-stream')) {
    const payload = await response.json()
    applyStreamPayload(payload, state, onDelta)
    return { text: state.text.trim(), usage: normalizeUsage(state.usage) }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const consumeBlock = (block) => {
    const data = block.split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
      .trim()
    if (!data || data === '[DONE]') return
    try { applyStreamPayload(JSON.parse(data), state, onDelta) } catch (_) {}
  }

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
    const blocks = buffer.split(/\r?\n\r?\n/)
    buffer = blocks.pop() || ''
    for (const block of blocks) consumeBlock(block)
    if (done) break
  }
  if (buffer.trim()) consumeBlock(buffer)
  return { text: state.text.trim(), usage: normalizeUsage(state.usage) }
}

async function callLLMStream({ provider, model, system, user, temperature = 0.7, signal, onDelta, homeDir, timeoutMs = 180000, maxTokens }) {
  const selected = modelConnection(provider, homeDir)
  const key = selected.key
  const timeout = AbortSignal.timeout(Math.max(1000, timeoutMs))
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  const response = await fetch(selected.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: model || selected.defaultModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature,
      stream: true,
      stream_options: { include_usage: true },
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
    }),
    signal: requestSignal,
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`LLM 调用失败 (${provider || 'deepseek'}/${model || selected.defaultModel}): ${response.status} ${redactSensitive(body).slice(0, 240)}`)
  }
  const result = await readOpenAIStream(response, onDelta)
  if (!result.text) throw new Error(`LLM 返回空内容 (${provider || 'deepseek'})`)
  return result
}

async function callLLM(options) {
  const result = await callLLMStream(options)
  return result.text
}

function abortError() {
  const error = new Error('操作已取消')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) throw abortError()
}

function raceWithAbort(promise, signal) {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve(promise).then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value) },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error) }
    )
  })
}

function actorForMember(member, agent) {
  return {
    id: String(member.agent || member.id || agent.id || 'employee'),
    name: String(agent.name || member.name || member.role || '员工'),
    role: String(member.role || ''),
    kind: 'employee',
  }
}

function legacyType(eventType) {
  if (eventType === 'run.completed') return 'done'
  if (eventType.endsWith('.delta')) return 'delta'
  if (eventType.includes('activity') || eventType === 'phase.changed') return 'thinking'
  if (eventType.includes('message') || eventType.includes('artifact')) return 'message'
  if (eventType.includes('error') || eventType === 'run.failed') return 'error'
  return 'system'
}

function createRuntime(project, handlers, store, runId) {
  const onStep = typeof handlers.onStep === 'function' ? handlers.onStep : null
  const signal = handlers.signal
  return {
    project,
    store,
    runId,
    signal,
    handlers,
    publish(type, data = {}, persist = true) {
      const input = {
        runId,
        phase: data.phase || this.project.phase || '',
        taskId: data.taskId || '',
        actor: data.actor || { id: 'system', name: 'DPA', kind: 'system' },
        type,
        audience: data.audience || 'project',
        text: data.text || '',
        status: data.status || '',
        metrics: data.metrics,
        channel: data.channel || '',
        purpose: data.purpose || '',
        visibility: data.visibility || '',
        meta: data.meta,
      }
      const event = persist ? store.appendEvent(this.project.id, input) : {
        ...input,
        id: data.id || crypto.randomUUID(),
        projectId: this.project.id,
        timestamp: new Date().toISOString(),
      }
      if (onStep) {
        try {
          onStep({
            ...event,
            eventType: type,
            type: legacyType(type),
            from: event.actor && event.actor.id,
            role: event.actor && event.actor.role,
            messageId: data.messageId || (data.meta && data.meta.messageId) || '',
          })
        } catch (_) {}
      }
      return event
    },
    async checkpoint() {
      throwIfAborted(signal)
      if (handlers.waitIfPaused) await raceWithAbort(handlers.waitIfPaused(), signal)
      throwIfAborted(signal)
    },
    consumeUserMessages() {
      if (!handlers.consumeUserMessages) return []
      const messages = handlers.consumeUserMessages()
      return Array.isArray(messages) ? messages : []
    },
  }
}

function memberSystem(project, member, agent) {
  const persona = agent.persona || `你是「${agent.name || member.role}」。${agent.description || ''}`
  const lines = [
    persona,
    '',
    `【项目】${project.name}`,
    `【项目目标】${project.goal}`,
    `【你的项目职务】${member.role}`,
    member.duty ? `【本项目职责】${member.duty}` : '',
  ]
  const skills = Array.isArray(agent.skills) ? agent.skills.filter(Boolean) : []
  if (skills.length) lines.push('', `【已配置能力】${skills.join('、')}`)
  const toolBrain = (member.brain && member.brain.type) || (agent.brain && agent.brain.type) || 'dsh-acp'
  if (toolBrain === 'codex') lines.push('【执行后端】优先调用 Harness 的 subagent_codex，让真实 Codex 在本项目工作区完成任务；最终汇报操作结果，不要只停留在对话。')
  if (toolBrain === 'claude-code') lines.push('【执行后端】优先调用 Harness 的 subagent_claude_code，让真实 Claude Code 在本项目工作区完成任务；最终汇报操作结果，不要只停留在对话。')
  if (toolBrain === 'dsh-acp') {
    const skillAccess = normalizedSkillAccess(agent)
    if (skillAccess.mode === 'none') lines.push('【Skill】该员工已禁用 Skill 工具')
    else if (skillAccess.mode === 'selected') lines.push('【Skill】指定优先：' + (skillAccess.names.join('、') || '尚未选择'))
    else lines.push('【Skill】可从当前项目与 DPA 用户目录按需发现并调用')
  }

  if (agent.development && agent.development.lastTrainingRunId) {
    lines.push(`【培养档案】当前员工版本 v${agent.version || 1}，最近培养记录 ${agent.development.lastTrainingRunId}`)
  }
  const experiences = Array.isArray(agent.experience) ? agent.experience.slice(-5) : []
  if (experiences.length) {
    lines.push('', '【你的历史经验（过去项目沉淀，务必遵守）】')
    for (const entry of experiences) {
      if (entry && entry.lesson) lines.push(`- ${entry.lesson}`)
    }
  }
  lines.push('', '你的发言会展示给项目参与者。请给出结论、行动、证据和风险，不要输出隐藏思维过程或冗长的自我推理。')
  return lines.filter(Boolean).join('\n')
}

function memberProvider(member, agent) {
  const provider = member.provider || agent.provider || 'deepseek'
  return provider === 'deepseek-official' ? 'deepseek' : provider
}

function memberModel(member, agent) {
  return member.model || agent.model || ''
}

async function callEmployee(runtime, member, prompt, activity, options = {}) {
  await runtime.checkpoint()
  const userMessages = runtime.consumeUserMessages()
  if (userMessages.length) {
    prompt += `\n\n【用户在项目房间补充的最新要求】\n${userMessages.map((message) => `- ${message.text}`).join('\n')}`
  }
  const agent = loadAgent(member.agent || member.id, runtime.store)
  const actor = actorForMember(member, agent)
  const messageId = crypto.randomUUID()
  const channel = options.channel || 'worklog'
  const purpose = options.purpose || (channel === 'room' ? 'discussion' : 'work')
  const visibility = options.visibility || (channel === 'room' ? 'participants' : 'owner')
  const messageMeta = { ...(options.meta || {}), messageId, channel, purpose }
  runtime.publish('agent.activity', { actor, text: activity || '正在处理…', taskId: options.taskId, channel: 'activity', purpose: 'progress', visibility: 'owner' })
  runtime.publish('agent.message.started', { actor, text: '', taskId: options.taskId, channel, purpose, visibility, meta: messageMeta })
  const invoke = runtime.handlersCallModel || callLLMStream
  let result
  try { result = await raceWithAbort(invoke({
    provider: memberProvider(member, agent),
    model: memberModel(member, agent),
    system: options.system || memberSystem(runtime.project, member, agent),
    user: prompt,
    temperature: options.temperature == null ? 0.65 : options.temperature,
    signal: runtime.signal,
    homeDir: runtime.store.homeDir,
    onDelta: (delta) => !runtime.signal?.aborted && runtime.publish('agent.message.delta', {
      actor,
      text: delta,
      taskId: options.taskId,
      messageId,
      channel,
      purpose,
      visibility,
      meta: messageMeta,
    }, false),
  }), runtime.signal) } catch (error) {
    runtime.publish('agent.message.failed', { actor, taskId: options.taskId, channel: 'activity', purpose: 'diagnostic', visibility: 'owner', text: redactSensitive(error.message || error), meta: messageMeta })
    throw error
  }
  const normalized = typeof result === 'string' ? { text: result, usage: normalizeUsage({}) } : result
  const text = String(normalized.text || '').trim()
  if (!text) throw new Error(`${actor.name} 返回了空内容`)
  runtime.publish('agent.message.completed', { actor, text, taskId: options.taskId, metrics: normalized.usage, channel, purpose, visibility, meta: messageMeta })
  if (normalized.usage && normalized.usage.totalTokens) {
    runtime.publish('telemetry.usage', {
      actor,
      text: `${actor.name} 本次调用 ${normalized.usage.totalTokens} tokens`,
      taskId: options.taskId,
      metrics: normalized.usage,
      channel: 'worklog',
      purpose: 'telemetry',
      visibility: 'owner',
      meta: { messageId, channel: 'worklog', purpose: 'telemetry' },
    })
  }
  return { text, usage: normalized.usage, actor }
}

function sortMembers(project, policy, round = 1) {
  const members = [...project.members]
  if (policy.id === 'hierarchy') members.sort((a, b) => Number(a.rank || 99) - Number(b.rank || 99))
  if (policy.id === 'autonomous' && round % 2 === 0 && members.length > 1) members.push(members.shift())
  return members
}

function leadMember(project) {
  return [...project.members].sort((a, b) => Number(a.rank || 99) - Number(b.rank || 99))[0]
}

function truncateContext(text, max = 14000) {
  const value = String(text || '')
  return value.length > max ? `…（前文已压缩）\n${value.slice(-max)}` : value
}

function normalizeApprovalResult(result) {
  if (result === 'approved' || result === true) return { status: 'approved', feedback: '' }
  if (result === 'rejected' || result === false) return { status: 'rejected', feedback: '' }
  if (typeof result === 'string') return { status: 'rejected', feedback: result }
  const status = result && ['approved', 'rejected', 'cancelled'].includes(result.status) ? result.status : 'rejected'
  return { status, feedback: String((result && result.feedback) || '') }
}

async function composeApprovalPacket(runtime, { subject, material }) {
  const tasks = runtime.store.listTasks(runtime.project.id)
  const actions = runtime.store.listActions(runtime.project.id)
  const decisions = runtime.store.listDecisions(runtime.project.id)
  const evidence = {
    completedTasks: tasks.filter((item) => item.status === 'done').map((item) => ({
      title: item.title,
      assignee: item.assigneeRole || item.assigneeId,
      output: truncateContext(item.output, 1200),
    })).slice(-12),
    toolActions: actions.map((item) => ({
      title: item.title || item.tool || item.id,
      status: item.status,
      employee: item.actorName || item.actorId,
      summary: item.summary || item.text || '',
    })).slice(-20),
    decisions: decisions.map((item) => ({ title: item.title, status: item.status, content: truncateContext(item.content, 800) })).slice(-8),
  }
  const result = await callLLMStream({
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    temperature: 0.1,
    signal: runtime.signal,
    homeDir: runtime.store.homeDir,
    system: [
      '你是 DPA 的项目审批秘书。把材料整理成可审计的老板审批单。',
      '只能使用材料和证据 JSON 中真实出现的信息，禁止把讨论设想写成已完成工作。',
      '直接输出 JSON，不要 markdown。字段：decision（一句话）、workCompleted（已实际完成工作数组）、discussionResults（讨论结论数组）、approvalItems（老板本次必须决定的具体事项数组）、toolActions（实际电脑操作摘要数组）、risks（风险/依赖数组）、next（一句话）。',
      '若没有实际完成工作或电脑操作，对应字段必须为空数组。',
    ].join('\n'),
    user: `审批事项：${subject}\n\n原始材料：\n${truncateContext(material, 12000)}\n\n可核查证据 JSON：\n${JSON.stringify(evidence, null, 2)}`,
  })
  const parsed = parseJsonObject(result.text, '审批简报')
  const array = (value, max) => Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, max) : []
  return {
    decision: String(parsed.decision || subject),
    workCompleted: array(parsed.workCompleted, 10),
    discussionResults: array(parsed.discussionResults, 8),
    approvalItems: array(parsed.approvalItems, 8),
    toolActions: array(parsed.toolActions, 12),
    risks: array(parsed.risks, 8),
    next: String(parsed.next || '批准后按当前项目阶段继续推进；退回后将按反馈修订。'),
  }
}

async function requestApproval(runtime, handlers, kind, version, subject, contextText, material, options = {}) {
  let packet = {
    decision: subject,
    workCompleted: [],
    discussionResults: [],
    approvalItems: [subject],
    toolActions: [],
    risks: [],
    next: '批准后继续推进；退回后按意见修订。',
  }
  if (material) {
    try { packet = await composeApprovalPacket(runtime, { subject, material }) } catch (_) {}
  }
  const approvalId = String(options.id || `${kind}-v${version}`).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 160)
  const approval = runtime.store.saveApproval(runtime.project.id, {
    id: approvalId,
    kind,
    version,
    status: 'pending',
    subject,
    contextText,
    packet,
    brief: {
      decision: packet.decision,
      outputs: packet.workCompleted,
      conclusions: packet.discussionResults,
      risks: packet.risks,
      next: packet.next,
    },
    runId: runtime.runId,
    meta: options.meta || {},
  })
  runtime.publish('approval.requested', {
    actor: options.actor,
    taskId: options.taskId,
    text: subject,
    status: 'pending',
    meta: { approvalId: approval.id, kind, version, packet },
  })
  const pending = handlers.onApproval
    ? handlers.onApproval({ ...approval, projectId: runtime.project.id })
    : Promise.resolve({ status: 'approved', feedback: '' })
  const result = normalizeApprovalResult(await raceWithAbort(pending, runtime.signal))
  runtime.store.saveApproval(runtime.project.id, { ...approval, ...result, resolvedAt: new Date().toISOString() })
  runtime.publish('approval.resolved', {
    actor: { id: 'user', name: '你', kind: 'user' },
    taskId: options.taskId,
    text: result.feedback || (result.status === 'approved' ? '已批准' : '已退回'),
    status: result.status,
    meta: { approvalId: approval.id, kind, version },
  })
  return result
}

function createTasks(runtime, plan) {
  const runTag = runtime.runId.replace(/[^A-Za-z0-9._-]/g, '').slice(-16)
  return runtime.project.members.map((member, index) => {
    const task = runtime.store.saveTask(runtime.project.id, {
      id: `task-${runTag}-${String(index + 1).padStart(2, '0')}`,
      title: `${member.role || `员工 ${index + 1}`}负责部分`,
      description: member.duty || `依据获批方案完成 ${member.role || '本职'} 工作。`,
      assigneeId: member.agent || member.id,
      assigneeRole: member.role,
      rank: member.rank,
      status: 'todo',
      plan,
      runId: runtime.runId,
      order: index + 1,
    })
    runtime.publish('task.created', { text: task.title, taskId: task.id, status: task.status, meta: { task } })
    return task
  })
}

const PERMISSION_LABEL = { ask: '请求批准', auto: '风险托管', full: '项目内完全访问' }

function assessTaskRisk(value) {
  const text = String(value || '').toLowerCase()
  const matches = []
  const rules = [
    ['删除/覆盖数据', /\b(delete|remove|erase|overwrite|format|drop|truncate)\b|删除|清空|覆盖|格式化/],
    ['安装或修改系统', /\b(install|uninstall|registry|service|driver|admin|sudo)\b|安装|卸载|注册表|系统服务|管理员/],
    ['对外发布或发送', /\b(publish|deploy|release|send|email|upload|post)\b|发布|部署|发送|邮件|上传/],
    ['凭据或账户', /\b(password|secret|token|credential|login)\b|密码|密钥|令牌|登录|账号/],
  ]
  for (const [label, pattern] of rules) if (pattern.test(text)) matches.push(label)
  return { level: matches.length ? 'high' : 'low', reasons: matches }
}

function actionId(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24)
}

function outsideProjectWorkspace(params, workspace) {
  const text = JSON.stringify(params || {})
  if (/danger-full-access|require_escalated|bypassPermissions|outside\s+(?:the\s+)?workspace|workspace\s+escape/i.test(text)) return true
  const paths = []
  const visit = (value, key = '') => {
    if (Array.isArray(value)) return value.forEach((item) => visit(item, key))
    if (value && typeof value === 'object') return Object.entries(value).forEach(([name, item]) => visit(item, name))
    if (typeof value !== 'string') return
    if (['arguments', 'rawInput'].includes(key)) {
      try { return visit(JSON.parse(value)) } catch (_) { /* Legacy arguments may be plain text. */ }
    }
    if (/^(path|cwd|workspace|workingDirectory|directory|file|filename|target)$/i.test(key)) paths.push(value)
    else {
      // Quoted shell paths keep their spaces; unquoted shell paths terminate at whitespace.
      for (const match of value.matchAll(/["']([A-Za-z]:[\\/][^"']+)["']|\b([A-Za-z]:[\\/][^\s"']+)/g)) paths.push(match[1] || match[2])
    }
  }
  visit(params)
  const pathApi = /^[A-Za-z]:[\\/]/.test(workspace) ? path.win32 : path
  const root = pathApi.resolve(workspace).toLowerCase()
  return paths.some((candidate) => {
    const target = pathApi.resolve(workspace, candidate).toLowerCase()
    return target !== root && !target.startsWith(root + pathApi.sep.toLowerCase())
  })
}

function hasPermissionDetails(params) {
  const call = params && params.toolCall
  return Boolean(call && (call.title || call.arguments || call.rawInput || call.path || call.command))
}

async function runDshAcpTask(runtime, task, member, plan, meeting) {
  const harnessDir = process.env.DSH_DESKTOP_HARNESS_DIR || runtime.store.harnessDir || resolveDpaPaths().harnessDir
  const agent = loadAgent(member.agent || member.id, runtime.store)
  const configuredProvider = memberProvider(member, agent)
  if (configuredProvider !== 'deepseek') {
    throw new Error(`Harness 工具智能体当前仅支持 DeepSeek；员工「${agent.name || agent.id}」配置为 ${configuredProvider}，请改用“仅模型对话”或切换模型服务。`)
  }
  const actor = actorForMember(member, agent)
  const permission = ['ask', 'auto', 'full'].includes(member.permission) ? member.permission : 'ask'
  const workspace = path.resolve(runtime.project.workspace || path.join(runtime.store.homeDir, 'workspaces', runtime.project.id))
  const skillAccess = normalizedSkillAccess(agent)
  const sessionsRoot = path.join(runtime.store.projectDir(runtime.project.id), 'sessions', runtime.runId, task.id)
  const baseActionId = `agent-${actionId(`${runtime.runId}:${task.id}`)}`
  let permissionSeq = 0
  const toolActions = new Map()
  const action = runtime.store.saveAction(runtime.project.id, {
    id: baseActionId,
    runId: runtime.runId,
    taskId: task.id,
    actorId: actor.id,
    actorName: actor.name,
    title: task.title,
    permission,
    workspace,
    status: 'running',
    startedAt: new Date().toISOString(),
  })
  runtime.publish('action.started', {
    actor,
    taskId: task.id,
    text: `${actor.name} 开始实际操作电脑（${PERMISSION_LABEL[permission]}）`,
    status: 'running',
    meta: { actionId: action.id, permission, workspace },
  })

  const selectedSkillTokens = skillAccess.names.map((name) => '/' + name).join(' ')
  let skillPrelude = '【Skill 使用策略】可按任务需要先调用 skill 工具加载当前会话目录中的 Skill。'
  if (skillAccess.mode === 'none') {
    skillPrelude = '【Skill 使用策略】该员工已禁用 Skill；不要尝试调用 skill 工具。'
  } else if (skillAccess.mode === 'selected') {
    skillPrelude = selectedSkillTokens
      ? selectedSkillTokens + '\n【Skill 使用策略】先加载以上指定优先 Skill；其他 Skill 仅在任务明确需要时调用，并在操作轨迹中留痕。'
      : '【Skill 使用策略】当前为指定优先模式，但尚未选择名称；仅在任务明确需要时调用 Skill。'
  }

  const brief = [
    skillPrelude,
    memberSystem(runtime.project, member, agent),
    `【你的任务】${task.title}：${task.description}`,
    `【获批计划】\n${truncateContext(plan, 8000)}`,
    `【会议摘要】\n${truncateContext(meeting, 6000)}`,
    `【项目工作区】${workspace}`,
    (member.brain && member.brain.type === 'codex' ? '本任务必须优先调用 subagent_codex；如该工具不可用，请明确报告，不要假装已执行。' : ''),
    (member.brain && member.brain.type === 'claude-code' ? '本任务必须优先调用 subagent_claude_code；如该工具不可用，请明确报告，不要假装已执行。' : ''),
    '请在项目工作区内实际完成任务，可使用文件、Shell、检索和其他 Harness 工具。每项操作应可核查；不得读取或改动项目范围外数据。完成后说明完成项、变更文件、验证结果、限制和风险。不要输出隐藏思维过程。',
  ].join('\n\n')

  const decidePermission = async (params) => {
    permissionSeq += 1
    const detail = redactSensitive(JSON.stringify(params || {}))
    if (!hasPermissionDetails(params)) {
      runtime.publish('action.permission-blocked', { actor, taskId: task.id, text: 'DSH 未提供此操作的参数，无法确认权限范围，本次授权已拒绝。请查看工具轨迹或更新 DSH。', status: 'rejected', meta: { actionId: action.id } })
      return 'reject'
    }
    if (outsideProjectWorkspace(params, workspace)) {
      runtime.publish('action.permission-blocked', {
        actor,
        taskId: task.id,
        text: '已阻止越出项目工作区的操作请求',
        status: 'rejected',
        meta: { actionId: action.id, detail: truncateContext(detail, 1200) },
      })
      return 'reject'
    }
    const risk = assessTaskRisk(detail)
    if (permission === 'full') return 'allow'
    if (permission === 'auto' && risk.level === 'low') return 'allow'
    const approval = await requestApproval(
      runtime,
      runtime.handlers,
      'tool-permission',
      permissionSeq,
      `「${actor.name}」请求执行电脑操作`,
      `任务：${task.title}\n权限策略：${PERMISSION_LABEL[permission]}\n风险：${risk.level === 'high' ? risk.reasons.join('、') : '未发现高风险关键词'}\n\n操作请求：\n${truncateContext(detail, 5000)}`,
      `电脑操作请求：\n${detail}`,
      {
        id: `${baseActionId}-permission-${permissionSeq}`,
        actor,
        taskId: task.id,
        meta: { actionId: action.id, risk },
      },
    )
    return approval.status === 'approved' ? 'allow' : 'reject'
  }

  const invoke = runtime.handlers.runAgentTask || runAcpTask
  try {
    const result = await invoke({
      harnessDir,
      dshHome: runtime.store.homeDir,
      skillMode: skillAccess.mode,
      brainType: (member.brain && member.brain.type) || (agent.brain && agent.brain.type) || 'dsh-acp',
      workspace,
      sessionsRoot,
      provider: memberProvider(member, agent) === 'deepseek' ? 'deepseek-official' : memberProvider(member, agent),
      model: memberModel(member, agent) || 'deepseek-v4-pro',
      persona: memberSystem(runtime.project, member, agent),
      prompt: brief,
      signal: runtime.signal,
      onPermission: decidePermission,
      onSession: (sessionId) => {
        runtime.store.saveAction(runtime.project.id, { ...action, sessionId, status: 'running' })
      },
      onDiagnostic: (text) => {
        if (text) runtime.publish('agent.activity', { actor, taskId: task.id, text: `Harness：${text}`, channel: 'activity', purpose: 'diagnostic', visibility: 'owner' })
      },
      onEvent: (event) => {
        const meta = { ...(event.meta || {}), actionId: action.id }
        runtime.publish(event.type, {
          actor,
          taskId: task.id,
          text: event.text,
          status: event.status,
          metrics: event.metrics,
          channel: 'worklog',
          purpose: event.type === 'tool.call' || event.type === 'tool.result' ? 'tool-use' : 'execution',
          visibility: 'owner',
          meta,
        })
        if (event.type === 'tool.call') {
          const callId = String(meta.callId || actionId(event.text))
          const id = `tool-${actionId(`${baseActionId}:${callId}`)}`
          toolActions.set(callId, id)
          runtime.store.saveAction(runtime.project.id, {
            id,
            parentActionId: action.id,
            runId: runtime.runId,
            taskId: task.id,
            actorId: actor.id,
            actorName: actor.name,
            title: event.text || meta.tool || '工具调用',
            tool: meta.tool || '',
            arguments: meta.arguments || '',
            permission,
            workspace,
            status: 'running',
            startedAt: new Date().toISOString(),
          })
        } else if (event.type === 'tool.result') {
          const callId = String(meta.callId || '')
          const id = toolActions.get(callId)
          if (id) runtime.store.saveAction(runtime.project.id, {
            id,
            status: event.status === 'failed' ? 'failed' : 'done',
            summary: event.text || '',
            completedAt: new Date().toISOString(),
          })
        }
      },
    })
    runtime.store.saveAction(runtime.project.id, {
      ...action,
      status: 'done',
      sessionId: result.sessionId,
      toolCalls: result.toolCalls,
      usage: result.usage,
      logFile: result.logFile,
      summary: result.text,
      completedAt: new Date().toISOString(),
    })
    runtime.publish('action.completed', {
      actor,
      taskId: task.id,
      text: `${actor.name} 已完成电脑操作，共 ${result.toolCalls || 0} 次工具调用`,
      status: 'done',
      metrics: result.usage,
      meta: { actionId: action.id, sessionId: result.sessionId, toolCalls: result.toolCalls },
    })
    return { ...result, actor }
  } catch (error) {
    runtime.store.saveAction(runtime.project.id, {
      ...action,
      status: 'failed',
      error: String(error.message || error),
      completedAt: new Date().toISOString(),
    })
    runtime.publish('action.failed', {
      actor,
      taskId: task.id,
      text: `${actor.name} 操作失败：${error.message || error}`,
      status: 'failed',
      meta: { actionId: action.id },
    })
    throw error
  }
}

async function executeTask(runtime, task, member, plan, meeting) {
  runtime.store.saveTask(runtime.project.id, { ...task, status: 'doing', startedAt: new Date().toISOString() })
  runtime.publish('task.updated', { text: `${task.title} · 开始`, taskId: task.id, status: 'doing' })
  try {
    const brainType = member.brain && member.brain.type
    let result
    if (brainType === 'dsh-acp' || brainType === 'dsh-subagent' || brainType === 'codex' || brainType === 'claude-code') {
      const permission = ['ask', 'auto', 'full'].includes(member.permission) ? member.permission : 'ask'
      const taskRisk = assessTaskRisk(`${task.title}\n${task.description}`)
      if (permission === 'ask' || (permission === 'auto' && taskRisk.level === 'high')) {
        const approval = await requestApproval(
          runtime,
          runtime.handlers,
          'task-exec',
          1,
          `「${member.role}」要调用电脑执行任务：${task.title}`,
          `任务说明：${task.title}\n${task.description}\n\n权限：${PERMISSION_LABEL[permission]}。批准后，员工只在项目工作区内使用 Harness 工具实际执行。`,
          `任务：${task.title}\n${task.description}`,
          {
            id: `task-exec-${task.id}`,
            actor: actorForMember(member, loadAgent(member.agent || member.id, runtime.store)),
            taskId: task.id,
            meta: { risk: taskRisk },
          },
        )
        if (approval.status === 'rejected') throw new Error(`任务执行未获批准：${approval.feedback || '用户拒绝'}`)
        if (approval.status === 'cancelled') throw abortError()
      }
      result = await runDshAcpTask(runtime, task, member, plan, meeting)
    } else {
      result = await callEmployee(runtime, member,
        `获批的项目计划：\n${plan}\n\n会议摘要：\n${truncateContext(meeting, 7000)}\n\n` +
        `你的任务是「${task.title}」：${task.description}\n请直接提交可合并的工作成果，并列出完成项、证据/依据、风险与待协作事项。`,
        `正在执行「${task.title}」`, { taskId: task.id })
    }
    const completed = runtime.store.saveTask(runtime.project.id, {
      ...task,
      status: 'done',
      output: result.text,
      usage: result.usage,
      execution: result.sessionId ? { type: 'harness-acp', sessionId: result.sessionId, toolCalls: result.toolCalls, logFile: result.logFile } : { type: 'model' },
      completedAt: new Date().toISOString(),
    })
    runtime.publish('task.updated', { actor: result.actor, text: `${task.title} · 已完成`, taskId: task.id, status: 'done', meta: { task: completed } })
    return completed
  } catch (error) {
    runtime.store.saveTask(runtime.project.id, { ...task, status: 'failed', error: error.message })
    runtime.publish('task.updated', { text: `${task.title} · 失败：${error.message}`, taskId: task.id, status: 'failed' })
    throw error
  }
}

async function distillExperience(runtime, { members, plan, final, outputs }) {
  const roster = members.map((member) => `- ${member.role}（员工 ID：${member.agent || member.id}）`).join('\n')
  const result = await callLLMStream({
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    temperature: 0.3,
    signal: runtime.signal,
    homeDir: runtime.store.homeDir,
    system: [
      '你是员工成长复盘员。请从项目记录中为每位员工提炼 1-2 条可复用的经验教训，',
      '使该员工下次遇到类似情况时表现更好。只输出 JSON 数组，不要任何解释文字：',
      '[{"employeeId":"员工ID","lessons":["经验教训…"]}]',
      '严格规则：只使用项目记录中真实出现的信息；禁止编造。',
    ].join('\n'),
    user: `员工名册：\n${roster}\n\n获批计划：\n${truncateContext(plan, 6000)}\n\n员工交付汇总：\n${truncateContext(outputs, 8000)}\n\n最终成果：\n${truncateContext(final, 4000)}`,
  })
  const text = String(result.text || '').trim()
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  const groups = JSON.parse(text.slice(start, end + 1))
  const recorded = []
  for (const group of (Array.isArray(groups) ? groups : [])) {
    const employeeId = String((group && group.employeeId) || '')
    const lessons = Array.isArray(group && group.lessons) ? group.lessons.map(String).filter(Boolean) : []
    if (!employeeId || !lessons.length) continue
    try {
      runtime.store.appendEmployeeExperience(employeeId, lessons.map((lesson) => ({
        lesson,
        projectId: runtime.project.id,
        tags: [],
      })))
      for (const lesson of lessons) {
        recorded.push(employeeId)
        runtime.publish('experience.recorded', {
          actor: { id: employeeId, name: employeeId, kind: 'employee' },
          text: lesson,
          meta: { employeeId, projectId: runtime.project.id },
        })
      }
    } catch (_) {
      // preset 只读员工或已归档员工：跳过写入
    }
  }
  return recorded
}

async function runCluster(projectInput, handlers = {}) {
  const store = handlers.store || getDefaultStore()
  let project = store.saveProject(projectInput)
  if (!project.members.length) throw new Error('项目至少需要一名员工')
  const policy = GOVERNANCE_POLICIES[project.mode] || GOVERNANCE_POLICIES.hierarchy
  const runId = handlers.runId || `run-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
  const runController = new AbortController()
  const runSignal = handlers.signal ? AbortSignal.any([handlers.signal, runController.signal]) : runController.signal
  const runtime = createRuntime(project, { ...handlers, signal: runSignal }, store, runId)
  runtime.handlersCallModel = handlers.callModel

  const setPhase = (phase, status = 'active') => {
    runtime.project = store.updateProject(project.id, { phase, status, activeRunId: runId })
    project = runtime.project // 每个阶段边界重读项目（含运行中的增员/减员）
    runtime.publish('phase.changed', { phase, text: phase, status })
  }

  try {
    if (!handlers.callModel) validateProjectStart(project, store)
    store.updateProject(project.id, { lastError: '' })
    const userBrief = store.listEvents(project.id, { limit: 200 })
      .filter((event) => event.type === 'user.message')
      .map((event) => event.text)
      .join('\n')
    setPhase('kickoff')
    runtime.publish('run.started', { text: `${policy.name}项目启动：${project.goal}`, meta: { policy } })

    setPhase('discussion')
    const discussion = []
    for (let round = 1; round <= policy.discussionRounds; round += 1) {
      runtime.publish('meeting.round', { text: `第 ${round} 轮项目会议`, meta: { round } })
      for (const member of sortMembers(project, policy, round)) {
        const context = discussion.map((item) => `【${item.role}】${item.text}`).join('\n\n')
        const result = await callEmployee(runtime, member,
          `这是项目启动会议第 ${round} 轮。\n用户在项目房间的任务介绍：\n${truncateContext(userBrief, 9000) || project.goal}\n\n` +
          `目前公开会议记录：\n${truncateContext(context) || '（暂无）'}\n\n` +
          '请从你的岗位出发发言：澄清需求，说明你准备承担的工作、与谁协作、主要风险以及希望用户确认的事项。',
          '正在准备会议发言', { channel: 'room', purpose: 'discussion', visibility: 'participants' })
        discussion.push({ role: member.role, memberId: member.agent || member.id, text: result.text })
      }
    }

    setPhase('planning')
    const lead = leadMember(project)
    const meetingText = discussion.map((item) => `【${item.role}】${item.text}`).join('\n\n')
    let planVersion = Math.max(0, ...store.listApprovals(project.id)
      .filter((approval) => approval.kind === 'plan')
      .map((approval) => Number(approval.version || 0))) + 1
    let planAttempts = 1
    let planResult = await callEmployee(runtime, lead,
      `你是本次项目的计划整合负责人。治理策略：${policy.description}\n\n用户任务介绍：\n${truncateContext(userBrief, 9000) || project.goal}\n\n` +
      `全部会议记录：\n${truncateContext(meetingText)}\n\n` +
      '请形成可审批的项目计划，必须包含：目标与范围、任务分解、负责人、依赖关系、交付标准、风险、需要用户确认的决策。',
      '正在整理项目计划')
    let plan = planResult.text

    while (true) {
      const approval = await requestApproval(runtime, handlers, 'plan', planVersion, `审批第 ${planVersion} 版项目计划`, plan, `用户任务介绍：\n${truncateContext(userBrief, 6000) || project.goal}\n\n项目会议讨论：\n${truncateContext(meetingText, 8000)}`)
      if (approval.status === 'approved') break
      if (approval.status === 'cancelled') throw abortError()
      if (planAttempts >= 3) throw new Error('项目计划连续三次未获批准，已停止自动执行')
      planAttempts += 1
      planVersion += 1
      planResult = await callEmployee(runtime, lead,
        `上一版计划：\n${plan}\n\n用户退回意见：\n${approval.feedback || '请重新检查范围和分工。'}\n\n` +
        '请给出修订后的完整计划，明确标注本次修改，并保持可执行、可验收。',
        '正在根据审批意见修订计划')
      plan = planResult.text
    }
    store.saveDecision(project.id, { id: `project-plan-v${planVersion}`, kind: 'plan', title: `已批准项目计划 v${planVersion}`, content: plan, version: planVersion, status: 'approved', runId })
    runtime.publish('decision.recorded', { text: '项目计划已批准', status: 'approved', meta: { kind: 'plan', version: planVersion } })

    setPhase('execution')
    const tasks = createTasks(runtime, plan)
    let completedTasks
    if (policy.execution === 'parallel') {
      let firstFailure
      const settled = await Promise.allSettled(tasks.map((task, index) => executeTask(runtime, task, project.members[index], plan, meetingText).catch((error) => {
        firstFailure ||= error
        runController.abort()
        throw error
      })))
      if (firstFailure) throw firstFailure
      completedTasks = settled.map((item) => item.value)
    } else {
      completedTasks = []
      for (let index = 0; index < tasks.length; index += 1) {
        completedTasks.push(await executeTask(runtime, tasks[index], project.members[index], plan, meetingText))
      }
    }

    setPhase('internal-review')
    const outputs = completedTasks.map((task) => `【${task.assigneeRole}｜${task.title}】\n${task.output}`).join('\n\n')
    const reviewResult = await callEmployee(runtime, lead,
      `获批计划：\n${plan}\n\n员工交付：\n${truncateContext(outputs, 24000)}\n\n` +
      '请执行内部复核并形成提交给用户的完整成果。整合重复内容，指出完成度、证据、限制、风险和下一步；不要声称未实际完成的工作。',
      '正在进行内部复核与汇总')

    let artifactVersion = Math.max(0, ...store.listArtifacts(project.id)
      .filter((item) => item.kind === 'final')
      .map((item) => Number(item.version || 0))) + 1
    let revisionAttempts = 0
    let final = reviewResult.text
    let artifact = store.saveArtifact(project.id, {
      id: `final-v${artifactVersion}`,
      kind: 'final',
      title: `项目最终成果 v${artifactVersion}`,
      version: artifactVersion,
      content: final,
      status: 'awaiting-acceptance',
      runId,
    })
    runtime.publish('artifact.created', { text: artifact.title, status: artifact.status, meta: { artifactId: artifact.id, artifact } })

    setPhase('acceptance', 'awaiting-acceptance')
    while (true) {
      const acceptance = await requestApproval(runtime, handlers, 'acceptance', artifactVersion, `验收成果 v${artifactVersion}`, final, `获批计划：\n${truncateContext(plan, 6000)}\n\n员工交付汇总：\n${truncateContext(outputs, 10000)}`)
      if (acceptance.status === 'approved') {
        artifact = store.saveArtifact(project.id, { ...artifact, status: 'accepted', acceptedAt: new Date().toISOString() })
        break
      }
      if (acceptance.status === 'cancelled') throw abortError()
      if (revisionAttempts >= 4) throw new Error('成果已连续返工五次，请人工调整项目计划后再继续')
      revisionAttempts += 1

      setPhase('revision')
      const revisionTask = store.saveTask(project.id, {
        id: `revision-${runId.replace(/[^A-Za-z0-9._-]/g, '').slice(-16)}-${artifactVersion + 1}`,
        title: `根据用户意见返工 v${artifactVersion + 1}`,
        description: acceptance.feedback || '根据用户验收意见修改成果',
        assigneeId: lead.agent || lead.id,
        assigneeRole: lead.role,
        status: 'doing',
        runId,
      })
      runtime.publish('task.created', { text: revisionTask.title, taskId: revisionTask.id, status: 'doing', meta: { task: revisionTask } })
      const revision = await callEmployee(runtime, lead,
        `当前成果：\n${final}\n\n用户验收意见：\n${acceptance.feedback || '请进一步完善。'}\n\n` +
        `其他员工原始产出可供核对：\n${truncateContext(outputs, 16000)}\n\n请提交修订后的完整成果，并先列出本次修改清单。`,
        '正在根据验收意见返工', { taskId: revisionTask.id })
      final = revision.text
      artifactVersion += 1
      store.saveTask(project.id, { ...revisionTask, status: 'done', output: final, completedAt: new Date().toISOString() })
      artifact = store.saveArtifact(project.id, {
        id: `final-v${artifactVersion}`,
        kind: 'final',
        title: `项目最终成果 v${artifactVersion}`,
        version: artifactVersion,
        content: final,
        status: 'awaiting-acceptance',
        previousArtifactId: `final-v${artifactVersion - 1}`,
        runId,
      })
      runtime.publish('artifact.created', { text: artifact.title, status: artifact.status, meta: { artifactId: artifact.id, artifact } })
      setPhase('acceptance', 'awaiting-acceptance')
    }

    setPhase('consolidation')
    try {
      await distillExperience(runtime, { members: project.members, plan, final, outputs })
    } catch (_) {
      // 经验沉淀失败不影响项目验收结论
    }

    runtime.project = store.updateProject(project.id, { phase: 'accepted', status: 'accepted', activeRunId: '' })
    runtime.publish('run.completed', {
      phase: 'accepted',
      text: '项目已通过用户验收',
      status: 'accepted',
      meta: { artifactId: artifact.id, planVersion, artifactVersion },
    })
    return { runId, policy, plan, planVersion, tasks: completedTasks, final, artifact, status: 'accepted' }
  } catch (error) {
    runController.abort()
    const cancelled = error && error.name === 'AbortError'
    try {
      store.updateProject(project.id, {
        status: cancelled ? 'cancelled' : 'failed',
        phase: cancelled ? 'cancelled' : 'failed',
        activeRunId: '',
        lastError: cancelled ? '' : redactSensitive(error.message || error),
      })
      runtime.publish(cancelled ? 'run.cancelled' : 'run.failed', {
        phase: cancelled ? 'cancelled' : 'failed',
        text: cancelled ? '项目运行已取消' : redactSensitive(error.message || error),
        status: cancelled ? 'cancelled' : 'failed',
      })
    } catch (_) {}
    throw error
  }
}

function loadProject(id, store = getDefaultStore()) { return store.getProject(id) }
function listProjects(store = getDefaultStore()) { return store.listProjects() }
function saveProject(project, store = getDefaultStore()) { return store.saveProject(project) }
function listEvents(id, options, store = getDefaultStore()) { return store.listEvents(id, options) }
function getProjectOverview(id, store = getDefaultStore()) { return store.getProjectOverview(id) }
function appendEvent(id, event, store = getDefaultStore()) { return store.appendEvent(id, event) }
function listTrashedProjects(store = getDefaultStore()) { return store.listTrashedProjects() }
function archiveProject(id, archived = true, store = getDefaultStore()) { return store.archiveProject(id, archived) }
function trashProject(id, store = getDefaultStore()) { return store.trashProject(id) }
function restoreProject(id, store = getDefaultStore()) { return store.restoreProject(id) }
function setProjectImportance(id, level, store = getDefaultStore()) { return store.setProjectImportance(id, level) }
function deleteProjectForever(id, store = getDefaultStore()) { return store.deleteProjectForever(id) }
function emptyProjectTrash(store = getDefaultStore()) { return store.emptyProjectTrash() }

module.exports = {
  DSH_HOME,
  CLUSTERS_DIR,
  PRESETS_DIR,
  PROVIDERS,
  GOVERNANCE_POLICIES,
  ClusterStore,
  appendEvent,
  listTrashedProjects,
  archiveProject,
  trashProject,
  restoreProject,
  setProjectImportance,
  deleteProjectForever,
  emptyProjectTrash,
  callLLM,
  callLLMStream,
  validateProjectStart,
  getProjectOverview,
  listAgents,
  listSkills,
  listEvents,
  listProjects,
  loadAgent,
  loadProject,
  normalizeUsage,
  readOpenAIStream,
  runCluster,
  saveAgent,
  saveProject,
  archiveAgent,
  assessTaskRisk,
  outsideProjectWorkspace,
  hasPermissionDetails,
  actionId,
  deleteAgent,
  draftAgent,
  listAgentVersions,
  listTrainingRuns,
  promoteTrainingRun,
  restoreAgentVersion,
  trainAgent,
  runDshAcpTask,
  addProjectMember,
  removeProjectMember,
}

if (require.main === module) {
  const id = process.argv[2]
  if (!id) {
    console.error('用法：node cluster-runtime.js <项目id>')
    process.exit(1)
  }
  runCluster(loadProject(id), {
    onStep: (event) => console.log(`[${event.eventType}] ${event.role || event.from || ''} ${String(event.text || '').slice(0, 100)}`),
  }).then((result) => console.log(`\n===== 最终成果 =====\n${result.final}`))
    .catch((error) => { console.error('执行失败：', error.message); process.exit(1) })
}
