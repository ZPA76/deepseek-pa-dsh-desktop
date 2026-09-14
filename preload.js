'use strict'

const { contextBridge, ipcRenderer } = require('electron')

// 仅暴露只读版本信息 + 系统通知触发；不给页面任何其他特权能力。
// 页面能力全部来自 DSH 自身的插件体系。
contextBridge.exposeInMainWorld('harnessDesktop', {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  // dsh 页面可调用：任务完成时弹系统通知
  notify: (title, body) => {
    try { ipcRenderer.send('dpa:notify', { title: String(title || ''), body: String(body || '') }) } catch (_) {}
  },
  server: {
    authenticatedUrl: () => ipcRenderer.invoke('dsh:authenticated-url'),
    onAuthenticatedUrl: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const listener = (_event, url) => callback(String(url || ''))
      ipcRenderer.on('dsh:authenticated-url', listener)
      return () => ipcRenderer.removeListener('dsh:authenticated-url', listener)
    },
  },
  update: {
    status: () => ipcRenderer.invoke('dsh:update-status'),
    check: () => ipcRenderer.invoke('dsh:update-check'),
    install: (release) => ipcRenderer.invoke('dsh:update-install', release || {}),
    onState: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('dsh:update-state', listener)
      return () => ipcRenderer.removeListener('dsh:update-state', listener)
    },
  },
  capability: {
    request: (method, payload) => ipcRenderer.invoke('capability:request', { method: String(method || ''), payload: payload || {} }),
  },
  // 集群模块 API
  cluster: {
    request: (method, payload) => ipcRenderer.invoke('cluster:request', {
      method: String(method || ''),
      payload: payload || {},
    }),
    // 订阅项目事件；返回取消订阅函数，避免页面重载后重复监听。
    onEvent: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const listener = (_event, message) => callback(message)
      ipcRenderer.on('cluster:event', listener)
      return () => ipcRenderer.removeListener('cluster:event', listener)
    },
  },
})
