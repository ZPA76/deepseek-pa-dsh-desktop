'use strict'

function parseAuthenticatedDshUrl(output, expectedUrl) {
  const base = new URL(expectedUrl)
  const matches = String(output || '').matchAll(/dsh web:\s+(https?:\/\/[^\s()]+)/gi)
  let authenticated = null
  for (const match of matches) {
    try {
      const candidate = new URL(match[1])
      const tokens = candidate.searchParams.getAll('token')
      if (candidate.origin !== base.origin || candidate.pathname !== '/' || candidate.username || candidate.password) continue
      if (tokens.length !== 1 || tokens[0].length < 16 || tokens[0].length > 2048) continue
      authenticated = candidate.toString()
    } catch (_) {}
  }
  return authenticated
}

function redactDshTokens(value) {
  return String(value || '').replace(/([?&]token=)[^&\s)"']+/gi, '$1[redacted]')
}

module.exports = {
  parseAuthenticatedDshUrl,
  redactDshTokens,
}