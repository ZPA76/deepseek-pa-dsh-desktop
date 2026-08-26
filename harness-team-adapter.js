'use strict'

const fs = require('fs')
const path = require('path')

function detectHarnessTeam(harnessDir) {
  const root = path.resolve(harnessDir || '')
  const packageDir = path.join(root, 'packages', 'experimental', 'agent-team')
  const toolDir = path.join(root, 'packages', 'experimental', 'tool-agent-team')
  return {
    supported: fs.existsSync(packageDir) && fs.existsSync(toolDir),
    packageDir,
    toolDir,
    experimental: true,
    limitations: [
      'Harness Agent Team 当前没有 DPA 项目会议和审批界面',
      '成员共享工作目录，写入范围目前是协调提示而不是强制文件锁',
      '成员结构扁平，实验性接口可能随 Harness 更新变化',
    ],
  }
}

function selectClusterRuntime(harnessDir, requested) {
  const upstream = detectHarnessTeam(harnessDir)
  const wanted = String(requested || process.env.DPA_CLUSTER_RUNTIME || 'dpa')
  if (wanted === 'harness-team' && upstream.supported) {
    return { id: 'harness-team', label: 'Harness Agent Team（实验性）', upstream, fallback: 'dpa' }
  }
  return {
    id: 'dpa',
    label: 'DPA 集群执行器',
    upstream,
    fallback: upstream.supported ? '可切换到 harness-team' : '当前运行时未提供 Agent Team',
  }
}

module.exports = { detectHarnessTeam, selectClusterRuntime }
