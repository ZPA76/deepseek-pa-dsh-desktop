'use strict'
// One opt-in synthetic ACP prompt. Temporary workspace, no user content and no tool grants.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const appRoot = process.env.DPA_SMOKE_APP_ROOT || path.resolve(__dirname, '..')
const { loadCredentialEnv, runAcpTask, redactSensitive } = require(path.join(appRoot, 'cluster-acp-client'))
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dpa-acp-model-'))
const oldKey = process.env.DEEPSEEK_API_KEY
;(async () => {
  try {
    process.env.DEEPSEEK_API_KEY = loadCredentialEnv(process.argv[3]).DEEPSEEK_API_KEY || oldKey || ''
    const result = await runAcpTask({ harnessDir: process.argv[2], dshHome: directory, workspace: directory,
      sessionsRoot: path.join(directory, 'sessions'), provider: 'deepseek-official', model: 'deepseek-v4-flash',
      prompt: '只回复 ACP_OK，不调用工具', persona: '只回复 ACP_OK，不调用工具', timeoutMs: 60000,
      onPermission: () => 'reject',
    })
    const success = result.text.trim() === 'ACP_OK'
    console.log(JSON.stringify({ success, sessionCreated: Boolean(result.sessionId), stopReason: result.stopReason, usage: result.usage, toolCalls: result.toolCalls, userContentSent: false, packaged: Boolean(process.env.DPA_SMOKE_APP_ROOT) }))
    if (!success) process.exitCode = 1
  } catch (error) { console.error(redactSensitive(error.message)); process.exitCode = 1 }
  finally {
    if (oldKey === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = oldKey
    require('./cleanup-acp-smoke')(directory)
  }
})()
