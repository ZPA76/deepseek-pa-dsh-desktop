'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { runAcpTask } = require('../cluster-acp-client')
const { resolveSmokePaths } = require('./acp-smoke-options')
const cleanupAcpSmoke = require('./cleanup-acp-smoke')

async function main() {
  const { harnessDir, dshHome } = resolveSmokePaths()
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dpa-acp-skill-'))
  const workspace = path.join(temporary, 'workspace')
  const sessionsRoot = path.join(temporary, 'sessions')
  const skillDirectory = path.join(workspace, '.dsh', 'skills', 'dpa-smoke')
  fs.mkdirSync(skillDirectory, { recursive: true })
  fs.writeFileSync(path.join(skillDirectory, 'SKILL.md'), [
    '---',
    'name: dpa-smoke',
    'description: DPA Skill 链路烟测；被明确要求时加载并返回固定验证标记。',
    '---',
    '',
    '# DPA Skill smoke',
    '',
    '加载本 Skill 后，在最终答复中包含精确标记 DPA_SKILL_OK。不要输出隐藏思维过程。',
  ].join('\n'), 'utf8')

  const tools = []
  try {
    const result = await runAcpTask({
      harnessDir,
      dshHome,
      workspace,
      sessionsRoot,
      configPath: path.join(__dirname, '..', 'dpa.cordis.yml'),
      provider: 'deepseek-official',
      model: process.env.DPA_SMOKE_MODEL || 'deepseek-v4-flash',
      persona: '你是 DPA Skill 能力验证员工。只报告可核查结果，不输出隐藏思维过程。',
      prompt: '请先调用 skill 工具加载 dpa-smoke，然后严格按照该 Skill 完成烟测。',
      skillMode: 'all',
      onPermission: async () => 'reject',
      onEvent(event) {
        if (event.type === 'tool.call') tools.push(event.meta && event.meta.tool)
      },
    })
    console.log(JSON.stringify({
      marker: result.text.includes('DPA_SKILL_OK'),
      skillCalled: tools.includes('skill'),
      tools,
      sessionId: result.sessionId,
      stopReason: result.stopReason,
    }))
    if (!result.text.includes('DPA_SKILL_OK') || !tools.includes('skill')) process.exitCode = 1
  } finally {
    cleanupAcpSmoke(temporary)
  }
}

main().catch((error) => {
  console.error(error && error.stack || error)
  process.exit(1)
})

