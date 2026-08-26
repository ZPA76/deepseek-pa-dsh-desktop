'use strict'

const state = {
  agents: [],
  appearance: null,
  skillCatalog: { skills: [], roots: [] },
  projects: [],
  current: null,
  overview: null,
  events: [],
  runState: { running: false },
  streams: new Map(),
  inspector: 'tasks',
  requestId: 0,
  showArchived: false,
  showTrash: false,
  editingProject: null,
  pending: new Map(),
  refreshTimer: null,
  refreshBusy: false,
}

const MAX_RENDERED_EVENTS = 2000
const MAX_RENDERED_STREAMS = 16

const MODE = {
  hierarchy: { name: '分级负责', short: '负责人决策 · 逐级执行' },
  team: { name: '协作共创', short: '平等讨论 · 主持整合' },
  autonomous: { name: '授权自治', short: '多轮协商 · 并行执行' },
}

const PHASE = {
  draft: '草拟', kickoff: '启动', discussion: '项目会议', planning: '计划整理',
  execution: '执行', 'internal-review': '内部复核', acceptance: '等待验收',
  revision: '返工', accepted: '已验收', failed: '失败', cancelled: '已取消',
}

function byId(id) { return document.getElementById(id) }

function node(tag, className, text) {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text != null) element.textContent = String(text)
  return element
}

function clear(element) {
  while (element.firstChild) element.removeChild(element.firstChild)
}

function request(method, payload = {}, timeout = 45000) {
  const id = `cluster-${Date.now()}-${++state.requestId}`
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.pending.delete(id)
      reject(new Error(`操作超时：${method}`))
    }, timeout)
    state.pending.set(id, { resolve, reject, timer })
    window.parent.postMessage({ type: 'cluster:request', id, method, payload }, '*')
  })
}

function toast(message, kind = '') {
  const box = byId('toast')
  box.textContent = String(message || '')
  box.className = `toast${kind ? ` ${kind}` : ''}`
  box.classList.remove('hidden')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => box.classList.add('hidden'), 3800)
}

function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function initials(name) {
  return String(name || 'AI').trim().slice(0, 2).toUpperCase()
}

function safeIdFrom(text, prefix) {
  const slug = String(text || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42)
  return slug || `${prefix}-${Date.now().toString(36)}`
}

function statusLabel(status) {
  const labels = {
    draft: '未启动', active: '运行中', pausing: '暂停中', paused: '已暂停',
    'awaiting-acceptance': '待验收', accepted: '已完成', failed: '失败', cancelled: '已取消',
    todo: '待办', doing: '进行中', done: '完成', pending: '待审批', rejected: '已退回', approved: '已批准',
  }
  return labels[status] || status || '未知'
}

const LAYOUT_STORAGE_KEY = 'dpa.cluster.layout.v1'
const LAYOUT_DEFAULTS = { projectSidebar: 270, roster: 190, inspector: 310 }
const LAYOUT_LIMITS = {
  projectSidebar: { min: 210, max: 480 },
  roster: { min: 165, max: 360 },
  inspector: { min: 270, max: 560 },
}
const LAYOUT_VARIABLES = {
  projectSidebar: '--project-sidebar-width',
  roster: '--roster-width',
  inspector: '--inspector-width',
}

function loadLayoutWidths() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) || '{}')
    return { ...LAYOUT_DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) }
  } catch (_) {
    return { ...LAYOUT_DEFAULTS }
  }
}

const layoutWidths = loadLayoutWidths()

function layoutBounds(key) {
  const base = LAYOUT_LIMITS[key]
  let max = base.max
  const projectLayout = document.querySelector('.projects-layout')
  const room = document.querySelector('.room-grid')
  if (key === 'projectSidebar' && projectLayout && projectLayout.clientWidth) {
    max = Math.min(max, Math.max(base.min, projectLayout.clientWidth - 440))
  }
  if (room && room.clientWidth && window.innerWidth > 1000) {
    if (key === 'roster') max = Math.min(max, Math.max(base.min, room.clientWidth - Number(layoutWidths.inspector || 310) - 352))
    if (key === 'inspector') max = Math.min(max, Math.max(base.min, room.clientWidth - Number(layoutWidths.roster || 190) - 352))
  }
  return { min: base.min, max }
}

function setLayoutWidth(key, value, persist = true) {
  const bounds = layoutBounds(key)
  const width = Math.round(Math.max(bounds.min, Math.min(bounds.max, Number(value) || LAYOUT_DEFAULTS[key])))
  layoutWidths[key] = width
  document.documentElement.style.setProperty(LAYOUT_VARIABLES[key], width + 'px')
  const handleId = {
    projectSidebar: 'project-sidebar-resizer',
    roster: 'roster-resizer',
    inspector: 'inspector-resizer',
  }[key]
  const handle = byId(handleId)
  if (handle) {
    handle.setAttribute('aria-valuemin', String(bounds.min))
    handle.setAttribute('aria-valuemax', String(bounds.max))
    handle.setAttribute('aria-valuenow', String(width))
  }
  if (persist) {
    try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layoutWidths)) } catch (_) {}
  }
}

function applyLayoutWidths(persist = false) {
  for (const key of Object.keys(LAYOUT_DEFAULTS)) setLayoutWidth(key, layoutWidths[key], persist)
}

function setupResizableLayout() {
  const definitions = [
    { id: 'project-sidebar-resizer', key: 'projectSidebar', direction: 1 },
    { id: 'roster-resizer', key: 'roster', direction: 1 },
    { id: 'inspector-resizer', key: 'inspector', direction: -1 },
  ]
  applyLayoutWidths(false)
  for (const definition of definitions) {
    const handle = byId(definition.id)
    if (!handle) continue
    const moveBy = (screenDelta) => {
      setLayoutWidth(definition.key, Number(layoutWidths[definition.key]) + screenDelta * definition.direction)
    }
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      const startX = event.clientX
      const startWidth = Number(layoutWidths[definition.key])
      handle.classList.add('dragging')
      document.body.classList.add('columns-resizing')
      const onMove = (moveEvent) => {
        setLayoutWidth(definition.key, startWidth + (moveEvent.clientX - startX) * definition.direction)
      }
      const finish = () => {
        handle.classList.remove('dragging')
        document.body.classList.remove('columns-resizing')
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', finish)
        window.removeEventListener('pointercancel', finish)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', finish)
      window.addEventListener('pointercancel', finish)
    })
    handle.addEventListener('dblclick', () => setLayoutWidth(definition.key, LAYOUT_DEFAULTS[definition.key]))
    handle.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return
      event.preventDefault()
      if (event.key === 'Home') return setLayoutWidth(definition.key, LAYOUT_DEFAULTS[definition.key])
      const step = event.shiftKey ? 25 : 10
      moveBy(event.key === 'ArrowRight' ? step : -step)
    })
  }
  window.addEventListener('resize', () => applyLayoutWidths(false))
}

// ── P4 成员状态（休息 / 运行中 / 交付待审批）─────────────────────────────
const MEMBER_STATE = {
  idle: '休息',
  running: '运行中',
  awaiting: '交付待审批',
}

function recentActivity(memberId, minutes = 4) {
  const cutoff = Date.now() - minutes * 60 * 1000
  return state.events.some((event) => {
    const actor = event.actor || {}
    const type = canonicalType(event)
    return actor.id === memberId &&
      (type === 'agent.activity' || type === 'agent.message.started' || type === 'agent.message.completed') &&
      new Date(event.timestamp).getTime() >= cutoff
  })
}

function memberStatus(member) {
  const memberId = member.agent || member.id
  const approval = pendingApproval()
  if (approval) {
    const lead = [...(state.current.members || [])].sort((a, b) => Number(a.rank || 99) - Number(b.rank || 99))[0]
    if (lead && (lead.agent || lead.id) === memberId) return 'awaiting'
  }
  if (state.runState && state.runState.running) {
    const task = (state.overview.tasks || []).find((item) => item.assigneeId === memberId && item.status === 'doing')
    if (task) return 'running'
    const streaming = [...state.streams.values()].some((stream) => stream.actor && stream.actor.id === memberId)
    if (streaming) return 'running'
    if (recentActivity(memberId)) return 'running'
  }
  return 'idle'
}

function setView(name) {
  byId('view-employees').classList.toggle('hidden', name !== 'employees')
  byId('view-projects').classList.toggle('hidden', name !== 'projects')
  byId('nav-employees').classList.toggle('active', name === 'employees')
  byId('nav-projects').classList.toggle('active', name === 'projects')
}

function fillMentorSelect(select, currentId = '') {
  clear(select)
  const base = node('option', '', 'DPA 内置教练')
  base.value = ''
  select.append(base)
  for (const agent of state.agents.filter((item) => !item.archived && item.id !== currentId)) {
    const option = node('option', '', `${agent.name || agent.id} · v${agent.version || 1}`)
    option.value = agent.id
    select.append(option)
  }
}

function skillNamesFromInput() {
  return [...new Set(byId('employee-skill-names').value
    .split(/[，,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean))]
}

function renderSkillCatalog() {
  const mode = byId('employee-skill-mode').value || 'all'
  const selection = byId('employee-skill-selection')
  const input = byId('employee-skill-names')
  const catalog = byId('employee-skill-catalog')
  selection.className = 'field full skill-selection mode-' + mode
  input.disabled = mode !== 'selected'
  clear(catalog)
  const selected = new Set(skillNamesFromInput())
  const skills = state.skillCatalog && Array.isArray(state.skillCatalog.skills) ? state.skillCatalog.skills : []
  if (!skills.length) {
    catalog.append(node('span', 'skill-empty', '当前用户目录尚未发现 Skill；项目内 Skill 仍会在进入相应项目工作区后自动发现。'))
    return
  }
  for (const skill of skills) {
    const button = node('button', 'skill-option' + (selected.has(skill.name) ? ' selected' : ''), skill.name)
    button.type = 'button'
    button.title = (skill.description || '') + (skill.source ? '\n来源：' + skill.source : '')
    button.addEventListener('click', () => {
      const names = new Set(skillNamesFromInput())
      if (names.has(skill.name)) names.delete(skill.name)
      else names.add(skill.name)
      byId('employee-skill-mode').value = 'selected'
      input.value = [...names].join('，')
      renderSkillCatalog()
    })
    catalog.append(button)
  }
}

function skillAccessLabel(agent) {
  const access = agent && agent.skillAccess && typeof agent.skillAccess === 'object' ? agent.skillAccess : { mode: 'all', names: [] }
  if (access.mode === 'none') return 'Skill 已禁用'
  if (access.mode === 'selected') return 'Skill 优先 ×' + (Array.isArray(access.names) ? access.names.length : 0)
  return 'Skill 按需'
}

function renderEmployees() {
  const grid = byId('employee-grid')
  clear(grid)
  const agents = state.agents.filter((agent) => state.showArchived || !agent.archived)
  if (!agents.length) {
    grid.append(node('div', 'subtle', state.agents.length ? '没有可显示的员工。' : '还没有员工配置。点击“新建员工”创建第一位 DPA 员工。'))
    return
  }
  for (const agent of agents) {
    const card = node('article', `employee-card${agent.archived ? ' archived' : ''}`)
    const top = node('div', 'employee-top')
    top.append(node('div', 'avatar', initials(agent.name)))
    const identity = node('div')
    identity.append(node('div', 'employee-name', agent.name || agent.id))
    identity.append(node('div', 'micro', `${agent.id} · v${agent.version || 1} · ${agent.brain && agent.brain.type === 'api' ? '仅对话' : 'Harness 工具员工'}`))
    top.append(identity)
    card.append(top)
    card.append(node('div', 'employee-desc', agent.description || agent.desc || '尚未填写岗位说明'))
    const chips = node('div', 'chip-row')
    const skillList = Array.isArray(agent.skills) ? agent.skills : []
    for (const skill of skillList.slice(0, 3)) chips.append(node('span', 'chip', skill))
    if (!skillList.length) chips.append(node('span', 'chip', agent.model || '默认模型'))
    chips.append(node('span', 'chip', skillAccessLabel(agent)))
    const expCount = Array.isArray(agent.experience) ? agent.experience.length : 0
    chips.append(node('span', 'chip experience', `经验 ×${expCount}`))
    card.append(chips)

    const source = node('div', 'employee-source')
    source.append(node('span', 'source-tag', agent.archived ? '已归档' : (agent.readOnly ? 'DSH 预设' : 'DPA 员工')))
    card.append(source)
    const actions = node('div', 'employee-actions')
    const edit = node('button', 'btn small', agent.readOnly ? '复制并培养' : '编辑')
    edit.type = 'button'
    edit.addEventListener('click', () => openEmployeeDialog(agent, agent.readOnly))
    actions.append(edit)
    if (!agent.readOnly) {
      const develop = node('button', 'btn small primary', '继续培养')
      develop.type = 'button'
      develop.addEventListener('click', () => openDevelopment(agent))
      actions.append(develop)
      const archive = node('button', 'btn small ghost', agent.archived ? '恢复' : '归档')
      archive.type = 'button'
      archive.addEventListener('click', async () => {
        if (!agent.archived && !window.confirm(`归档员工「${agent.name || agent.id}」？项目历史和成长档案都会保留。`)) return
        try {
          await request('archiveAgent', { id: agent.id, archived: !agent.archived })
          await refreshAgents()
          toast(agent.archived ? '员工已恢复' : '员工已归档')
        } catch (error) { toast(error.message, 'error') }
      })
      actions.append(archive)
      const remove = node('button', 'btn small danger', '删除')
      remove.type = 'button'
      remove.addEventListener('click', async () => {
        if (!window.confirm(`删除员工「${agent.name || agent.id}」？仅未参与项目的员工可删除，数据会移入可恢复回收目录。`)) return
        try {
          await request('deleteAgent', { id: agent.id })
          await refreshAgents()
          toast('员工已移入可恢复回收目录')
        } catch (error) { toast(error.message, 'error') }
      })
      actions.append(remove)
    }
    if (expCount) {
      const viewExp = node('button', 'btn small ghost', '经验')
      viewExp.type = 'button'
      viewExp.addEventListener('click', () => {
        const experience = agent.experience || []
        openDetail(`${agent.name} 的历史经验`, experience.slice().reverse().map((entry, index) => `#${experience.length - index} ${entry.lesson || ''}`).join('\n\n'))
      })
      actions.append(viewExp)
    }
    card.append(actions)
    card.addEventListener('click', (event) => {
      if (event.target.closest('button')) return
      if (agent.readOnly) openEmployeeDialog(agent, true)
      else openDevelopment(agent)
    })
    grid.append(card)
  }
}

async function refreshAgents() {
  state.agents = await request('listAgents', { includeArchived: state.showArchived })
  renderEmployees()
  renderWizardMembers()
}

function openEmployeeDialog(agent = null, clonePreset = false) {
  const dialog = byId('employee-dialog')
  byId('employee-form').reset()
  state.employeeDraftLineage = null
  const editing = agent && !clonePreset
  byId('employee-dialog-title').textContent = clonePreset ? '复制为 DPA 员工' : (editing ? '编辑员工配置' : '新建员工')
  byId('employee-id').value = clonePreset ? `${agent.id}-dpa` : (agent ? agent.id : '')
  byId('employee-id').disabled = Boolean(editing)
  byId('employee-name').value = agent ? agent.name || '' : ''
  byId('employee-description').value = agent ? agent.description || agent.desc || '' : ''
  byId('employee-persona').value = agent ? agent.persona || '' : ''
  byId('employee-provider').value = agent ? agent.provider || 'deepseek' : 'deepseek'
  byId('employee-model').value = agent ? agent.model || '' : ''
  byId('employee-brain').value = agent && agent.brain && agent.brain.type === 'api' ? 'api' : 'dsh-acp'
  byId('employee-skills').value = agent && Array.isArray(agent.skills) ? agent.skills.join('，') : ''
  const skillAccess = agent && agent.skillAccess && typeof agent.skillAccess === 'object' ? agent.skillAccess : { mode: 'all', names: [] }
  byId('employee-skill-mode').value = ['all', 'selected', 'none'].includes(skillAccess.mode) ? skillAccess.mode : 'all'
  byId('employee-skill-names').value = Array.isArray(skillAccess.names) ? skillAccess.names.join('，') : ''
  renderSkillCatalog()
  byId('employee-draft-brief').value = ''
  fillMentorSelect(byId('employee-mentor'), editing ? agent.id : '')
  dialog.showModal()
}

async function draftEmployee() {
  const brief = byId('employee-draft-brief').value.trim()
  if (!brief) return toast('请先填写岗位要求', 'error')
  const button = byId('employee-ai-draft')
  button.disabled = true
  button.textContent = '正在起草…'
  try {
    const draft = await request('draftAgent', {
      brief,
      mentorId: byId('employee-mentor').value,
      provider: byId('employee-provider').value,
      model: byId('employee-model').value.trim(),
    }, 180000)
    byId('employee-name').value = draft.name || byId('employee-name').value
    byId('employee-description').value = draft.description || ''
    byId('employee-persona').value = draft.persona || ''
    byId('employee-provider').value = draft.provider || 'deepseek'
    byId('employee-model').value = draft.model || ''
    byId('employee-brain').value = draft.brain && draft.brain.type === 'api' ? 'api' : 'dsh-acp'
    byId('employee-skills').value = Array.isArray(draft.skills) ? draft.skills.join('，') : ''
    state.employeeDraftLineage = draft.lineage || null
    toast('草案已填入，请检查后保存')
  } catch (error) { toast(error.message, 'error') }
  finally {
    button.disabled = false
    button.textContent = 'AI 起草配置'
  }
}

async function saveEmployee(event) {
  event.preventDefault()
  const name = byId('employee-name').value.trim()
  const rawId = byId('employee-id').value.trim()
  const skillMode = byId('employee-skill-mode').value || 'all'
  const skillNames = skillNamesFromInput()
  const invalidSkillNames = skillNames.filter((item) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item))
  if (skillMode === 'selected' && invalidSkillNames.length) return toast('Skill 名称必须为 kebab-case：' + invalidSkillNames.join('、'), 'error')

  const employee = {
    id: rawId || safeIdFrom(name, 'employee'),
    name,
    description: byId('employee-description').value.trim(),
    persona: byId('employee-persona').value.trim(),
    provider: byId('employee-provider').value,
    model: byId('employee-model').value.trim(),
    brain: { type: byId('employee-brain').value || 'dsh-acp' },
    skills: byId('employee-skills').value.split(/[，,]/).map((item) => item.trim()).filter(Boolean),
    skillAccess: { mode: skillMode, names: skillNames },
    source: 'dpa',
  }
  if (state.employeeDraftLineage) employee.lineage = state.employeeDraftLineage
  try {
    await request('saveAgent', employee)
    byId('employee-dialog').close()
    await refreshAgents()
    toast('员工配置已保存为新版本')
  } catch (error) { toast(error.message, 'error') }
}

async function openDevelopment(agent) {
  state.developmentAgent = agent
  byId('development-title').textContent = `继续培养 · ${agent.name || agent.id}`
  byId('development-meta').textContent = `当前 v${agent.version || 1} · 所有候选版本需考核并由你晋升`
  byId('development-goal').value = ''
  byId('development-sample').value = ''
  byId('training-result').classList.add('hidden')
  fillMentorSelect(byId('development-mentor'), agent.id)
  byId('development-dialog').showModal()
  await refreshDevelopment()
}

async function refreshDevelopment() {
  const agent = state.developmentAgent
  if (!agent) return
  try {
    const [runs, versions] = await Promise.all([
      request('listTrainingRuns', { id: agent.id }),
      request('listAgentVersions', { id: agent.id }),
    ])
    renderTrainingHistory(runs)
    renderVersionHistory(versions)
  } catch (error) { toast(error.message, 'error') }
}

function renderTrainingHistory(runs) {
  const box = byId('training-history')
  clear(box)
  if (!runs.length) return box.append(node('p', 'micro', '还没有培养记录。'))
  for (const run of runs) {
    const card = node('div', 'history-card')
    const score = run.evaluation ? Number(run.evaluation.score || 0) : 0
    card.append(node('div', 'card-title', `${run.goal || '培养记录'} · ${score}/10`))
    card.append(node('div', 'card-desc', `${run.status === 'promoted' ? `已晋升为 v${run.promotedVersion}` : (run.evaluation && run.evaluation.passed ? '考核通过，等待晋升' : '未通过考核')}`))
    const reasons = run.evaluation && run.evaluation.reasons || []
    if (reasons.length) card.append(node('div', 'micro', reasons.join('；')))
    const controls = node('div', 'history-actions')
    const detail = node('button', 'btn small ghost', '查看候选')
    detail.type = 'button'
    detail.addEventListener('click', () => openDetail('培养候选档案', JSON.stringify(run, null, 2)))
    controls.append(detail)
    if (run.status === 'candidate' && run.evaluation && run.evaluation.passed) {
      const promote = node('button', 'btn small success', '晋升此版本')
      promote.type = 'button'
      promote.addEventListener('click', () => promoteTraining(run.id))
      controls.append(promote)
    }
    card.append(controls)
    box.append(card)
  }
}

function renderVersionHistory(versions) {
  const box = byId('version-history')
  clear(box)
  const currentVersion = state.developmentAgent && state.developmentAgent.version
  for (const version of versions) {
    const card = node('div', 'history-card')
    card.append(node('div', 'card-title', `v${version.version} · ${version.name || version.id}`))
    card.append(node('div', 'card-desc', version.development && version.development.developmentSummary || version.description || '无版本说明'))
    if (Number(version.version) !== Number(currentVersion)) {
      const restore = node('button', 'btn small ghost', '回退到此版')
      restore.type = 'button'
      restore.addEventListener('click', () => restoreVersion(version.version))
      card.append(restore)
    } else card.append(node('span', 'source-tag', '当前版本'))
    box.append(card)
  }
}

async function runTraining() {
  const agent = state.developmentAgent
  const goal = byId('development-goal').value.trim()
  if (!agent || !goal) return toast('请填写本次培养目标', 'error')
  const button = byId('development-run')
  button.disabled = true
  button.textContent = '导师生成候选并考核中…'
  try {
    const run = await request('trainAgent', {
      employeeId: agent.id,
      mentorId: byId('development-mentor').value,
      goal,
      sample: byId('development-sample').value.trim(),
    }, 240000)
    const result = byId('training-result')
    result.classList.remove('hidden')
    result.textContent = `考核 ${run.evaluation.score}/10 · ${run.evaluation.passed ? '通过，可由你晋升' : '未通过，当前员工未被修改'}\n${(run.evaluation.reasons || []).join('\n')}`
    await refreshDevelopment()
  } catch (error) { toast(error.message, 'error') }
  finally {
    button.disabled = false
    button.textContent = '生成候选并考核'
  }
}

async function promoteTraining(runId) {
  const agent = state.developmentAgent
  if (!agent || !window.confirm('晋升后会形成员工新版本，旧版本仍可回退。继续吗？')) return
  try {
    const promoted = await request('promoteTrainingRun', { id: agent.id, runId })
    state.developmentAgent = promoted
    await refreshAgents()
    await refreshDevelopment()
    byId('development-meta').textContent = `当前 v${promoted.version} · 已晋升`
    toast(`已晋升为 v${promoted.version}`)
  } catch (error) { toast(error.message, 'error') }
}

async function restoreVersion(version) {
  const agent = state.developmentAgent
  if (!agent || !window.confirm(`回退到 v${version}？系统会把它保存成一个新的当前版本，不会删除后续历史。`)) return
  try {
    const restored = await request('restoreAgentVersion', { id: agent.id, version })
    state.developmentAgent = restored
    await refreshAgents()
    await refreshDevelopment()
    byId('development-meta').textContent = `当前 v${restored.version} · 来源 v${version}`
    toast(`已回退并生成 v${restored.version}`)
  } catch (error) { toast(error.message, 'error') }
}

const PROJECT_IMPORTANCE = {
  1: { label: '最低', color: '#3b82f6' },
  2: { label: '较低', color: '#06b6d4' },
  3: { label: '普通', color: '#d6a512' },
  4: { label: '重要', color: '#f97316' },
  5: { label: '最高', color: '#ef4444' },
}

function closeProjectContextMenu() {
  const menu = byId('project-context-menu')
  if (menu) menu.hidden = true
}

function contextMenuButton(label, handler, options = {}) {
  const button = node('button', options.danger ? 'danger' : '', label)
  button.type = 'button'
  button.setAttribute('role', options.radio ? 'menuitemradio' : 'menuitem')
  if (options.radio) button.setAttribute('aria-checked', String(Boolean(options.checked)))
  button.addEventListener('click', async () => {
    closeProjectContextMenu()
    try { await handler() } catch (error) { toast(error.message, 'error') }
  })
  return button
}

function openProjectContextMenu(project, x, y) {
  let menu = byId('project-context-menu')
  if (!menu) {
    menu = node('div', 'project-context-menu')
    menu.id = 'project-context-menu'
    menu.setAttribute('role', 'menu')
    menu.hidden = true
    document.body.append(menu)
  }
  clear(menu)
  menu.append(node('div', 'project-context-title', project.name || project.id))
  if (project.lifecycleState === 'trashed') {
    menu.append(contextMenuButton('恢复项目', async () => {
      await request('restoreProject', { projectId: project.id })
      await refreshProjectList()
      toast('项目已恢复')
    }))
    menu.append(contextMenuButton('永久删除…', () => permanentlyDeleteProject(project), { danger: true }))
  } else {
    menu.append(node('div', 'project-context-title', '设置重要性'))
    const current = Number(project.importanceLevel || 3)
    for (let level = 1; level <= 5; level += 1) {
      const info = PROJECT_IMPORTANCE[level]
      const button = contextMenuButton(`${level} 级 · ${info.label}`, async () => {
        const saved = await request('setProjectImportance', { projectId: project.id, level })
        if (state.current && state.current.id === project.id) state.current = { ...state.current, ...saved }
        await refreshProjectList()
        toast(`项目重要性已设为 ${level} 级`)
      }, { radio: true, checked: current === level })
      const dot = node('span', 'project-context-dot')
      dot.style.setProperty('--importance-color', info.color)
      button.prepend(dot)
      menu.append(button)
    }
    menu.append(node('div', 'menu-separator'))
    menu.append(contextMenuButton('移入回收站…', () => trashProjectById(project), { danger: true }))
  }
  menu.hidden = false
  const width = menu.offsetWidth || 214
  const height = menu.offsetHeight || 260
  menu.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, Number(x) || 8))}px`
  menu.style.top = `${Math.max(8, Math.min(window.innerHeight - height - 8, Number(y) || 8))}px`
  const first = menu.querySelector('button')
  if (first) first.focus()
}

function renderProjects() {
  const list = byId('project-list')
  clear(list)
  closeProjectContextMenu()
  const toggle = byId('project-trash-toggle')
  const emptyTrash = byId('project-trash-empty')
  const newProject = byId('new-project')
  if (toggle) toggle.textContent = state.showTrash ? '返回项目' : '回收站'
  if (emptyTrash) {
    emptyTrash.classList.toggle('hidden', !state.showTrash)
    emptyTrash.disabled = !state.projects.length
    emptyTrash.textContent = state.projects.length ? `清空（${state.projects.length}）` : '清空回收站'
  }
  if (newProject) newProject.classList.toggle('hidden', state.showTrash)
  if (!state.projects.length) {
    list.append(node('div', 'micro', state.showTrash ? '回收站为空' : '还没有项目'))
    return
  }
  for (const project of state.projects) {
    const trashed = project.lifecycleState === 'trashed'
    const level = Math.max(1, Math.min(5, Number(project.importanceLevel || 3)))
    const wrapper = node('div', 'project-item-wrap')
    wrapper.dataset.projectId = project.id
    const button = node('button', 'project-item' + (state.current && state.current.id === project.id ? ' active' : ''))
    button.type = 'button'
    button.disabled = trashed
    const title = node('div', 'project-item-title')
    title.append(node('div', 'project-item-name', project.name || project.id))
    const badge = node('span', `project-importance level-${level}`, String(level))
    badge.title = `重要性 ${level} 级 · ${PROJECT_IMPORTANCE[level].label}`
    badge.setAttribute('role', 'img')
    badge.setAttribute('aria-label', badge.title)
    title.append(badge)
    button.append(title)
    const meta = node('div', 'project-item-meta')
    meta.append(node('span', '', (MODE[project.mode] || MODE.hierarchy).name))
    const stateText = trashed ? '回收站' : (project.lifecycleState === 'archived' ? '已归档' : ({ rest: '休息', awaiting: '交付待审批', running: '运行中' }[project.displayStatus] || '休息'))
    meta.append(node('span', 'project-state ' + (project.displayStatus || 'rest'), stateText))
    button.append(meta)
    if (!trashed) button.addEventListener('click', () => openProject(project.id))
    button.addEventListener('contextmenu', (event) => { event.preventDefault(); openProjectContextMenu(project, event.clientX, event.clientY) })
    button.addEventListener('keydown', (event) => { if (event.shiftKey && event.key === 'F10') { event.preventDefault(); const rect = button.getBoundingClientRect(); openProjectContextMenu(project, rect.left + 24, rect.top + 24) } })
    wrapper.append(button)
    const menuTrigger = node('button', 'project-menu-trigger', '⋯')
    menuTrigger.type = 'button'
    menuTrigger.title = '项目操作'
    menuTrigger.setAttribute('aria-label', `${project.name || project.id} 的项目操作`)
    menuTrigger.addEventListener('click', (event) => { const rect = event.currentTarget.getBoundingClientRect(); openProjectContextMenu(project, rect.right - 214, rect.bottom + 4) })
    wrapper.append(menuTrigger)
    if (trashed) {
      const actions = node('div', 'project-trash-actions')
      const restore = node('button', 'btn small ghost project-restore', '恢复')
      restore.type = 'button'
      restore.addEventListener('click', async () => {
        try { await request('restoreProject', { projectId: project.id }); await refreshProjectList(); toast('项目已恢复') }
        catch (error) { toast(error.message, 'error') }
      })
      const remove = node('button', 'btn small danger', '永久删除')
      remove.type = 'button'
      remove.addEventListener('click', () => permanentlyDeleteProject(project).catch((error) => toast(error.message, 'error')))
      actions.append(restore, remove)
      wrapper.append(actions)
    }
    list.append(wrapper)
  }
}

function showProjectPane(name) {
  for (const id of ['project-empty', 'project-wizard', 'project-room']) {
    byId(id).classList.toggle('hidden', id !== name)
  }
}

async function refreshProjectList() {
  state.projects = state.showTrash ? await request('listTrashedProjects') : await request('listProjects')
  renderProjects()
}

function toggleProjectTrash() {
  state.showTrash = !state.showTrash
  state.current = null
  state.overview = null
  refreshProjectList().then(() => showProjectPane('project-empty')).catch((error) => toast(error.message, 'error'))
}

function wait(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)) }

async function stopProjectBeforeTrash(projectId) {
  const runState = await request('getRunState', { projectId })
  if (!runState || !runState.running) return
  await request('cancelProject', { projectId })
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await wait(500)
    const next = await request('getRunState', { projectId }, 5000)
    if (!next.running) return
  }
  throw new Error('项目仍在停止中，暂未移入回收站；请稍后重试')
}

async function trashProjectById(project) {
  if (!project) return
  closeProjectContextMenu()
  const runState = await request('getRunState', { projectId: project.id })
  const message = runState && runState.running
    ? `项目「${project.name || project.id}」正在运行。继续会先停止员工和工具调用，保存现有轨迹，再移入回收站。是否继续？`
    : `把项目「${project.name || project.id}」移入回收站？聊天、任务、交付物和审批记录会保留，可恢复。`
  if (!window.confirm(message)) return
  if (runState && runState.running) await stopProjectBeforeTrash(project.id)
  await request('trashProject', { projectId: project.id })
  const editDialog = byId('project-edit-dialog')
  if (editDialog && editDialog.open) editDialog.close()
  if (state.current && state.current.id === project.id) {
    state.current = null
    state.overview = null
    showProjectPane('project-empty')
  }
  await refreshProjectList()
  toast('项目已移入回收站')
}

async function permanentlyDeleteProject(project) {
  if (!project) return
  closeProjectContextMenu()
  if (!window.confirm(`永久删除回收站中的项目「${project.name || project.id}」？\n\nDPA 内的聊天、任务、轨迹、交付和审批记录将无法恢复；电脑上的项目工作目录不会被删除。`)) return
  const result = await request('deleteProjectForever', { projectId: project.id })
  await refreshProjectList()
  toast(result.workspace ? '项目记录已永久删除；工作目录已保留' : '项目记录已永久删除')
}

async function emptyProjectTrash() {
  const count = state.showTrash ? state.projects.length : 0
  if (!count) return
  if (!window.confirm(`永久删除回收站中的 ${count} 个项目？\n\n这会删除 DPA 内的聊天、任务、轨迹、交付和审批记录，但不会删除电脑上的项目工作目录。此操作无法撤销。`)) return
  const result = await request('emptyProjectTrash', {}, 120000)
  await refreshProjectList()
  if (result.failedCount) toast(`已永久删除 ${result.deletedCount} 个项目，${result.failedCount} 个失败`, 'error')
  else toast(`已永久删除 ${result.deletedCount} 个项目；工作目录均已保留`)
}

function openProjectEditor() {
  if (!state.current) return
  state.editingProject = state.current
  byId('project-edit-name').value = state.current.name || ''
  byId('project-edit-goal').value = state.current.goal || ''
  byId('project-edit-mode').value = state.current.mode || 'hierarchy'
  byId('project-edit-workspace').value = state.current.workspace || ''
  const running = Boolean(state.runState && state.runState.running)
  byId('project-edit-mode').disabled = running
  byId('project-edit-workspace').disabled = running
  byId('project-edit-hint').textContent = running
    ? '项目正在运行：名称和目标可以立即修改；治理策略与工作区将在停止后修改。'
    : '项目配置修改会写入项目历史，聊天、任务和审批记录不会被覆盖。'
  byId('project-edit-dialog').showModal()
}

async function saveProjectEdit(event) {
  event.preventDefault()
  if (!state.current) return
  try {
    await request('editProject', {
      projectId: state.current.id,
      name: byId('project-edit-name').value.trim(),
      goal: byId('project-edit-goal').value.trim(),
      mode: byId('project-edit-mode').value,
      workspace: byId('project-edit-workspace').value.trim(),
    })
    byId('project-edit-dialog').close()
    await refreshCurrent(true)
    await refreshProjectList()
    toast('项目配置已保存')
  } catch (error) { toast(error.message, 'error') }
}

async function archiveCurrentProject() {
  if (!state.current) return
  const archived = state.current.lifecycleState !== 'archived'
  if (!window.confirm(archived ? '归档这个项目？历史记录会保留，并可恢复。' : '恢复这个项目？')) return
  try {
    const projectId = state.current.id
    await request('archiveProject', { projectId, archived })
    byId('project-edit-dialog').close()
    await refreshProjectList()
    if (archived) { state.current = null; state.overview = null; showProjectPane('project-empty') }
    else await openProject(projectId)
    toast(archived ? '项目已归档' : '项目已恢复')
  } catch (error) { toast(error.message, 'error') }
}

async function trashCurrentProject() {
  if (!state.current) return
  try { await trashProjectById(state.current) }
  catch (error) { toast(error.message, 'error') }
}
function openWizard() {
  state.current = null
  state.overview = null
  byId('project-form').reset()
  renderProjects()
  renderWizardMembers()
  showProjectPane('project-wizard')
}

function renderWizardMembers() {
  const picker = byId('wizard-member-list')
  if (!picker) return
  clear(picker)
  for (const [index, agent] of state.agents.filter((item) => !item.archived).entries()) {
    const row = node('div', 'member-choice disabled-fields')
    const checkbox = node('input')
    checkbox.type = 'checkbox'
    checkbox.dataset.agentId = agent.id
    checkbox.checked = index < Math.min(3, state.agents.length)
    const name = node('div')
    name.append(node('div', 'card-title', agent.name || agent.id))
    name.append(node('div', 'micro', agent.description || agent.desc || agent.id))
    const role = node('input')
    role.placeholder = '项目职务'
    role.value = index === 0 ? '项目负责人' : (agent.name || `员工 ${index + 1}`)
    role.dataset.field = 'role'
    const rank = node('input')
    rank.type = 'number'
    rank.min = '1'
    rank.max = '99'
    rank.value = String(index + 1)
    rank.title = '身份等级（1 最高）'
    rank.dataset.field = 'rank'
    const permission = node('select')
    permission.dataset.field = 'permission'
    permission.title = '电脑调用权限'
    for (const [value, label] of [['ask', '请求逐项批准'], ['auto', '风险托管'], ['full', '项目内完全访问']]) {
      const option = node('option', '', label)
      option.value = value
      permission.append(option)
    }
    const brain = node('select')
    brain.dataset.field = 'brain'
    brain.title = '执行大脑'
    for (const [value, label] of [['dsh-acp', 'Harness 工具智能体（DeepSeek）'], ['codex', 'Codex 子代理（需本机登录）'], ['claude-code', 'Claude Code 子代理（需本机登录）'], ['api', '仅模型对话']]) {
      const option = node('option', '', label)
      option.value = value
      brain.append(option)
    }
    brain.value = agent.brain && agent.brain.type === 'api' ? 'api' : 'dsh-acp'
    row.append(checkbox, name, role, rank, permission, brain)
    const sync = () => row.classList.toggle('disabled-fields', !checkbox.checked)
    checkbox.addEventListener('change', sync)
    sync()
    picker.append(row)
  }
}

async function createProject(event) {
  event.preventDefault()
  const name = byId('project-name').value.trim()
  const members = [...byId('wizard-member-list').querySelectorAll('.member-choice')]
    .filter((row) => row.querySelector('input[type=checkbox]').checked)
    .map((row) => {
      const agentId = row.querySelector('input[type=checkbox]').dataset.agentId
      const agent = state.agents.find((item) => item.id === agentId) || {}
      return {
        agent: agentId,
        name: agent.name || agentId,
        role: row.querySelector('[data-field=role]').value.trim() || agent.name || '项目成员',
        rank: Number(row.querySelector('[data-field=rank]').value || 9),
        duty: agent.description || agent.desc || '',
        provider: agent.provider || 'deepseek',
        model: agent.model || '',
        permission: row.querySelector('[data-field=permission]').value || 'ask',
        brainType: row.querySelector('[data-field=brain]').value || (agent.brain && agent.brain.type) || 'dsh-acp',
      }
    })
  if (!members.length) return toast('至少选择一名员工', 'error')
  const project = {
    id: `${safeIdFrom(name, 'project')}-${Date.now().toString(36).slice(-5)}`,
    name,
    goal: byId('project-goal').value.trim(),
    mode: new FormData(event.currentTarget).get('mode') || 'hierarchy',
    workspace: byId('project-workspace').value.trim(),
    status: 'draft',
    phase: 'draft',
    members,
  }
  try {
    const saved = await request('saveProject', project)
    state.projects = await request('listProjects')
    renderProjects()
    await openProject(saved.id)
    toast('项目空间已建立，请先在聊天框介绍任务')
    byId('composer-input').focus()
  } catch (error) { toast(error.message, 'error') }
}

async function openProject(projectId) {
  try {
    const selected = state.projects.find((project) => project.id === projectId)
    if (selected && selected.lifecycleState === 'trashed') return toast('回收站项目请先恢复后再打开', 'error')
    const [overview, events, runState, skillCatalog] = await Promise.all([
      request('getProjectOverview', { projectId }),
      request('listEvents', { projectId, limit: 1200 }),
      request('getRunState', { projectId }),
      request('listSkills', { projectId }).catch(() => state.skillCatalog),
    ])
    state.current = overview.project
    state.overview = overview
    state.events = events
    state.runState = runState
    state.skillCatalog = skillCatalog || state.skillCatalog
    state.streams.clear()
    renderProjects()
    renderRoom()
    showProjectPane('project-room')
  } catch (error) { toast(error.message, 'error') }
}

function renderRoom() {
  if (!state.current || !state.overview) return
  byId('room-name').textContent = state.current.name
  byId('room-mode').textContent = `${(MODE[state.current.mode] || MODE.hierarchy).name} · ${PHASE[state.current.phase] || state.current.phase}`
  const pill = byId('room-status')
  pill.textContent = ({ rest: '休息', awaiting: '交付待审批', running: '运行中' }[state.current.displayStatus] || '休息')
  pill.className = `status-pill ${state.current.displayStatus || 'rest'}`
  renderRoster()
  renderFeed()
  renderApproval()
  renderInspector()
  renderRunActions()
}

function renderRoster() {
  const roster = byId('roster-list')
  clear(roster)
  for (const member of state.current.members || []) {
    const agent = state.agents.find((item) => item.id === (member.agent || member.id)) || member
    const status = memberStatus(member)
    const row = node('div', 'roster-item')
    row.append(node('div', 'avatar', initials(agent.name || member.role)))
    const info = node('div')
    info.append(node('div', 'roster-name', agent.name || member.name || member.agent))
    info.append(node('div', 'roster-role', `${member.role || '项目成员'} · L${member.rank || '-'}`))
    const brainLabel = ({ api: '仅对话', codex: 'Codex 子代理', 'claude-code': 'Claude Code 子代理', 'dsh-acp': 'Harness 工具执行' }[(member.brain && member.brain.type) || 'dsh-acp'] || 'Harness 工具执行')
    const permissionLabel = { ask: '逐项批准', auto: '风险托管', full: '项目内完全访问' }[member.permission] || '逐项批准'
    info.append(node('div', 'roster-tags', `${brainLabel} · ${permissionLabel}`))
    row.append(info)
    const badge = node('div', `member-state ${status}`)
    badge.append(node('span', 'member-state-dot'))
    badge.append(node('span', 'member-state-label', MEMBER_STATE[status] || status))
    row.append(badge)
    const remove = node('button', 'btn roster-remove', '－')
    remove.type = 'button'
    remove.title = '移出项目（运行中将在下一阶段生效）'
    remove.addEventListener('click', () => removeMember(member.agent || member.id))
    row.append(remove)
    roster.append(row)
  }
}

function availableAgents() {
  const memberIds = new Set((state.current.members || []).map((member) => member.agent || member.id))
  return state.agents.filter((agent) => !agent.archived && !memberIds.has(agent.id))
}

function openMemberDialog() {
  if (!state.current) return
  const select = byId('member-agent')
  clear(select)
  const available = availableAgents()
  if (!available.length) {
    const option = node('option', '', '（员工中心里没有可加入的员工）')
    option.value = ''
    select.append(option)
  }
  for (const agent of available) {
    const option = node('option', '', `${agent.name || agent.id} · ${agent.id}`)
    option.value = agent.id
    select.append(option)
  }
  byId('member-role').value = ''
  byId('member-rank').value = '9'
  byId('member-dialog').showModal()
}

async function addMember() {
  if (!state.current) return
  const agentId = byId('member-agent').value
  const agent = state.agents.find((item) => item.id === agentId)
  if (!agent) return toast('请选择要加入的员工', 'error')
  const member = {
    agent: agentId,
    name: agent.name || agentId,
    role: byId('member-role').value.trim() || agent.name || '项目成员',
    rank: Number(byId('member-rank').value || 9),
    duty: agent.description || agent.desc || '',
    provider: agent.provider || 'deepseek',
    model: agent.model || '',
    permission: byId('member-permission').value || 'ask',
    brain: { type: byId('member-brain').value || 'dsh-acp' },
  }
  try {
    await request('addProjectMember', { projectId: state.current.id, member })
    byId('member-dialog').close()
    await refreshCurrent(true)
    toast(`已把「${agent.name || agentId}」加入项目（运行中将在下一阶段参加会议/执行）`)
  } catch (error) { toast(error.message, 'error') }
}

async function removeMember(memberId) {
  if (!state.current) return
  const member = (state.current.members || []).find((item) => (item.agent || item.id) === memberId)
  const name = member ? (member.name || member.role || memberId) : memberId
  if (!window.confirm(`把「${name}」移出项目？其未开始的任务会被取消；运行中将在下一阶段生效。`)) return
  try {
    await request('removeProjectMember', { projectId: state.current.id, memberId })
    await refreshCurrent(true)
    toast(`「${name}」已移出项目`)
  } catch (error) { toast(error.message, 'error') }
}

function canonicalType(event) {
  return event.eventType || event.type || ''
}

function eventChannel(event) {
  const type = canonicalType(event)
  const meta = event && event.meta && typeof event.meta === 'object' ? event.meta : {}
  if (event && event.channel) return String(event.channel)
  if (meta.channel) return String(meta.channel)
  if (type === 'user.message') return 'room'
  if (type === 'agent.message.completed' && (meta.purpose === 'discussion' || event.phase === 'discussion')) return 'room'
  if (type === 'agent.activity' || type === 'phase.changed') return 'activity'
  if (type.startsWith('approval.') || type.startsWith('decision.') || type.startsWith('artifact.') || type.startsWith('task.') || type.startsWith('action.') || type.startsWith('tool.') || type.startsWith('run.')) return 'worklog'
  return 'system'
}

function isPublicMessage(event) {
  const type = canonicalType(event)
  return type === 'user.message' || (type === 'agent.message.completed' && eventChannel(event) === 'room')
}

function visibleEvent(event) {
  return isPublicMessage(event)
}

function messageNode(event) {
  const actor = event.actor || {}
  const isUser = actor.kind === 'user' || actor.id === 'user'
  const wrapper = node('article', `message${isUser ? ' user' : ''}`)
  if (!isUser) wrapper.append(node('div', 'avatar', initials(actor.name || actor.id)))
  const body = node('div', 'message-body')
  if (!isUser) {
    const head = node('div', 'message-head')
    head.append(node('span', 'message-name', actor.name || actor.id || '员工'))
    if (actor.role) head.append(node('span', 'message-role', actor.role))
    head.append(node('span', 'message-time', formatTime(event.timestamp)))
    body.append(head)
  }
  body.append(node('div', 'message-text', event.text || ''))
  wrapper.append(body)
  return wrapper
}

function timelineNode(event) {
  const type = canonicalType(event)
  const kind = type.includes('approval') ? ' approval' : (type.includes('artifact') ? ' artifact' : ((type.startsWith('tool.') || type.startsWith('action.')) ? ' tool' : ''))
  const row = node('div', `timeline-event${kind}`)
  row.append(node('span', 'timeline-dot'))
  const label = type === 'phase.changed' ? `阶段进入：${PHASE[event.text] || event.text}` : event.text
  row.append(node('span', '', label || type))
  row.append(node('span', 'message-time', formatTime(event.timestamp)))
  return row
}

function renderFeed() {
  const feed = byId('feed')
  clear(feed)
  const events = state.events.filter(visibleEvent)
  if (!events.length && !state.streams.size) {
    const empty = node('div', 'feed-empty')
    empty.append(node('div', '', '项目空间已经准备好'))
    empty.append(node('div', 'micro', '请先在下方介绍任务，员工将在启动后参加会议。'))
    feed.append(empty)
    return
  }
  for (const event of events) feed.append(messageNode(event))
  for (const stream of state.streams.values()) feed.append(messageNode(stream))
  requestAnimationFrame(() => { feed.scrollTop = feed.scrollHeight })
}

function pendingApproval() {
  const approvals = state.overview && state.overview.approvals || []
  return [...approvals].reverse().find((approval) => approval.status === 'pending') || null
}

function briefList(items, emptyText) {
  const list = node('ul', 'brief-list')
  const values = Array.isArray(items) ? items.map(String).filter(Boolean) : []
  if (!values.length) {
    list.append(node('li', 'brief-empty', emptyText || '无'))
    return list
  }
  for (const item of values) list.append(node('li', '', item))
  return list
}

function renderApproval() {
  const dock = byId('approval-dock')
  const approval = pendingApproval()
  dock.classList.toggle('hidden', !approval)
  if (!approval) return
  byId('approval-subject').textContent = approval.subject || '等待你的审批'
  const kindLabel = { plan: '计划闸门', acceptance: '成果验收', 'task-exec': '电脑执行授权', 'tool-permission': '工具权限请求' }
  byId('approval-kind').textContent = kindLabel[approval.kind] || '项目审批'
  const legacy = approval.brief || {}
  const packet = approval.packet || {
    decision: legacy.decision,
    workCompleted: legacy.outputs,
    discussionResults: legacy.conclusions,
    approvalItems: [legacy.decision || approval.subject],
    toolActions: [],
    risks: legacy.risks,
    next: legacy.next,
  }
  const box = byId('approval-brief')
  clear(box)
  const decision = node('div', 'brief-decision')
  decision.append(node('span', 'brief-tag', '待你决策'))
  decision.append(node('div', 'brief-decision-text', packet.decision || approval.subject || '请决定是否批准'))
  box.append(decision)
  for (const [key, label, empty] of [
    ['approvalItems', '需要你审批', '仅需批准或退回本审批事项'],
    ['workCompleted', '已经完成的工作', '本节点尚无已完成工作'],
    ['discussionResults', '讨论结果', '本节点尚无形成共识的讨论结果'],
    ['toolActions', '实际电脑操作', '尚未发生电脑操作'],
    ['risks', '风险与依赖', '未记录额外风险'],
  ]) {
    const section = node('section', `brief-section ${key}`)
    section.append(node('h4', '', label))
    section.append(briefList(packet[key], empty))
    box.append(section)
  }
  const next = node('section', 'brief-section')
  next.append(node('h4', '', '你的决定会触发'))
  next.append(node('p', 'brief-next', packet.next || '批准后继续推进；退回后按意见修订。'))
  box.append(next)
  byId('approval-context').textContent = approval.contextText || ''
  byId('approval-context-details').open = false
  byId('approval-feedback').value = ''
  dock.dataset.approvalId = approval.id
}
function renderRunActions() {
  const running = Boolean(state.runState && state.runState.running)
  const paused = Boolean(state.runState && state.runState.paused)
  byId('run-start').classList.toggle('hidden', running)
  byId('run-pause').classList.toggle('hidden', !running || paused)
  byId('run-resume').classList.toggle('hidden', !running || !paused)
  byId('run-cancel').classList.toggle('hidden', !running)
  byId('run-start').disabled = state.current.status === 'accepted'
}

function renderInspector() {
  for (const button of document.querySelectorAll('.inspector-tab')) {
    button.classList.toggle('active', button.dataset.panel === state.inspector)
  }
  const body = byId('inspector-body')
  clear(body)
  if (state.inspector === 'tasks') renderTasks(body)
  else if (state.inspector === 'artifacts') renderArtifacts(body)
  else if (state.inspector === 'decisions') renderDecisions(body)
  else if (state.inspector === 'actions') renderActions(body)
  else renderMetrics(body)
}

function emptyInspector(body, text) { body.append(node('div', 'inspector-empty', text)) }

function renderTasks(body) {
  const tasks = state.overview.tasks || []
  if (!tasks.length) return emptyInspector(body, '计划获批后会在这里生成任务。')
  for (const task of tasks) {
    const card = node('div', 'task-card')
    const line = node('div', 'card-line')
    line.append(node('div', 'card-title', task.title))
    line.append(node('span', `status-pill ${task.status}`, statusLabel(task.status)))
    card.append(line)
    card.append(node('div', 'card-desc', `${task.assigneeRole || task.assigneeId || '待分配'} · ${task.description || ''}`))
    const progress = node('div', 'progress')
    const bar = node('span')
    bar.style.width = task.status === 'done' ? '100%' : (task.status === 'doing' ? '55%' : '8%')
    progress.append(bar)
    card.append(progress)
    body.append(card)
  }
}

function openDetail(title, content) {
  byId('detail-title').textContent = title
  byId('detail-content').textContent = content || '（无内容）'
  byId('detail-dialog').showModal()
}

function renderArtifacts(body) {
  const artifacts = state.overview.artifacts || []
  if (!artifacts.length) return emptyInspector(body, '员工完成工作后，交付物会按版本保存在这里。')
  for (const artifact of [...artifacts].reverse()) {
    const card = node('button', 'artifact-card')
    card.type = 'button'
    card.style.width = '100%'
    card.style.color = 'inherit'
    card.style.textAlign = 'left'
    const line = node('div', 'card-line')
    line.append(node('div', 'card-title', artifact.title))
    line.append(node('span', `status-pill ${artifact.status}`, statusLabel(artifact.status)))
    card.append(line)
    card.append(node('div', 'card-desc', String(artifact.content || '').slice(0, 90)))
    card.addEventListener('click', () => openDetail(artifact.title, artifact.content))
    body.append(card)
  }
}

function renderDecisions(body) {
  const decisions = state.overview.decisions || []
  if (!decisions.length) return emptyInspector(body, '经用户批准的计划与关键决策会在这里留档。')
  for (const decision of decisions) {
    const card = node('button', 'decision-card')
    card.type = 'button'
    card.style.width = '100%'
    card.style.color = 'inherit'
    card.style.textAlign = 'left'
    card.append(node('div', 'card-title', decision.title || decision.kind))
    card.append(node('div', 'card-desc', `v${decision.version || 1} · ${statusLabel(decision.status)}`))
    card.addEventListener('click', () => openDetail(decision.title || '项目决策', decision.content))
    body.append(card)
  }
}

function renderActions(body) {
  const actions = state.overview.actions || []
  if (!actions.length) return emptyInspector(body, '员工实际调用电脑后，工具、权限、结果和会话编号会在这里留档。')
  for (const action of [...actions].reverse()) {
    const card = node('button', 'action-card')
    card.type = 'button'
    card.style.width = '100%'
    card.style.color = 'inherit'
    card.style.textAlign = 'left'
    const line = node('div', 'card-line')
    line.append(node('div', 'card-title', action.title || action.tool || action.id))
    line.append(node('span', `status-pill ${action.status || ''}`, statusLabel(action.status)))
    card.append(line)
    const permission = { ask: '逐项批准', auto: '风险托管', full: '项目内完全访问' }[action.permission] || ''
    card.append(node('div', 'card-desc', [action.actorName, action.tool, permission, action.toolCalls != null ? `${action.toolCalls} 次工具调用` : ''].filter(Boolean).join(' · ')))
    if (action.summary) card.append(node('div', 'micro action-summary', String(action.summary).slice(0, 140)))
    card.addEventListener('click', () => openDetail('电脑操作记录', JSON.stringify(action, null, 2)))
    body.append(card)
  }
}


function renderMetrics(body) {
  const totals = { input: 0, output: 0, cache: 0, cacheWrite: 0, total: 0 }
  for (const event of state.events) {
    if (canonicalType(event) !== 'telemetry.usage' || !event.metrics) continue
    totals.input += Number(event.metrics.inputTokens || 0)
    totals.output += Number(event.metrics.outputTokens || 0)
    totals.cache += Number(event.metrics.cacheReadTokens || 0)
    totals.cacheWrite += Number(event.metrics.cacheWriteTokens || 0)
    totals.total += Number(event.metrics.totalTokens || 0)
  }
  const cacheDenominator = totals.input + totals.cache + totals.cacheWrite
  const hit = cacheDenominator > 0 ? Math.round(totals.cache / cacheDenominator * 1000) / 10 : 0
  const grid = node('div', 'metric-grid')
  for (const [value, label] of [[totals.total, '总 tokens'], [totals.input, '未缓存输入'], [totals.output, '输出'], [`${hit}%`, '缓存命中']]) {
    const metric = node('div', 'metric')
    metric.append(node('div', 'metric-value', value))
    metric.append(node('div', 'metric-label', label))
    grid.append(metric)
  }
  body.append(grid)
  body.append(node('p', 'card-desc', '指标来自模型 API 的公开 usage 数据；DPA 不展示或保存隐藏思维过程。'))
}

async function sendMessage(event) {
  event.preventDefault()
  if (!state.current) return
  const input = byId('composer-input')
  const text = input.value.trim()
  if (!text) return
  input.value = ''
  try {
    await request('sendMessage', { projectId: state.current.id, text, target: 'project' })
  } catch (error) {
    input.value = text
    toast(error.message, 'error')
  }
}

async function startProject() {
  if (!state.current) return
  if (!state.events.some((event) => canonicalType(event) === 'user.message')) {
    byId('composer-input').focus()
    return toast('请先在聊天框介绍这次要做的具体任务，再开始项目', 'error')
  }
  try {
    const result = await request('startProject', { project: state.current })
    state.runState = { running: true, runId: result.runId, paused: false }
    renderRunActions()
    toast(result.started ? '项目已启动，员工正在准备会议' : '项目已在运行')
  } catch (error) { toast(error.message, 'error') }
}

async function runControl(method) {
  if (!state.current) return
  if (method === 'cancelProject' && !window.confirm('确定取消当前运行？已保存的聊天、任务和交付记录会保留。')) return
  try {
    const result = await request(method, { projectId: state.current.id })
    if (!result.ok) toast('项目当前没有运行')
    await refreshCurrent(true)
  } catch (error) { toast(error.message, 'error') }
}

async function respondApproval(status) {
  if (!state.current) return
  const approvalId = byId('approval-dock').dataset.approvalId
  const feedback = byId('approval-feedback').value.trim()
  if (status === 'rejected' && !feedback) return toast('退回时请写明修改意见', 'error')
  try {
    await request('respondApproval', { projectId: state.current.id, approvalId, status, feedback })
    toast(status === 'approved' ? '已批准，项目继续推进' : '已退回，员工将按意见返工')
    setTimeout(() => refreshCurrent(true), 250)
  } catch (error) { toast(error.message, 'error') }
}

function mergeEvent(event) {
  if (!event || typeof event !== 'object') return
  const normalized = { ...event, type: canonicalType(event) }
  if (normalized.seq && state.events.some((item) => item.seq === normalized.seq)) return
  state.events.push(normalized)
  state.events.sort((a, b) => Number(a.seq || 1e12) - Number(b.seq || 1e12))
  if (state.events.length > MAX_RENDERED_EVENTS) state.events.splice(0, state.events.length - MAX_RENDERED_EVENTS)
}

function handleClusterEvent(event) {
  if (!state.current || !event || event.projectId !== state.current.id) return
  const type = canonicalType(event)
  const messageId = event.messageId || (event.meta && event.meta.messageId)
  if (type === 'agent.message.started' && messageId) {
    const completed = { ...event, eventType: 'agent.message.completed', type: 'agent.message.completed', text: '' }
    if (isPublicMessage(completed)) {
      state.streams.set(messageId, completed)
      while (state.streams.size > MAX_RENDERED_STREAMS) state.streams.delete(state.streams.keys().next().value)
      renderFeed()
    }
    return
  }
  if (type === 'agent.message.delta' && messageId) {
    const stream = state.streams.get(messageId)
    if (!stream) return
    stream.text += event.text || ''
    renderFeed()
    return
  }
  if (type === 'agent.message.completed' && messageId) state.streams.delete(messageId)
  if (event.seq) mergeEvent(event)
  renderFeed()
  if (/^(task|approval|artifact|decision|phase|run|action|tool)\./.test(type)) setTimeout(() => refreshCurrent(false), 80)
}

async function refreshCurrent(renderAll = false) {
  if (!state.current || state.refreshBusy) return
  state.refreshBusy = true
  const projectId = state.current.id
  try {
    const after = state.events.reduce((max, event) => Math.max(max, Number(event.seq || 0)), 0)
    const [overview, events, runState] = await Promise.all([
      request('getProjectOverview', { projectId }),
      request('listEvents', { projectId, after, limit: 500 }),
      request('getRunState', { projectId }),
    ])
    if (!state.current || state.current.id !== projectId) return
    state.current = overview.project
    state.overview = overview
    state.runState = runState
    for (const event of events) mergeEvent(event)
    if (renderAll) renderRoom()
    else {
      byId('room-mode').textContent = `${(MODE[state.current.mode] || MODE.hierarchy).name} · ${PHASE[state.current.phase] || state.current.phase}`
      const pill = byId('room-status')
      pill.textContent = ({ rest: '休息', awaiting: '交付待审批', running: '运行中' }[state.current.displayStatus] || '休息')
      pill.className = `status-pill ${state.current.displayStatus || 'rest'}`
      renderApproval()
      renderInspector()
      renderRunActions()
    }
    state.projects = state.projects.map((project) => project.id === state.current.id ? state.current : project)
    renderProjects()
  } catch (_) {
    // 轮询失败不打断当前页面，下一轮继续恢复。
  } finally { state.refreshBusy = false }
}

function applyClusterTheme(theme) {
  if (!theme) return
  const tokens = theme.tokens || {}
  const root = document.documentElement
  root.dataset.dpaTheme = theme.id || 'midnight'
  root.style.colorScheme = theme.colorScheme || 'dark'
  const mapping = { background:'--bg', panel:'--panel', panel2:'--panel-2', text:'--text', muted:'--muted', accent:'--blue', accentStrong:'--blue-strong', line:'--line', success:'--green', warning:'--amber', danger:'--red', hover:'--hover', active:'--panel-3', shadow:'--shadow' }
  for (const [key, variable] of Object.entries(mapping)) if (tokens[key]) root.style.setProperty(variable, tokens[key])
  if (tokens.line) root.style.setProperty('--line-strong', tokens.line)
  if (tokens.muted) root.style.setProperty('--faint', tokens.muted)
  if (tokens.accent) root.style.setProperty('--purple', tokens.accent)
}

function applyClusterTypography(typography = {}) {
  const root = document.documentElement
  root.style.setProperty('--ui-font-family', typography.fontFamily || '"Segoe UI Variable Text","Microsoft YaHei UI","Segoe UI",sans-serif')
  root.style.setProperty('--mono-font-family', typography.monoFontFamily || '"Cascadia Mono",Consolas,monospace')
  root.style.setProperty('--ui-font-size', String(typography.fontSize || 14) + 'px')
  root.style.setProperty('--ui-line-height', String(typography.lineHeight || 1.5))
  root.style.setProperty('--chat-font-family', typography.chatFontFamily || typography.fontFamily || 'system-ui')
  root.style.setProperty('--chat-font-size', String(typography.chatFontSize || 15) + 'px')
}

function applyClusterBackground(background = {}) {
  const root = document.documentElement
  const enabled = Boolean(background.enabled && background.dataUrl)
  root.dataset.dpaWallpaper = enabled ? 'true' : 'false'
  root.style.setProperty('--wallpaper-image', enabled ? `url("${background.dataUrl}")` : 'none')
  root.style.setProperty('--wallpaper-size', background.fit === 'repeat' ? 'auto' : (background.fit || 'cover'))
  root.style.setProperty('--wallpaper-repeat', background.fit === 'repeat' ? 'repeat' : 'no-repeat')
  root.style.setProperty('--wallpaper-position', background.position || 'center')
  root.style.setProperty('--wallpaper-opacity', String(background.opacity == null ? .28 : background.opacity))
  root.style.setProperty('--wallpaper-blur', String(background.blur || 0) + 'px')
  root.style.setProperty('--wallpaper-overlay', String(background.overlay == null ? .42 : background.overlay))
}

function applyClusterAppearance(appearance) {
  if (!appearance) return
  state.appearance = appearance
  applyClusterTheme(appearance.theme)
  applyClusterTypography(appearance.typography)
  applyClusterBackground(appearance.background)
}

function handleWindowMessage(event) {
  if (event.source !== window.parent) return
  const data = event.data || {}
  if (data.type === 'capability:appearance' && data.appearance) { applyClusterAppearance(data.appearance); return }
  if (data.type === 'capability:theme' && data.theme) { applyClusterTheme(data.theme); return }
  if (data.type === 'cluster:response') {
    const pending = state.pending.get(data.id)
    if (!pending) return
    clearTimeout(pending.timer)
    state.pending.delete(data.id)
    if (data.error) pending.reject(new Error(data.error))
    else pending.resolve(data.result)
  } else if (data.type === 'cluster:event') handleClusterEvent(data.payload)
}

function attachEvents() {
  window.addEventListener('message', handleWindowMessage)
  window.addEventListener('wheel', (event) => {
    const typography = state.appearance && state.appearance.typography
    if (!event.ctrlKey || !typography || typography.ctrlWheel === 'off') return
    event.preventDefault()
    window.parent.postMessage({ type:'capability:zoom-step', direction:event.deltaY < 0 ? 1 : -1 }, '*')
  }, { passive:false })
  window.parent.postMessage({ type:'capability:appearance-request' }, '*')
  byId('nav-employees').addEventListener('click', () => setView('employees'))
  byId('nav-projects').addEventListener('click', () => setView('projects'))
  byId('new-employee').addEventListener('click', () => openEmployeeDialog())
  byId('show-archived').addEventListener('change', async () => {
    state.showArchived = byId('show-archived').checked
    await refreshAgents()
  })
  byId('employee-form').addEventListener('submit', saveEmployee)
  byId('employee-close').addEventListener('click', () => byId('employee-dialog').close())
  byId('employee-cancel').addEventListener('click', () => byId('employee-dialog').close())
  byId('employee-ai-draft').addEventListener('click', draftEmployee)
  byId('employee-skill-mode').addEventListener('change', renderSkillCatalog)
  byId('employee-skill-names').addEventListener('input', renderSkillCatalog)
  byId('development-run').addEventListener('click', runTraining)
  byId('development-close').addEventListener('click', () => byId('development-dialog').close())
  byId('new-project').addEventListener('click', openWizard)
  byId('project-trash-toggle').addEventListener('click', toggleProjectTrash)
  byId('project-trash-empty').addEventListener('click', () => emptyProjectTrash().catch((error) => toast(error.message, 'error')))
  document.addEventListener('pointerdown', (event) => { const menu = byId('project-context-menu'); if (menu && !menu.hidden && !menu.contains(event.target)) closeProjectContextMenu() })
  window.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeProjectContextMenu() })
  window.addEventListener('blur', closeProjectContextMenu)
  byId('project-edit').addEventListener('click', openProjectEditor)
  byId('project-edit-form').addEventListener('submit', saveProjectEdit)
  byId('project-edit-cancel').addEventListener('click', () => byId('project-edit-dialog').close())
  byId('project-archive').addEventListener('click', archiveCurrentProject)
  byId('project-trash').addEventListener('click', trashCurrentProject)
  byId('project-edit-close').addEventListener('click', () => byId('project-edit-dialog').close())
  byId('empty-new-project').addEventListener('click', openWizard)
  byId('wizard-cancel').addEventListener('click', () => showProjectPane('project-empty'))
  byId('project-form').addEventListener('submit', createProject)
  byId('composer').addEventListener('submit', sendMessage)
  byId('composer-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      byId('composer').requestSubmit()
    }
  })
  byId('run-start').addEventListener('click', startProject)
  byId('run-pause').addEventListener('click', () => runControl('pauseProject'))
  byId('run-resume').addEventListener('click', () => runControl('resumeProject'))
  byId('run-cancel').addEventListener('click', () => runControl('cancelProject'))
  byId('approval-approve').addEventListener('click', () => respondApproval('approved'))
  byId('approval-reject').addEventListener('click', () => respondApproval('rejected'))
  byId('detail-close').addEventListener('click', () => byId('detail-dialog').close())
  byId('roster-add').addEventListener('click', openMemberDialog)
  byId('member-add').addEventListener('click', addMember)
  byId('member-close').addEventListener('click', () => byId('member-dialog').close())
  byId('member-cancel').addEventListener('click', () => byId('member-dialog').close())
  for (const button of document.querySelectorAll('.inspector-tab')) {
    button.addEventListener('click', () => { state.inspector = button.dataset.panel; renderInspector() })
  }
}

async function init() {
  attachEvents()
  setupResizableLayout()
  try {
    const [agents, projects, skillCatalog] = await Promise.all([
      request('listAgents', { includeArchived: false }), request('listProjects'),
      request('listSkills').catch(() => ({ skills: [], roots: [] })),
    ])
    ;[state.agents, state.projects, state.skillCatalog] = [agents, projects, skillCatalog]
    renderEmployees()
    renderProjects()
    renderWizardMembers()
    if (state.projects.length) await openProject(state.projects[0].id)
    state.refreshTimer = setInterval(() => refreshCurrent(false), 3500)
  } catch (error) {
    toast(`集群模块初始化失败：${error.message}`, 'error')
  }
}

document.addEventListener('DOMContentLoaded', init)
