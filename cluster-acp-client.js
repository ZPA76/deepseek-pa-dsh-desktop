'use strict'

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

function loadCredentialEnv(homeDir) {
  const file = path.join(String(homeDir || ''), '.credentials.yaml')
  if (!fs.existsSync(file)) return {}
  let text = ''
  try { text = fs.readFileSync(file, 'utf8') } catch (_) { return {} }
  const values = {}
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(DEEPSEEK_API_KEY)\s*:\s*(.*?)\s*$/)
    if (!match) continue
    let value = match[2]
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (value) values[match[1]] = value
  }
  return values
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000

function bounded(value, limit = 4000) {
  const text = String(value == null ? '' : value)
  return text.length > limit ? `${text.slice(0, limit)}\n…（已截断）` : text
}

function redactSensitive(value) {
  return String(value == null ? '' : value)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-***')
    .replace(/((?:api[_-]?key|authorization|access[_-]?token|password|secret)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1***')
}

function parseArguments(value) {
  if (value && typeof value === 'object') return value
  try { return JSON.parse(String(value || '{}')) } catch (_) { return { raw: String(value || '') } }
}

function summarizeToolCall(name, argumentsValue) {
  const args = parseArguments(argumentsValue)
  if (name === 'skill') return `加载 Skill：${String(args.name || '未知')}`
  const detail = args.description || args.command || args.path || args.query || args.url || args.raw || ''
  return detail ? `调用 ${name}：${bounded(redactSensitive(detail), 320)}` : `调用 ${name}`
}

function resultContent(event) {
  const blocks = event && event.data && event.data.message && event.data.message.content
  if (!Array.isArray(blocks)) return { text: '', isError: false, callId: '' }
  for (const block of blocks) {
    if (!block || block.type !== 'tool-result') continue
    const content = Array.isArray(block.content) ? block.content : []
    const text = content
      .filter((item) => item && item.type === 'text')
      .map((item) => item.text)
      .join('\n')
    return {
      text: bounded(redactSensitive(text)),
      isError: Boolean(block.isError),
      callId: String(block.toolCallId || ''),
    }
  }
  return { text: '', isError: false, callId: '' }
}
function findSessionLog(root, sessionId = '') {
  if (!fs.existsSync(root)) return ''
  const stack = [root]
  const candidates = []
  while (stack.length) {
    const directory = stack.pop()
    let entries = []
    try { entries = fs.readdirSync(directory, { withFileTypes: true }) } catch (_) { continue }
    for (const entry of entries) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) stack.push(target)
      else if (entry.isFile() && entry.name === 'session.jsonl') {
        let modified = 0
        try { modified = fs.statSync(target).mtimeMs } catch (_) {}
        candidates.push({ target, modified })
      }
    }
  }
  if (sessionId) {
    const exact = candidates.find((item) => path.basename(path.dirname(item.target)) === sessionId)
    if (exact) return exact.target
  }
  candidates.sort((a, b) => b.modified - a.modified)
  return candidates.length ? candidates[0].target : ''
}

function readSessionEvents(file, afterSeq) {
  if (!file || !fs.existsSync(file)) return []
  const events = []
  let text = ''
  try { text = fs.readFileSync(file, 'utf8') } catch (_) { return [] }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line)
      if (Number(event.seq) > afterSeq) events.push(event)
    } catch (_) {}
  }
  return events.sort((a, b) => Number(a.seq) - Number(b.seq))
}

class AcpHarnessClient {
  constructor(options) {
    this.options = options
    this.child = null
    this.nextId = 1
    this.pending = new Map()
    this.stdoutBuffer = ''
    this.stderrTail = ''
    this.closed = false
    this.closing = false
    this.exitPromise = null
  }

  start() {
    if (this.child) return
    const harnessDir = path.resolve(this.options.harnessDir)
    const bin = path.join(harnessDir, 'packages', 'examples', 'acp-demo', 'src', 'bin.ts')
    const appConfig = process.resourcesPath ? path.join(process.resourcesPath, 'dpa.cordis.yml') : ''
    const localConfig = path.join(__dirname, 'dpa.cordis.yml')
    const harnessConfig = path.join(harnessDir, 'examples', 'acp-agent', 'cordis.yml')
    const config = [this.options.configPath, appConfig, localConfig, harnessConfig]
      .filter(Boolean)
      .find((candidate) => fs.existsSync(candidate))
    if (!fs.existsSync(bin) || !fs.existsSync(config)) throw new Error('Harness ACP 运行入口不完整')

    const env = {
      ...loadCredentialEnv(this.options.dshHome),
      ...process.env,
      DSH_HOME: this.options.dshHome,
      DSH_PERMISSION_MODE: 'workspace-write',
      DSH_SNAPSHOT: 'record',
      DSH_SNAPSHOT_SESSIONS_ROOT: this.options.sessionsRoot,
      DPA_ACP_PROVIDER: this.options.provider || 'deepseek-official',
      DPA_ACP_MODEL: this.options.model || 'deepseek-v4-pro',
      DPA_ACP_PERSONA: this.options.persona || '',
      DPA_SKILL_MODE: ['all', 'selected', 'none'].includes(this.options.skillMode) ? this.options.skillMode : 'all',
    }
    this.child = spawn('node', ['--import', 'tsx', bin, '--config', config], {
      cwd: harnessDir,
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.exitPromise = new Promise((resolve) => {
      this.child.once('close', (code, signal) => {
        this.closed = true
        const error = new Error(`Harness ACP 已退出（code=${code}, signal=${signal || 'none'}）：${bounded(this.stderrTail, 1200)}`)
        for (const item of this.pending.values()) {
          clearTimeout(item.timer)
          item.reject(error)
        }
        this.pending.clear()
        resolve({ code, signal })
      })
    })
    this.child.once('error', (error) => {
      for (const item of this.pending.values()) {
        clearTimeout(item.timer)
        item.reject(error)
      }
      this.pending.clear()
    })
    this.child.stdout.on('data', (chunk) => this.consumeStdout(String(chunk || '')))
    this.child.stderr.on('data', (chunk) => {
      const text = String(chunk || '')
      this.stderrTail = bounded(`${this.stderrTail}${text}`, 8000)
      if (this.options.onDiagnostic) this.options.onDiagnostic(bounded(redactSensitive(text.trim()), 500))
    })
  }

  consumeStdout(text) {
    this.stdoutBuffer += text
    const lines = this.stdoutBuffer.split(/\r?\n/)
    this.stdoutBuffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      try { this.handleFrame(JSON.parse(line)) } catch (_) {}
    }
  }

  handleFrame(frame) {
    if (frame && frame.method && frame.id != null) {
      this.handleServerRequest(frame)
      return
    }
    if (frame && frame.method) {
      if (this.options.onNotification) this.options.onNotification(frame)
      return
    }
    const item = frame && this.pending.get(frame.id)
    if (!item) return
    this.pending.delete(frame.id)
    clearTimeout(item.timer)
    if (frame.error) item.reject(new Error(String(frame.error.message || 'ACP 请求失败')))
    else item.resolve(frame.result)
  }

  handleServerRequest(frame) {
    if (frame.method !== 'session/request_permission') {
      this.write({ jsonrpc: '2.0', id: frame.id, error: { code: -32601, message: 'Unsupported client method' } })
      return
    }
    const decide = this.options.onPermission
      ? Promise.resolve(this.options.onPermission(frame.params || {}))
      : Promise.resolve('reject')
    decide.then((decision) => {
      const allow = decision === true || decision === 'allow'
      const kind = allow ? 'allow_once' : 'reject_once'
      const options = Array.isArray(frame.params && frame.params.options) ? frame.params.options : []
      const selected = options.find((item) => item.kind === kind)
      if (!selected) return { outcome: { outcome: 'cancelled' } }
      return { outcome: { outcome: 'selected', optionId: selected.optionId } }
    }).then((result) => {
      this.write({ jsonrpc: '2.0', id: frame.id, result })
    }).catch(() => {
      this.write({ jsonrpc: '2.0', id: frame.id, result: { outcome: { outcome: 'cancelled' } } })
    })
  }

  write(frame) {
    if (!this.child || this.closed || !this.child.stdin.writable) throw new Error('Harness ACP 连接不可用')
    this.child.stdin.write(`${JSON.stringify(frame)}\n`)
  }

  notify(method, params) {
    this.write({ jsonrpc: '2.0', method, params })
  }

  request(method, params, timeoutMs = 30000) {
    this.start()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Harness ACP 请求超时：${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      try { this.write({ jsonrpc: '2.0', id, method, params }) } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  async close() {
    if (!this.child || this.closed || this.closing) return
    this.closing = true
    try { this.child.stdin.end() } catch (_) {}
    const exited = await Promise.race([
      this.exitPromise.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 6000)),
    ])
    if (!exited && this.child && !this.closed) {
      try { this.child.kill() } catch (_) {}
      await Promise.race([
        this.exitPromise,
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ])
    }
  }
}

function createLogProjector(options) {
  let logFile = ''
  let sessionId = ''
  let lastSeq = -1
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, reasoningTokens: 0, totalTokens: 0 }
  let toolCalls = 0

  const publish = (event) => {
    if (options.onEvent) options.onEvent(event)
  }
  const flush = () => {
    if (!logFile) logFile = findSessionLog(options.sessionsRoot, sessionId)
    for (const event of readSessionEvents(logFile, lastSeq)) {
      lastSeq = Math.max(lastSeq, Number(event.seq))
      if (event.type === 'step/start') {
        publish({ type: 'agent.activity', text: `Harness 执行步骤 ${event.data && event.data.step || ''}` })
      } else if (event.type === 'tool/call') {
        toolCalls += 1
        const args = parseArguments(event.data && event.data.arguments)
        publish({
          type: 'tool.call',
          text: summarizeToolCall(event.data && event.data.name || 'tool', args),
          status: 'running',
          meta: {
            callId: String(event.data && event.data.callId || ''),
            tool: String(event.data && event.data.name || ''),
            arguments: redactSensitive(JSON.stringify(args)),
          },
        })
      } else if (event.type === 'tool/result') {
        const result = resultContent(event)
        publish({
          type: 'tool.result',
          text: result.text || (result.isError ? '工具执行失败' : '工具执行完成'),
          status: result.isError ? 'failed' : 'done',
          meta: { callId: result.callId, isError: result.isError },
        })
      } else if (event.type === 'assistant/message' && event.data && event.data.usage) {
        for (const key of Object.keys(usage)) usage[key] += Number(event.data.usage[key] || 0)
        usage.totalTokens = usage.inputTokens + usage.outputTokens
        publish({
          type: 'telemetry.usage',
          text: `Harness 累计 ${usage.totalTokens} tokens`,
          metrics: { ...usage },
        })
      }
    }
  }
  return {
    flush,
    setSessionId: (value) => { sessionId = String(value || ''); logFile = '' },
    summary: () => ({ usage: { ...usage }, toolCalls, logFile }),
  }
}

async function runAcpTask(options) {
  fs.mkdirSync(options.workspace, { recursive: true })
  fs.mkdirSync(options.sessionsRoot, { recursive: true })
  let finalText = ''
  let sessionId = ''
  const projector = createLogProjector(options)
  const client = new AcpHarnessClient({
    ...options,
    onNotification: (frame) => {
      const update = frame && frame.method === 'session/update' && frame.params && frame.params.update
      if (!update || update.sessionUpdate !== 'agent_message_chunk') return
      if (update.content && update.content.type === 'text') finalText += String(update.content.text || '')
    },
  })
  let poll = null
  const onAbort = () => {
    try {
      if (sessionId) client.notify('session/cancel', { sessionId })
    } catch (_) {}
    void client.close()
  }
  if (options.signal) options.signal.addEventListener('abort', onAbort, { once: true })
  try {
    await client.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { _meta: { terminal_output: true } },
    })
    const created = await client.request('session/new', {
      cwd: path.resolve(options.workspace),
      mcpServers: [],
    })
    sessionId = String(created && created.sessionId || '')
    if (!sessionId) throw new Error('Harness ACP 未返回 sessionId')
    projector.setSessionId(sessionId)
    if (options.onSession) options.onSession(sessionId)
    poll = setInterval(() => projector.flush(), 350)
    const result = await client.request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: String(options.prompt || '') }],
    }, options.timeoutMs || DEFAULT_TIMEOUT_MS)
    if (poll) clearInterval(poll)
    poll = null
    await client.close()
    projector.flush()
    const summary = projector.summary()
    return {
      text: finalText.trim() || '（Harness 未返回文本总结，请查看工具轨迹）',
      sessionId,
      stopReason: String(result && result.stopReason || ''),
      usage: summary.usage,
      toolCalls: summary.toolCalls,
      logFile: summary.logFile,
    }
  } finally {
    if (poll) clearInterval(poll)
    if (options.signal) options.signal.removeEventListener('abort', onAbort)
    await client.close()
    projector.flush()
  }
}

module.exports = {
  AcpHarnessClient,
  bounded,
  parseArguments,
  redactSensitive,
  runAcpTask,
  summarizeToolCall,
}
