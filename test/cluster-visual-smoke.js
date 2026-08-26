'use strict'

const { app, BrowserWindow } = require('electron')
const os = require('os')
const path = require('path')
const { BUILTIN_THEMES, DEFAULT_TYPOGRAPHY, typographyCss } = require('../appearance-service.js')

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#111214',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  await window.loadFile(path.join(__dirname, '..', 'cluster.html'))
  const timestamp = new Date().toISOString()
  const sample = {
    agents: [
      { id: 'lead', name: '项目负责人', description: '统筹方案与验收' },
      { id: 'researcher', name: '研究分析师', description: '证据检索与分析' },
      { id: 'engineer', name: '软件工程师', description: '实现与验证' },
    ],
    project: {
      id: 'visual-sample', name: 'DPA 集群模块升级', goal: '建立可观察的多智能体项目空间',
      mode: 'team', status: 'active', phase: 'planning',
      members: [
        { agent: 'lead', role: '项目负责人', rank: 1 },
        { agent: 'researcher', role: '研究分析师', rank: 2 },
        { agent: 'engineer', role: '软件工程师', rank: 2 },
      ],
    },
    overview: {
      tasks: [
        { id: 'task-01', title: '梳理项目流程', assigneeRole: '研究分析师', description: '形成证据和风险清单', status: 'done' },
        { id: 'task-02', title: '实现项目房间', assigneeRole: '软件工程师', description: '完成事件流、审批与界面', status: 'doing' },
      ],
      approvals: [{ id: 'plan-v1', kind: 'plan', status: 'pending', subject: '审批第 1 版项目计划', contextText: '1. 完成员工配置\n2. 建立项目事件流\n3. 接入任务、交付与审批' }],
      artifacts: [], decisions: [],
    },
    events: [
      { id: '1', seq: 1, type: 'user.message', timestamp, actor: { id: 'user', name: '你', kind: 'user' }, text: '请把集群做成一个真正能开会、分工、执行和验收的 AI 公司。' },
      { id: '2', seq: 2, type: 'phase.changed', timestamp, actor: { id: 'system', name: 'DPA', kind: 'system' }, text: 'discussion' },
      { id: '3', seq: 3, type: 'agent.message.completed', timestamp, actor: { id: 'researcher', name: '研究分析师', role: '研究分析师', kind: 'employee' }, text: '建议以项目事件流作为唯一事实来源。聊天、任务、决策和遥测只是不同视图，这样返工与恢复都不会丢失上下文。', metrics: { totalTokens: 428, cacheHitPercent: 62.5 } },
      { id: '4', seq: 4, type: 'agent.message.completed', timestamp, actor: { id: 'engineer', name: '软件工程师', role: '软件工程师', kind: 'employee' }, text: '我负责持久化、运行控制和项目房间 UI。每次审批与交付都建立版本号，并保留旧版本。', metrics: { totalTokens: 366, cacheHitPercent: 51.2 } },
      { id: '5', seq: 5, type: 'agent.activity', timestamp, actor: { id: 'lead', name: '项目负责人', role: '项目负责人', kind: 'employee' }, text: '正在整理项目计划' },
      { id: '6', seq: 6, type: 'approval.requested', timestamp, actor: { id: 'system', name: 'DPA', kind: 'system' }, text: '审批第 1 版项目计划' },
      { id: '7', seq: 7, type: 'telemetry.usage', timestamp, actor: { id: 'researcher', name: '研究分析师', kind: 'employee' }, text: 'usage', metrics: { inputTokens: 340, outputTokens: 88, cacheReadTokens: 212, totalTokens: 428 } },
    ],
  }
  await window.webContents.executeJavaScript(`
    state.agents = ${JSON.stringify(sample.agents)};
    state.projects = [${JSON.stringify(sample.project)}];
    state.current = ${JSON.stringify(sample.project)};
    state.overview = { project: state.current, ...${JSON.stringify(sample.overview)} };
    state.events = ${JSON.stringify(sample.events)};
    state.runState = { running: true, paused: false, runId: 'visual-run' };
    renderProjects(); renderRoom(); showProjectPane('project-room');
  `)
  const requestedTheme = String(process.env.DPA_VISUAL_THEME || '')
  if (requestedTheme) {
    const theme = BUILTIN_THEMES.find((item) => item.id === requestedTheme)
    if (!theme) throw new Error('未知视觉测试主题：' + requestedTheme)
    const appearance = { theme, typography:typographyCss(DEFAULT_TYPOGRAPHY) }
    await window.webContents.executeJavaScript('applyClusterAppearance(' + JSON.stringify(appearance) + ')')
  }
  await new Promise((resolve) => setTimeout(resolve, 300))
  const image = await window.webContents.capturePage()
  const output = process.env.DPA_VISUAL_OUTPUT || path.join(os.tmpdir(), 'dpa-cluster-room.png')
  require('fs').writeFileSync(output, image.toPNG())
  await window.webContents.executeJavaScript('setView("employees"); renderEmployees();')
  window.showInactive()
  await new Promise((resolve) => setTimeout(resolve, 250))
  const employeeImage = await window.webContents.capturePage()
  const employeeOutput = path.join(path.dirname(output), `${path.basename(output, path.extname(output))}-employees${path.extname(output)}`)
  require('fs').writeFileSync(employeeOutput, employeeImage.toPNG())
  await window.webContents.executeJavaScript('setView("projects"); openWizard();')
  await new Promise((resolve) => setTimeout(resolve, 180))
  const wizardImage = await window.webContents.capturePage()
  const wizardOutput = path.join(path.dirname(output), `${path.basename(output, path.extname(output))}-wizard${path.extname(output)}`)
  require('fs').writeFileSync(wizardOutput, wizardImage.toPNG())
  console.log(output)
  console.log(employeeOutput)
  console.log(wizardOutput)
  app.quit()
})
