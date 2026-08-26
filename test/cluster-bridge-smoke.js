'use strict'

const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { BUILTIN_THEMES, DEFAULT_TYPOGRAPHY, typographyCss } = require('../appearance-service.js')

const temporaryData = fs.mkdtempSync(path.join(os.tmpdir(), 'dpa-bridge-smoke-'))
app.setPath('userData', temporaryData)
app.disableHardwareAcceleration()

const project = {
  id: 'bridge-project', name: '桥接测试项目', goal: '验证本地 iframe 与主进程通信',
  mode: 'hierarchy', status: 'draft', phase: 'draft',
  members: [{ agent: 'tester', name: '测试员', role: '测试负责人', rank: 1 }],
}
const calls = []

const appearance = { themeId:'midnight', theme:BUILTIN_THEMES[0], themes:BUILTIN_THEMES, typography:typographyCss(DEFAULT_TYPOGRAPHY), background:{ enabled:false, dataUrl:'', fit:'cover', position:'center', opacity:.28, blur:0, overlay:.42 } }
ipcMain.handle('capability:request', (_event, request) => {
  if (request.method === 'themeState') return appearance
  if (request.method === 'state') return {
    capabilities:{ agentTeam:{ supported:true }, plugins:{ writable:true } }, appearance,
    skills:[], plugins:[], github:{ connected:false, configured:false }, backups:[],
  }
  if (request.method === 'searchExtensions') return []
  throw new Error(`能力烟测未实现：${request.method}`)
})
ipcMain.handle('dsh:update-status', () => ({ status:'current', currentVersion:'smoke' }))

ipcMain.handle('cluster:request', (_event, request) => {
  calls.push(request.method)
  if (request.method === 'listAgents') return [{ id: 'tester', name: '测试员', description: '验证桥接', source: 'dpa' }]
  if (request.method === 'listSkills') return { skills: [{ name: 'code-review', description: '审查代码', source: '测试' }], roots: [] }
  if (request.method === 'listProjects') return [project]
  if (request.method === 'getProjectOverview') return { project, tasks: [], approvals: [], artifacts: [], decisions: [], lastEventSeq: 0 }
  if (request.method === 'listEvents') return []
  if (request.method === 'getRunState') return { running: false }
  throw new Error(`冒烟测试未实现：${request.method}`)
})

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1200,
    height: 760,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  })
  await window.loadFile(path.join(__dirname, '..', 'shell.html'))
  await window.webContents.executeJavaScript(`
    switchTo('cluster');
    new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        const frame = document.getElementById('cluster');
        const doc = frame && frame.contentDocument;
        if (doc && doc.getElementById('room-name') && doc.getElementById('room-name').textContent === '桥接测试项目') return resolve(true);
        if (Date.now() - started > 7000) return reject(new Error('cluster iframe 初始化超时'));
        setTimeout(check, 80);
      };
      check();
    });
  `)
  const result = await window.webContents.executeJavaScript(`(() => {
    const frame = document.getElementById('cluster');
    const doc = frame.contentDocument;
    const resizer = doc.getElementById('project-sidebar-resizer');
    const before = frame.contentWindow.getComputedStyle(doc.documentElement).getPropertyValue('--project-sidebar-width').trim();
    resizer.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const after = frame.contentWindow.getComputedStyle(doc.documentElement).getPropertyValue('--project-sidebar-width').trim();
    const layoutSaved = Boolean(frame.contentWindow.localStorage.getItem('dpa.cluster.layout.v1'));
    const menuTrigger = doc.querySelector('.project-menu-trigger');
    menuTrigger.click();
    const contextMenu = doc.getElementById('project-context-menu');
    return {
      roomName: doc.getElementById('room-name').textContent,
      employeeCards: doc.querySelectorAll('.employee-card').length,
      projectItems: doc.querySelectorAll('.project-item').length,
      projectVisible: !doc.getElementById('project-room').classList.contains('hidden'),
      resizers: doc.querySelectorAll('[role=separator].column-resizer').length,
      sidebarBefore: before,
      sidebarAfter: after,
      layoutSaved,
      importanceBadge: doc.querySelector('.project-importance').getAttribute('aria-label'),
      contextMenuItems: contextMenu.querySelectorAll('[role=menuitem],[role=menuitemradio]').length,
      deleteAction: Array.from(contextMenu.querySelectorAll('button')).some((button) => button.textContent.includes('移入回收站')),
    };
  })()`)
  await window.webContents.executeJavaScript(`
    switchTo('capabilities');
    new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        const frame = document.getElementById('capabilities');
        const doc = frame && frame.contentDocument;
        if (doc && doc.getElementById('background-preview') && doc.querySelectorAll('.theme-card').length) return resolve(true);
        if (Date.now() - started > 7000) return reject(new Error('capabilities iframe 初始化超时'));
        setTimeout(check, 80);
      };
      check();
    });
  `)
  result.capabilities = await window.webContents.executeJavaScript(`(() => {
    const doc = document.getElementById('capabilities').contentDocument;
    return {
      themeCards: doc.querySelectorAll('.theme-card').length,
      backgroundControls: Boolean(doc.getElementById('choose-background') && doc.getElementById('save-background')),
      themeFileImport: Boolean(doc.getElementById('import-theme-file')),
      githubControl: Boolean(doc.getElementById('github-account')),
    };
  })()`)
  result.methods = [...new Set(calls)]
  console.log(JSON.stringify(result))
  window.destroy()
  app.quit()
}).catch((error) => {
  console.error(error.stack || error)
  app.exit(1)
})

app.on('quit', () => {
  try { fs.rmSync(temporaryData, { recursive: true, force: true }) } catch (_) {}
})
