'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCapabilityRegistry } = require('../capability-registry.js')

function blob(text) { return { encoding:'base64', content:Buffer.from(text).toString('base64') } }

test('GitHub Skill 先预检目录，再受管下载、安装和可恢复卸载', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpa-remote-skill-'))
  const manifest = `---\nname: code-review\ndescription: Review code safely\nauthor: community\nversion: 1.2.0\n---\n# Code Review\n`
  const requester = async (pathname) => {
    if (pathname === '/repos/acme/skills') return { default_branch:'main' }
    if (pathname.includes('/git/trees/')) return { truncated:false, tree:[
      { type:'blob', path:'code-review/SKILL.md', sha:'manifest', size:Buffer.byteLength(manifest) },
      { type:'blob', path:'code-review/references/rules.md', sha:'rules', size:12 },
    ] }
    if (pathname.endsWith('/manifest')) return blob(manifest)
    if (pathname.endsWith('/rules')) return blob('# Rules\nSafe')
    throw new Error(`unexpected GitHub request: ${pathname}`)
  }
  const registry = createCapabilityRegistry({
    dataDir:path.join(root, 'data'), dshHome:path.join(root, 'dsh-home'), harnessDir:path.join(root, 'harness'), githubRequester:requester,
  })
  const check = await registry.preflightRemoteSkill({ repo:'acme/skills' })
  assert.equal(check.candidates[0].path, 'code-review/SKILL.md')
  const result = await registry.installRemoteSkill({ repo:'acme/skills', ref:'main', path:'code-review/SKILL.md', confirmed:true })
  assert.equal(result.installed.name, 'code-review')
  assert.equal(result.fileCount, 3)
  const installed = path.join(root, 'dsh-home', 'skills', 'dpa-market', 'code-review')
  assert.equal(fs.existsSync(path.join(installed, 'SKILL.md')), true)
  assert.equal(fs.existsSync(path.join(installed, 'references', 'rules.md')), true)
  assert.equal(JSON.parse(fs.readFileSync(path.join(installed, '.dpa-source.json'), 'utf8')).repo, 'acme/skills')
  assert.equal(registry.listSkills().some((item) => item.id === 'code-review' && item.installed), true)
  const removed = registry.uninstallSkill('code-review')
  assert.equal(removed.recoverable, true)
  assert.equal(fs.existsSync(installed), false)
  assert.equal(fs.existsSync(removed.trash), true)
})

test('远程 Skill 拒绝路径穿越式仓库名', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpa-remote-skill-safe-'))
  const registry = createCapabilityRegistry({ dataDir:path.join(root, 'data'), dshHome:path.join(root, 'dsh-home'), harnessDir:path.join(root, 'harness'), githubRequester:async () => ({}) })
  await assert.rejects(registry.preflightRemoteSkill({ repo:'../evil' }), /仓库格式不正确/)
})
