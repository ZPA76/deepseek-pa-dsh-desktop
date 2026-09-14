'use strict'
// One explicitly invoked real API probe. Uses saved credentials, never prints them.
const { callLLMStream } = require('../cluster-runtime')
const { redactSensitive } = require('../cluster-acp-client')
;(async () => {
  try {
    const result = await callLLMStream({
      provider: 'deepseek', model: 'deepseek-v4-flash',
      homeDir: process.argv[2], system: '只回复 DPA_OK', user: '只回复 DPA_OK',
      temperature: 0, timeoutMs: 30000, maxTokens: 256,
    })
    console.log(JSON.stringify({ success: result.text.trim() === 'DPA_OK', responseReceived: Boolean(result.text), usage: result.usage, userContentSent: false }))
    if (result.text.trim() !== 'DPA_OK') process.exitCode = 1
  } catch (error) {
    console.error(redactSensitive(error.message))
    process.exitCode = 1
  }
})()
