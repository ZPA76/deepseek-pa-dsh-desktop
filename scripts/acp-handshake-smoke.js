'use strict'

// Boot the actual managed ACP runtime with synthetic credentials; never send a model prompt.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const appRoot = process.env.DPA_SMOKE_APP_ROOT || path.resolve(__dirname, '..')
const { AcpHarnessClient, resolveAcpLaunch } = require(path.join(appRoot, 'cluster-acp-client'))
const launch = resolveAcpLaunch({ harnessDir: process.argv[2] })
const configPath = launch.args[launch.args.length - 1]
if (configPath.includes('.asar')) throw new Error('External ACP child cannot read an ASAR configuration')
if (process.env.DPA_SMOKE_APP_ROOT && path.dirname(configPath) !== process.resourcesPath) throw new Error('Packaged ACP configuration must resolve from resourcesPath')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dpa-acp-handshake-'))
const oldKey = process.env.DEEPSEEK_API_KEY
process.env.DEEPSEEK_API_KEY = 'synthetic-key-for-handshake-only'
const client = new AcpHarnessClient({
  harnessDir: process.argv[2], dshHome: directory, workspace: directory,
  sessionsRoot: path.join(directory, 'sessions'),
  provider: 'deepseek-official', model: 'deepseek-v4-flash',
})
;(async () => {
  try {
    const initialized = await client.request('initialize', { protocolVersion: 1, clientCapabilities: {} }, 60000)
    const created = await client.request('session/new', { cwd: directory, mcpServers: [] }, 60000)
    if (!created || !created.sessionId) throw new Error('ACP did not return a session id')
    console.log(JSON.stringify({ initialized: Boolean(initialized), sessionCreated: true, modelCalls: 0, isolatedHome: true, packaged: Boolean(process.env.DPA_SMOKE_APP_ROOT), externalConfig: true }))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  } finally {
    await client.close()
    if (oldKey === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = oldKey
    require('./cleanup-acp-smoke')(directory)
  }
})()
