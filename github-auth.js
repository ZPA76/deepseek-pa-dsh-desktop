'use strict'

const fs = require('fs')
const path = require('path')
const https = require('https')

function requestJson(options, body) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      method: options.method || 'GET',
      hostname: options.hostname || 'github.com',
      path: options.path,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'DeepSeek-PA',
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } : {}),
        ...(options.headers || {}),
      },
      timeout: 20000,
    }, (response) => {
      let text = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { text += chunk })
      response.on('end', () => {
        let value
        try { value = JSON.parse(text || '{}') } catch (_) { value = { message: text } }
        if ((response.statusCode || 500) >= 400) return reject(new Error(value.message || `GitHub 请求失败（${response.statusCode}）`))
        resolve(value)
      })
    })
    request.on('timeout', () => request.destroy(new Error('GitHub 请求超时')))
    request.on('error', reject)
    if (body) request.write(body)
    request.end()
  })
}

function createGitHubAuth(options = {}) {
  const dataDir = path.resolve(options.dataDir)
  const tokenFile = path.join(dataDir, 'secrets', 'github-token.bin')
  const safeStorage = options.safeStorage
  const clientId = String(options.clientId || process.env.DPA_GITHUB_CLIENT_ID || '').trim()
  let cachedToken = null

  async function readToken() {
    if (cachedToken) return cachedToken
    if (!fs.existsSync(tokenFile) || !safeStorage || !safeStorage.isEncryptionAvailable()) return ''
    try {
      const encrypted = fs.readFileSync(tokenFile)
      cachedToken = safeStorage.decryptString(encrypted)
      return cachedToken
    } catch (_) { return '' }
  }

  async function writeToken(token) {
    if (!safeStorage || !safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法使用安全凭据存储，DPA 不会以明文保存 GitHub 令牌')
    fs.mkdirSync(path.dirname(tokenFile), { recursive: true })
    const encrypted = safeStorage.encryptString(String(token))
    const temporary = `${tokenFile}.tmp-${process.pid}`
    fs.writeFileSync(temporary, encrypted)
    fs.renameSync(temporary, tokenFile)
    cachedToken = String(token)
  }

  async function currentUser() {
    const token = await readToken()
    if (!token) return null
    try {
      return await requestJson({
        hostname: 'api.github.com',
        path: '/user',
        headers: { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
      })
    } catch (_) {
      cachedToken = null
      return null
    }
  }

  async function status() {
    const user = await currentUser()
    return {
      configured: Boolean(clientId),
      connected: Boolean(user),
      login: user && user.login || '',
      avatarUrl: user && user.avatar_url || '',
      mode: user ? 'github-oauth' : 'anonymous',
      message: user
        ? `已连接 GitHub：${user.login}`
        : (clientId ? '可使用 GitHub 设备授权登录' : '尚未配置 DPA_GITHUB_CLIENT_ID；公开市场仍可匿名浏览'),
    }
  }

  async function startDeviceFlow() {
    if (!clientId) throw new Error('DPA 尚未配置 GitHub OAuth Client ID；需先为 DPA 注册 GitHub App 并启用 Device Flow')
    const body = new URLSearchParams({ client_id: clientId, scope: 'read:user repo' }).toString()
    const result = await requestJson({ method: 'POST', path: '/login/device/code' }, body)
    return {
      deviceCode: result.device_code,
      userCode: result.user_code,
      verificationUri: result.verification_uri,
      expiresIn: result.expires_in,
      interval: result.interval,
    }
  }

  async function pollDeviceFlow(payload = {}) {
    if (!clientId) throw new Error('GitHub OAuth 尚未配置')
    const deviceCode = String(payload.deviceCode || '')
    if (!deviceCode) throw new Error('缺少 GitHub device_code')
    const body = new URLSearchParams({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }).toString()
    const result = await requestJson({ method: 'POST', path: '/login/oauth/access_token' }, body)
    if (result.error === 'authorization_pending' || result.error === 'slow_down') {
      return { pending: true, error: result.error, interval: result.interval }
    }
    if (result.error) throw new Error(result.error_description || result.error)
    if (!result.access_token) throw new Error('GitHub 没有返回访问令牌')
    await writeToken(result.access_token)
    return { pending: false, status: await status() }
  }

  function disconnect() {
    cachedToken = null
    if (fs.existsSync(tokenFile)) fs.rmSync(tokenFile, { force: true })
    return { ok: true }
  }

  return { status, startDeviceFlow, pollDeviceFlow, disconnect, token: readToken }
}

module.exports = { createGitHubAuth, requestJson }
