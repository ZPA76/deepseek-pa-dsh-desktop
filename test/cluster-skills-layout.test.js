'use strict'

const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')

const { ClusterStore, listSkills } = require('../cluster-runtime')
const { summarizeToolCall } = require('../cluster-acp-client')

function writeSkill(root, directory, name, description) {
  const target = path.join(root, directory)
  fs.mkdirSync(target, { recursive: true })
  fs.writeFileSync(path.join(target, 'SKILL.md'), [
    '---',
    'name: ' + name,
    'description: ' + description,
    '---',
    '',
    '# ' + name,
    '',
    '执行并验证该任务。',
  ].join('\n'), 'utf8')
}

test('Skill 目录按项目优先级发现，员工策略会规范化保存', (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dpa-skills-'))
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))
  const dshHome = path.join(temporary, 'dsh-home')
  const workspace = path.join(temporary, 'workspace')
  const previousAgentsHome = process.env.DSH_AGENTS_HOME
  process.env.DSH_AGENTS_HOME = path.join(temporary, 'shared-agents')
  t.after(() => {
    if (previousAgentsHome == null) delete process.env.DSH_AGENTS_HOME
    else process.env.DSH_AGENTS_HOME = previousAgentsHome
  })
  const store = new ClusterStore({ homeDir: dshHome })

  writeSkill(path.join(dshHome, 'skills'), 'review', 'code-review', '用户级代码审查')
  const globalCatalog = listSkills({}, store)
  assert.equal(globalCatalog.skills.length, 1)
  assert.equal(globalCatalog.skills[0].source, 'DPA 用户')

  store.saveProject({ id: 'skill-project', name: 'Skill 项目', goal: '验证目录', workspace, members: [] })
  writeSkill(path.join(workspace, '.dsh', 'skills'), 'review', 'code-review', '项目级代码审查')
  writeSkill(path.join(workspace, '.agents', 'skills'), 'research', 'github-research', '项目调研')
  const projectCatalog = listSkills({ projectId: 'skill-project' }, store)
  assert.equal(projectCatalog.skills.find((item) => item.name === 'code-review').source, '项目 DSH')
  assert.ok(projectCatalog.skills.some((item) => item.name === 'github-research'))

  const employee = store.saveEmployee({
    id: 'skill-worker',
    name: 'Skill 员工',
    skillAccess: { mode: 'selected', names: ['code-review', '无效名称', 'code-review'] },
  })
  assert.deepEqual(employee.skillAccess, { mode: 'selected', names: ['code-review'] })
  assert.equal(summarizeToolCall('skill', { name: 'code-review' }), '加载 Skill：code-review')
})

test('项目空间包含三条可访问分隔条、宽度记忆与响应式网格', () => {
  const root = path.join(__dirname, '..')
  const html = fs.readFileSync(path.join(root, 'cluster.html'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'cluster-ui.css'), 'utf8')
  const script = fs.readFileSync(path.join(root, 'cluster-ui.js'), 'utf8')
  const config = fs.readFileSync(path.join(root, 'dpa.cordis.yml'), 'utf8')

  for (const id of ['project-sidebar-resizer', 'roster-resizer', 'inspector-resizer']) {
    assert.match(html, new RegExp('id="' + id + '"[^>]+role="separator"'))
  }
  assert.match(css, /grid-template-columns:\s*var\(--project-sidebar-width\)\s+var\(--resizer-size\)/)
  assert.match(css, /var\(--roster-width\).*var\(--inspector-width\)/)
  assert.match(script, /dpa\.cluster\.layout\.v1/)
  assert.match(script, /addEventListener\('pointerdown'/)
  assert.match(script, /addEventListener\('dblclick'/)
  assert.match(script, /localStorage\.setItem/)
  assert.match(html, /id="project-trash-empty"/)
  assert.match(script, /addEventListener\('contextmenu'/)
  assert.match(script, /setProjectImportance/)
  assert.match(script, /deleteProjectForever/)
  assert.match(script, /emptyProjectTrash/)
  assert.match(css, /\.project-importance\.level-5/)
  assert.match(css, /\.project-context-menu/)

  assert.match(script, /capability:appearance/)
  assert.match(script, /capability:zoom-step/)
  assert.match(css, /\.project-sidebar[^}]+var\(--surface-panel\)/)
  assert.match(css, /\.roster[^}]+var\(--surface-panel\)/)
  assert.match(css, /\.conversation[^}]+var\(--surface-canvas\)/)
  assert.doesNotMatch(css, /background:\s*#(?:121315|141518|151619|16171a|17181b)/i)

  const normalizedConfig = config.replace(/\r\n/g, '\n')
  const fsTool = normalizedConfig.indexOf('\n- id: tool-fs\n')
  const skillService = normalizedConfig.indexOf('\n- id: skill\n')
  assert.ok(fsTool > 0 && skillService > fsTool)
  assert.match(normalizedConfig, /- id: skill-filesystem[\s\S]*DPA_SKILL_MODE === 'none'/)
  assert.match(normalizedConfig, /- id: tool-skill[\s\S]*DPA_SKILL_MODE === 'none'/)
})

