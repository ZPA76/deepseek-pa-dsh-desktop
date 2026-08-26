'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const DEFAULT_DSH_HOME = process.env.DSH_HOME || path.join(process.env.LOCALAPPDATA || process.env.HOME || process.cwd(), 'DeepSeek-PA', 'dsh-home')
const EVENT_CHANNELS = new Set(['room', 'worklog', 'activity', 'control', 'system', 'private'])

function defaultEventChannel(type, meta = {}, phase = '') {
  const name = String(type || '')
  if (name === 'user.message') return 'room'
  if (name === 'agent.message.completed' && (meta.purpose === 'discussion' || phase === 'discussion')) return 'room'
  if (name === 'agent.activity' || name === 'phase.changed') return 'activity'
  if (/^(approval|decision|artifact|member)\./.test(name)) return 'control'
  if (/^(tool|action|task|run|telemetry|experience)\./.test(name)) return 'worklog'
  return 'system'
}

function defaultEventPurpose(type, channel, meta = {}) {
  if (meta && meta.purpose) return String(meta.purpose)
  if (channel === 'room') return 'discussion'
  if (channel === 'activity') return 'progress'
  if (channel === 'control') return 'control'
  if (channel === 'worklog') return 'work'
  return 'system'
}

function normalizeEventShape(event) {
  const source = event && typeof event === 'object' ? event : {}
  const type = String(source.type || source.eventType || 'system.notice')
  const meta = source.meta && typeof source.meta === 'object' ? source.meta : {}
  const channel = EVENT_CHANNELS.has(String(source.channel || meta.channel || ''))
    ? String(source.channel || meta.channel)
    : defaultEventChannel(type, meta, source.phase)
  return {
    ...source,
    type,
    channel,
    purpose: String(source.purpose || defaultEventPurpose(type, channel, meta)),
    visibility: String(source.visibility || (channel === 'room' ? 'participants' : 'owner')),
  }
}

function nowIso() {
  return new Date().toISOString()
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key))
}

function assertSafeId(value, label = 'ID') {
  const id = String(value || '')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id)) {
    throw new Error(`${label} 格式无效`)
  }
  return id
}

function normalizeSkillAccess(value, fallback = {}) {
  const source = value && typeof value === 'object' ? value : fallback
  const mode = ['all', 'selected', 'none'].includes(source && source.mode) ? source.mode : 'all'
  const rawNames = source && Array.isArray(source.names) ? source.names : []
  const names = [...new Set(rawNames
    .map((item) => String(item || '').trim())
    .filter((item) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item)))]
    .slice(0, 50)
  return { mode, names }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    if (arguments.length > 1 && error instanceof SyntaxError) {
      try { fs.renameSync(file, `${file}.corrupt-${Date.now()}`) } catch (_) {}
      return clone(fallback)
    }
    if (arguments.length > 1 && error.code === 'ENOENT') return clone(fallback)
    throw error
  }
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true })
}

function atomicWriteJson(file, value) {
  ensureDirectory(path.dirname(file))
  const suffix = `${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
  const temporary = `${file}.${suffix}.tmp`
  const descriptor = fs.openSync(temporary, 'w')
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
  try {
    fs.renameSync(temporary, file)
  } catch (error) {
    // 部分 Windows 文件系统不允许 rename 覆盖已有目标；复制仍保留完整 JSON 写入。
    if (!['EEXIST', 'EPERM', 'EACCES'].includes(error.code)) throw error
    fs.copyFileSync(temporary, file)
    fs.unlinkSync(temporary)
  }
}

function normalizeMembers(members) {
  if (!Array.isArray(members)) return []
  return members.map((member, index) => ({
    id: String(member.id || member.agent || `member-${index + 1}`),
    agent: String(member.agent || member.id || ''),
    name: String(member.name || ''),
    role: String(member.role || member.name || `员工 ${index + 1}`),
    duty: String(member.duty || ''),
    rank: Number.isFinite(Number(member.rank)) ? Number(member.rank) : index + 1,
    provider: String(member.provider || 'deepseek'),
    model: String(member.model || ''),
    authority: String(member.authority || (index === 0 ? 'lead' : 'member')),
    brain: member.brain && typeof member.brain === 'object' ? clone(member.brain) : { type: String(member.brainType || 'dsh-acp') },
    permission: ['ask', 'auto', 'full'].includes(member.permission) ? member.permission : 'ask',
  }))
}

function normalizeProject(input, existing = null, touch = true) {
  const timestamp = nowIso()
  const project = { ...(existing || {}), ...(input || {}) }
  const id = assertSafeId(project.id, '项目 ID')
  return {
    ...project,
    schemaVersion: 4,
    id,
    name: String(project.name || id).trim() || id,
    goal: String(project.goal || project.brief || '').trim(),
    importanceLevel: Number.isInteger(Number(project.importanceLevel)) && Number(project.importanceLevel) >= 1 && Number(project.importanceLevel) <= 5 ? Number(project.importanceLevel) : 3,
    mode: ['hierarchy', 'team', 'autonomous'].includes(project.mode) ? project.mode : 'hierarchy',
    status: String(project.status || 'draft'),
    phase: String(project.phase || 'draft'),
    lifecycleState: ['active', 'archived', 'trashed'].includes(String(project.lifecycleState || 'active')) ? String(project.lifecycleState || 'active') : 'active',
    archivedAt: String(project.archivedAt || ''),
    trashedAt: String(project.trashedAt || ''),
    workspace: String(project.workspace || ''),
    members: normalizeMembers(project.members),
    governance: project.governance && typeof project.governance === 'object' ? clone(project.governance) : {},
    createdAt: existing && existing.createdAt ? existing.createdAt : String(project.createdAt || timestamp),
    updatedAt: touch ? timestamp : String(project.updatedAt || project.createdAt || timestamp),
  }
}

class ClusterStore {
  constructor(options = {}) {
    this.homeDir = path.resolve(options.homeDir || DEFAULT_DSH_HOME)
    this.clustersDir = path.join(this.homeDir, 'clusters')
    this.projectsDir = path.join(this.clustersDir, 'projects')
    this.employeesDir = path.join(this.homeDir, 'employees')
    ensureDirectory(this.clustersDir)
    ensureDirectory(this.projectsDir)
    ensureDirectory(this.employeesDir)
  }

  projectDir(projectId) {
    return path.join(this.projectsDir, assertSafeId(projectId, '项目 ID'))
  }

  projectFile(projectId) {
    return path.join(this.projectDir(projectId), 'project.json')
  }

  legacyProjectFile(projectId) {
    return path.join(this.clustersDir, `${assertSafeId(projectId, '项目 ID')}.json`)
  }

  getProject(projectId) {
    const modern = this.projectFile(projectId)
    if (fs.existsSync(modern)) return readJson(modern)
    const legacy = this.legacyProjectFile(projectId)
    if (fs.existsSync(legacy)) return normalizeProject(readJson(legacy), null, false)
    throw new Error(`未找到集群项目：${projectId}`)
  }

  listProjects(options = {}) {
    const projects = new Map()
    for (const entry of fs.readdirSync(this.projectsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      try {
        const project = readJson(path.join(this.projectsDir, entry.name, 'project.json'))
        projects.set(project.id, project)
      } catch (_) {}
    }
    for (const entry of fs.readdirSync(this.clustersDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      try {
        const legacy = readJson(path.join(this.clustersDir, entry.name))
        const project = normalizeProject(legacy, null, false)
        if (!projects.has(project.id)) projects.set(project.id, project)
      } catch (_) {}
    }
    return [...projects.values()]
      .filter((project) => options.includeTrashed || project.lifecycleState !== 'trashed')
      .map((project) => ({ ...project, displayStatus: this.projectDisplayStatus(project) }))
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  }

  saveProject(project) {
    if (!project || !project.id) throw new Error('项目缺少 id')
    let existing = null
    try { existing = this.getProject(project.id) } catch (_) {}
    const normalized = normalizeProject(project, existing)
    if (normalized.workspace && !path.isAbsolute(normalized.workspace)) throw new Error('项目工作目录必须是绝对路径')
    normalized.workspace = normalized.workspace
      ? path.resolve(normalized.workspace)
      : path.join(this.homeDir, 'workspaces', normalized.id)
    ensureDirectory(normalized.workspace)
    atomicWriteJson(this.projectFile(normalized.id), normalized)
    // 保留旧版读取兼容；不删除旧文件，新旧入口始终指向同一份项目快照。
    atomicWriteJson(this.legacyProjectFile(normalized.id), normalized)
    return clone(normalized)
  }

  updateProject(projectId, patch) {
    const project = this.getProject(projectId)
    return this.saveProject({ ...project, ...(patch || {}), id: project.id })
  }

  listTrashedProjects() {
    return this.listProjects({ includeTrashed: true }).filter((project) => project.lifecycleState === 'trashed')
  }

  archiveProject(projectId, archived = true) {
    const project = this.getProject(projectId)
    const next = this.saveProject({
      ...project,
      lifecycleState: archived ? 'archived' : 'active',
      archivedAt: archived ? nowIso() : '',
    })
    this.appendEvent(next.id, {
      type: archived ? 'project.archived' : 'project.restored',
      text: archived ? '项目已归档，项目记录与工作轨迹仍然保留' : '项目已恢复到活动项目',
      meta: { lifecycleState: next.lifecycleState },
    })
    return clone(next)
  }

  trashProject(projectId) {
    const project = this.getProject(projectId)
    if (project.lifecycleState === 'trashed') return clone(project)
    const next = this.saveProject({
      ...project,
      lifecycleState: 'trashed',
      trashedAt: nowIso(),
      archivedAt: '',
    })
    this.appendEvent(next.id, {
      type: 'project.trashed',
      text: '项目已移入回收站；聊天、轨迹、交付和审批记录仍可恢复',
      meta: { lifecycleState: next.lifecycleState },
    })
    return clone(next)
  }

  restoreProject(projectId) {
    const project = this.getProject(projectId)
    if (project.lifecycleState !== 'trashed') return clone(project)
    const next = this.saveProject({
      ...project,
      lifecycleState: 'active',
      trashedAt: '',
      restoredAt: nowIso(),
    })
    this.appendEvent(next.id, {
      type: 'project.restored',
      text: '项目已从回收站恢复',
      meta: { lifecycleState: next.lifecycleState },
    })
    return clone(next)
  }

  setProjectImportance(projectId, levelValue) {
    const level = Number(levelValue)
    if (!Number.isInteger(level) || level < 1 || level > 5) throw new Error('项目重要性必须是 1–5 级')
    const project = this.getProject(projectId)
    const next = normalizeProject({ ...project, importanceLevel: level }, project, false)
    atomicWriteJson(this.projectFile(next.id), next)
    atomicWriteJson(this.legacyProjectFile(next.id), next)
    this.appendEvent(next.id, {
      type: 'project.importance-changed',
      text: `项目重要性已设为 ${level} 级`,
      meta: { importanceLevel: level },
    })
    return clone(next)
  }

  deleteProjectForever(projectId) {
    const project = this.getProject(projectId)
    if (project.lifecycleState !== 'trashed') throw new Error('项目必须先移入回收站，才能永久删除')
    const modern = this.projectDir(project.id)
    const legacy = this.legacyProjectFile(project.id)
    const workspace = project.workspace ? path.resolve(project.workspace) : ''
    if (fs.existsSync(modern)) fs.rmSync(modern, { recursive: true, force: true })
    if (fs.existsSync(legacy)) fs.rmSync(legacy, { force: true })
    return { projectId: project.id, name: project.name, deleted: true, workspace, workspaceDeleted: false }
  }

  emptyProjectTrash() {
    const projects = this.listTrashedProjects()
    const deleted = []
    const failed = []
    for (const project of projects) {
      try { deleted.push(this.deleteProjectForever(project.id)) }
      catch (error) { failed.push({ projectId: project.id, error: String(error.message || error) }) }
    }
    return { requested: projects.length, deletedCount: deleted.length, failedCount: failed.length, deleted, failed }
  }

  eventsFile(projectId) {
    return path.join(this.projectDir(projectId), 'events.jsonl')
  }

  listEvents(projectId, options = {}) {
    const file = this.eventsFile(projectId)
    if (!fs.existsSync(file)) return []
    const after = Math.max(0, Number(options.after || 0))
    const limit = Math.min(2000, Math.max(1, Number(options.limit || 500)))
    const events = []
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        const event = normalizeEventShape(JSON.parse(line))
        if (Number(event.seq || 0) > after) events.push(event)
      } catch (_) {}
    }
    return events.slice(-limit)
  }

  appendEvent(projectId, input) {
    const id = assertSafeId(projectId, '项目 ID')
    // 项目必须先存在，避免孤立事件和任意路径写入。
    this.getProject(id)
    const previous = this.listEvents(id, { limit: 1 })
    const seq = previous.length ? Number(previous[0].seq || 0) + 1 : 1
    const eventType = String((input && input.type) || 'system.notice')
    const eventMeta = input && input.meta && typeof input.meta === 'object' ? clone(input.meta) : undefined
    const eventChannel = EVENT_CHANNELS.has(String((input && input.channel) || '')) ? String(input.channel) : defaultEventChannel(eventType, eventMeta, input && input.phase)
    const eventPurpose = String((input && input.purpose) || defaultEventPurpose(eventType, eventChannel, eventMeta))
    const eventVisibility = String((input && input.visibility) || (eventChannel === 'room' ? 'participants' : 'owner'))
    const event = {
      id: crypto.randomUUID(),
      seq,
      timestamp: nowIso(),
      projectId: id,
      runId: input && input.runId ? String(input.runId) : '',
      phase: input && input.phase ? String(input.phase) : '',
      taskId: input && input.taskId ? String(input.taskId) : '',
      actor: input && input.actor ? clone(input.actor) : { id: 'system', name: 'DPA', kind: 'system' },
      type: eventType,
      audience: String((input && input.audience) || 'project'),
      text: String((input && input.text) || ''),
      status: String((input && input.status) || ''),
      metrics: input && input.metrics ? clone(input.metrics) : undefined,
      channel: eventChannel,
      purpose: eventPurpose,
      visibility: eventVisibility,
      meta: eventMeta,
    }
    ensureDirectory(this.projectDir(id))
    const file = this.eventsFile(id)
    const descriptor = fs.openSync(file, 'a')
    try {
      fs.writeSync(descriptor, `${JSON.stringify(event)}\n`, undefined, 'utf8')
      fs.fsyncSync(descriptor)
    } finally {
      fs.closeSync(descriptor)
    }
    return clone(event)
  }

  collectionFile(projectId, name) {
    const allowed = new Set(['tasks', 'approvals', 'artifacts', 'decisions', 'actions'])
    if (!allowed.has(name)) throw new Error('未知项目集合')
    return path.join(this.projectDir(projectId), `${name}.json`)
  }

  listCollection(projectId, name) {
    this.getProject(projectId)
    const items = readJson(this.collectionFile(projectId, name), [])
    return Array.isArray(items) ? items : []
  }

  upsertCollection(projectId, name, input) {
    if (!input || typeof input !== 'object') throw new Error('集合记录不能为空')
    const items = this.listCollection(projectId, name)
    const timestamp = nowIso()
    const id = assertSafeId(input.id || `${name.slice(0, -1)}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, `${name} ID`)
    const index = items.findIndex((item) => item.id === id)
    const existing = index >= 0 ? items[index] : null
    const item = {
      ...(existing || {}),
      ...clone(input),
      id,
      createdAt: existing && existing.createdAt ? existing.createdAt : String(input.createdAt || timestamp),
      updatedAt: timestamp,
    }
    if (index >= 0) items[index] = item
    else items.push(item)
    atomicWriteJson(this.collectionFile(projectId, name), items)
    return clone(item)
  }

  listTasks(projectId) { return this.listCollection(projectId, 'tasks') }
  saveTask(projectId, task) { return this.upsertCollection(projectId, 'tasks', task) }
  listApprovals(projectId) { return this.listCollection(projectId, 'approvals') }
  saveApproval(projectId, approval) { return this.upsertCollection(projectId, 'approvals', approval) }
  listArtifacts(projectId) { return this.listCollection(projectId, 'artifacts') }
  saveArtifact(projectId, artifact) { return this.upsertCollection(projectId, 'artifacts', artifact) }
  listDecisions(projectId) { return this.listCollection(projectId, 'decisions') }
  saveDecision(projectId, decision) { return this.upsertCollection(projectId, 'decisions', decision) }
  listActions(projectId) { return this.listCollection(projectId, 'actions') }
  saveAction(projectId, action) { return this.upsertCollection(projectId, 'actions', action) }

  projectDisplayStatus(project) {
    try {
      if (this.listApprovals(project.id).some((approval) => approval.status === 'pending')) return 'awaiting'
    } catch (_) {}
    const running = new Set([
      'active', 'pausing', 'cancelling', 'running', 'awaiting-acceptance',
    ])
    return running.has(String(project.status || '')) ? 'running' : 'rest'
  }

  employeeFile(employeeId) {
    return path.join(this.employeesDir, `${assertSafeId(employeeId, '员工 ID')}.json`)
  }

  listEmployees(options = {}) {
    const includeArchived = Boolean(options && options.includeArchived)
    const employees = []
    for (const entry of fs.readdirSync(this.employeesDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      try {
        const employee = readJson(path.join(this.employeesDir, entry.name))
        if (employee.archived && !includeArchived) continue
        employees.push(employee)
      } catch (_) {}
    }
    return employees.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id), 'zh-CN'))
  }

  getEmployee(employeeId) {
    const file = this.employeeFile(employeeId)
    if (!fs.existsSync(file)) throw new Error(`未找到员工：${employeeId}`)
    return readJson(file)
  }

  saveEmployee(input) {
    if (!input || !input.id) throw new Error('员工缺少 id')
    const id = assertSafeId(input.id, '员工 ID')
    let existing = null
    try { existing = this.getEmployee(id) } catch (_) {}
    const timestamp = nowIso()
    const nextVersion = Number((existing && existing.version) || 0) + 1
    const existingValue = (key, fallback) => existing && existing[key] != null ? existing[key] : fallback
    const textValue = (key, fallback = '') => String(hasOwn(input, key) ? (input[key] == null ? '' : input[key]) : existingValue(key, fallback))
    const description = hasOwn(input, 'description')
      ? String(input.description == null ? '' : input.description)
      : (hasOwn(input, 'desc') ? String(input.desc == null ? '' : input.desc) : String(existingValue('description', '')))
    const employee = {
      ...(existing || {}),
      ...clone(input),
      schemaVersion: 3,
      id,
      version: nextVersion,
      name: textValue('name', id).trim() || id,
      description,
      persona: textValue('persona'),
      provider: textValue('provider', 'deepseek') || 'deepseek',
      model: textValue('model'),
      skills: hasOwn(input, 'skills') && Array.isArray(input.skills) ? input.skills.map(String) : clone(existingValue('skills', [])),
      skillAccess: normalizeSkillAccess(hasOwn(input, 'skillAccess') ? input.skillAccess : existingValue('skillAccess', { mode: 'all', names: [] })),
      experience: hasOwn(input, 'experience') && Array.isArray(input.experience) ? clone(input.experience) : clone(existingValue('experience', [])),
      metrics: hasOwn(input, 'metrics') && input.metrics && typeof input.metrics === 'object' ? clone(input.metrics) : clone(existingValue('metrics', {})),
      brain: hasOwn(input, 'brain') && input.brain && typeof input.brain === 'object'
        ? clone(input.brain)
        : clone(existingValue('brain', { type: 'dsh-acp' })),
      lineage: hasOwn(input, 'lineage') && input.lineage && typeof input.lineage === 'object'
        ? clone(input.lineage)
        : clone(existingValue('lineage', {})),
      development: hasOwn(input, 'development') && input.development && typeof input.development === 'object'
        ? clone(input.development)
        : clone(existingValue('development', {})),
      status: textValue('status', 'available') || 'available',
      source: textValue('source', 'dpa') || 'dpa',
      archived: Boolean(hasOwn(input, 'archived') ? input.archived : existingValue('archived', false)),
      createdAt: existing && existing.createdAt ? existing.createdAt : String(input.createdAt || timestamp),
      updatedAt: timestamp,
    }
    // 保存前把上一版归档为不可变快照（成长档案），版本号随之晋升
    if (existing && existing.version) {
      ensureDirectory(this.employeeVersionsDir(id))
      atomicWriteJson(path.join(this.employeeVersionsDir(id), `v${existing.version}.json`), existing)
    }
    atomicWriteJson(this.employeeFile(id), employee)
    return clone(employee)
  }

  employeeVersionsDir(employeeId) {
    return path.join(this.employeesDir, assertSafeId(employeeId, '员工 ID'), 'versions')
  }

  listEmployeeVersions(employeeId) {
    const id = assertSafeId(employeeId, '员工 ID')
    const current = this.getEmployee(id)
    const versions = []
    const directory = this.employeeVersionsDir(id)
    if (fs.existsSync(directory)) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !/^v\d+\.json$/.test(entry.name)) continue
        try { versions.push(readJson(path.join(directory, entry.name))) } catch (_) {}
      }
    }
    if (!versions.some((item) => Number(item.version) === Number(current.version))) versions.push(current)
    return versions.sort((a, b) => Number(b.version || 0) - Number(a.version || 0)).map(clone)
  }

  restoreEmployeeVersion(employeeId, version) {
    const id = assertSafeId(employeeId, '员工 ID')
    const selected = this.listEmployeeVersions(id).find((item) => Number(item.version) === Number(version))
    if (!selected) throw new Error(`未找到员工 ${id} 的 v${version}`)
    const current = this.getEmployee(id)
    return this.saveEmployee({
      ...selected,
      id,
      archived: current.archived,
      source: 'dpa-restore',
      development: {
        ...(selected.development || {}),
        restoredFromVersion: Number(version),
        restoredAt: nowIso(),
      },
    })
  }

  employeeTrainingRunsDir(employeeId) {
    return path.join(this.employeesDir, assertSafeId(employeeId, '员工 ID'), 'training-runs')
  }

  trainingRunFile(employeeId, runId) {
    return path.join(
      this.employeeTrainingRunsDir(employeeId),
      `${assertSafeId(runId, '培养记录 ID')}.json`,
    )
  }

  saveTrainingRun(employeeId, input) {
    const id = assertSafeId(employeeId, '员工 ID')
    this.getEmployee(id)
    const runId = assertSafeId(input && input.id ? input.id : `training-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, '培养记录 ID')
    const file = this.trainingRunFile(id, runId)
    const existing = fs.existsSync(file) ? readJson(file) : null
    const timestamp = nowIso()
    const run = {
      ...(existing || {}),
      ...clone(input || {}),
      id: runId,
      employeeId: id,
      status: String((input && input.status) || (existing && existing.status) || 'candidate'),
      createdAt: existing && existing.createdAt ? existing.createdAt : timestamp,
      updatedAt: timestamp,
    }
    atomicWriteJson(file, run)
    return clone(run)
  }

  getTrainingRun(employeeId, runId) {
    const file = this.trainingRunFile(employeeId, runId)
    if (!fs.existsSync(file)) throw new Error(`未找到培养记录：${runId}`)
    return readJson(file)
  }

  listTrainingRuns(employeeId) {
    const id = assertSafeId(employeeId, '员工 ID')
    this.getEmployee(id)
    const directory = this.employeeTrainingRunsDir(id)
    if (!fs.existsSync(directory)) return []
    const runs = []
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      try { runs.push(readJson(path.join(directory, entry.name))) } catch (_) {}
    }
    return runs.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))).map(clone)
  }

  promoteTrainingRun(employeeId, runId) {
    const id = assertSafeId(employeeId, '员工 ID')
    const run = this.getTrainingRun(id, runId)
    if (!run.candidate || typeof run.candidate !== 'object') throw new Error('培养记录没有可晋升的候选版本')
    if (!run.evaluation || !run.evaluation.passed) throw new Error('候选版本尚未通过独立考核，不能晋升')
    const current = this.getEmployee(id)
    const promoted = this.saveEmployee({
      ...current,
      ...clone(run.candidate),
      id,
      metrics: {
        ...(current.metrics || {}),
        ...((run.evaluation && { evalScore: Number(run.evaluation.score || 0) }) || {}),
      },
      lineage: {
        ...(current.lineage || {}),
        mentorId: String(run.mentorId || ''),
        trainingRunId: run.id,
      },
      development: {
        ...(current.development || {}),
        developmentSummary: String(run.candidate.developmentSummary || run.goal || ''),
        lastTrainingRunId: run.id,
        lastPromotedAt: nowIso(),
      },
    })
    this.saveTrainingRun(id, { ...run, status: 'promoted', promotedVersion: promoted.version, promotedAt: nowIso() })
    return promoted
  }

  appendEmployeeExperience(employeeId, entries) {
    const id = assertSafeId(employeeId, '员工 ID')
    const employee = this.getEmployee(id)
    const experience = Array.isArray(employee.experience) ? [...employee.experience] : []
    for (const entry of (Array.isArray(entries) ? entries : [])) {
      experience.push({
        id: entry.id || crypto.randomUUID(),
        projectId: String(entry.projectId || ''),
        lesson: String(entry.lesson || entry.text || '').trim(),
        tags: Array.isArray(entry.tags) ? entry.tags.map(String) : [],
        gainedAt: String(entry.gainedAt || nowIso()),
      })
    }
    return this.saveEmployee({ ...employee, id, experience })
  }

  archiveEmployee(employeeId, archived = true) {
    const employee = this.getEmployee(employeeId)
    if (employee.archived === Boolean(archived)) return clone(employee)
    // 归档/恢复只翻转标记，不晋升版本、不动成长档案
    const updated = { ...employee, archived: Boolean(archived), updatedAt: nowIso() }
    atomicWriteJson(this.employeeFile(employee.id), updated)
    return clone(updated)
  }

  deleteEmployee(employeeId) {
    const id = assertSafeId(employeeId, '员工 ID')
    const employee = this.getEmployee(id)
    const references = this.listProjects().filter((project) =>
      Array.isArray(project.members) && project.members.some((member) => String(member.agent || member.id) === id))
    if (references.length) {
      throw new Error(`员工已参与 ${references.length} 个项目，不能永久删除；请改用归档以保留项目历史`)
    }
    const suffix = nowIso().replace(/[^0-9]/g, '').slice(0, 14)
    const trash = path.join(this.employeesDir, '.trash', `${id}-${suffix}`)
    ensureDirectory(trash)
    fs.renameSync(this.employeeFile(id), path.join(trash, 'employee.json'))
    const history = path.join(this.employeesDir, id)
    if (fs.existsSync(history)) fs.renameSync(history, path.join(trash, 'history'))
    return {
      id,
      deleted: true,
      recoverable: true,
      trashPath: trash,
      employee: clone(employee),
    }
  }

  getProjectOverview(projectId) {
    const project = this.getProject(projectId)
    return {
      project: { ...project, displayStatus: this.projectDisplayStatus(project) },
      tasks: this.listTasks(projectId),
      approvals: this.listApprovals(projectId),
      artifacts: this.listArtifacts(projectId),
      decisions: this.listDecisions(projectId),
      actions: this.listActions(projectId),
      lastEventSeq: (this.listEvents(projectId, { limit: 1 })[0] || {}).seq || 0,
    }
  }
}

module.exports = {
  ClusterStore,
  DEFAULT_DSH_HOME,
  assertSafeId,
  atomicWriteJson,
  normalizeProject,
}
