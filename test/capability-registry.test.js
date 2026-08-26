'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCapabilityRegistry } = require('../capability-registry.js')

test('能力注册表支持主题持久化、Skill 发现和受管安装', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpa-capability-'))
  try {
    const source = path.join(root, 'source', '.dsh', 'skills', 'demo-skill')
    fs.mkdirSync(source, { recursive: true })
    fs.writeFileSync(path.join(source, 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo workflow\n---\nDo the demo.', 'utf8')
    const registry = createCapabilityRegistry({ dataDir: path.join(root, 'data'), dshHome: path.join(root, 'home'), harnessDir: root })
    const discovered = registry.listSkills({ projectRoot: path.join(root, 'source') })
    assert.equal(discovered.some((item) => item.id === 'demo-skill'), true)
    registry.setTheme('ocean')
    assert.equal(registry.themeState().themeId, 'ocean')
    const installed = registry.installSkill({ id: 'demo-skill', sourcePath: source })
    assert.equal(installed.installed, true)
    assert.equal(fs.existsSync(path.join(root, 'home', 'skills', 'dpa-market', 'demo-skill', 'SKILL.md')), true)
    registry.uninstallSkill('demo-skill')
    assert.equal(fs.existsSync(path.join(root, 'home', 'skills', 'dpa-market', 'demo-skill')), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
