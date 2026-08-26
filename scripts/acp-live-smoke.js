'use strict'

const fs = require('fs')
const path = require('path')
const { runAcpTask } = require('../cluster-acp-client')

async function main() {
  const root = path.resolve(process.env.DPA_ACP_SMOKE_ROOT || path.join(process.cwd(), '.tmp-acp-smoke'))
  const workspace = path.join(root, 'workspace')
  const sessionsRoot = path.join(root, 'sessions')
  fs.mkdirSync(workspace, { recursive: true })
  const events = []
  const toolMode = process.env.DPA_ACP_SMOKE_TOOL === '1'
  const result = await runAcpTask({
    harnessDir: process.env.DSH_DESKTOP_HARNESS_DIR || path.join(process.env.DSH_HOME || process.cwd(), 'harness'),
    dshHome: process.env.DSH_HOME || path.join(process.env.LOCALAPPDATA || process.env.HOME || process.cwd(), 'DeepSeek-PA', 'dsh-home'),
    configPath: path.resolve(__dirname, '..', 'dpa.cordis.yml'),
    workspace,
    sessionsRoot,
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    persona: toolMode ? 'You are a DPA integration tester. Work only in the given workspace.' : 'You are a DPA integration tester. Do not call tools.',
    prompt: toolMode ? '请在当前工作区创建 dpa-acp-tool-ok.txt，内容为 TOOL_OK；读取验证后只回复：DPA_TOOL_OK' : '不要调用任何工具。只回复：DPA_ACP_OK',
    timeoutMs: 120000,
    onPermission: () => toolMode ? 'allow' : 'reject',
    onEvent: (event) => events.push(event.type),
  })
  console.log(JSON.stringify({
    text: result.text,
    sessionId: result.sessionId,
    stopReason: result.stopReason,
    usage: result.usage,
    toolCalls: result.toolCalls,
    logFile: result.logFile,
    projectedEvents: events,
  }))
}

main().catch((error) => {
  console.error(error.stack || error)
  process.exit(1)
})

