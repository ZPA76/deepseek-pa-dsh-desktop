'use strict'

const fs = require('node:fs')
const path = require('node:path')

// A live smoke must opt in to an existing runtime and credential home explicitly.
// Never silently probe the developer's private installation or create missing homes.
function resolveSmokePaths({ argv = process.argv.slice(2), env = process.env } = {}) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const match = /^(--harness-dir|--dsh-home)(?:=(.*))?$/.exec(argv[index])
    if (!match) throw new Error(`Unknown smoke option: ${argv[index]}. Use --harness-dir and --dsh-home.`)
    const value = match[2] === undefined ? argv[++index] : match[2]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${match[1]}`)
    options[match[1]] = value
  }
  const harnessValue = options['--harness-dir'] || env.DSH_DESKTOP_HARNESS_DIR
  const homeValue = options['--dsh-home'] || env.DSH_DESKTOP_DSH_HOME || env.DSH_HOME
  if (!harnessValue) throw new Error('Live ACP smoke requires --harness-dir or DSH_DESKTOP_HARNESS_DIR; no model request was sent.')
  if (!homeValue) throw new Error('Live ACP smoke requires --dsh-home, DSH_DESKTOP_DSH_HOME or DSH_HOME; no model request was sent.')
  const harnessDir = path.resolve(harnessValue)
  const dshHome = path.resolve(homeValue)
  let runtimePackage
  try { runtimePackage = JSON.parse(fs.readFileSync(path.join(harnessDir, 'package.json'), 'utf8')) } catch (_) {}
  if (!runtimePackage || runtimePackage.name !== '@deepseek-ai/dsh-root') {
    throw new Error('The specified harness directory is not a DeepSeek Harness runtime (package.json must identify @deepseek-ai/dsh-root).')
  }
  try {
    if (!fs.statSync(dshHome).isDirectory()) throw new Error('not a directory')
  } catch (_) {
    throw new Error('The specified DSH home directory does not exist. Configure an isolated test home before running a live smoke.')
  }
  return { harnessDir, dshHome }
}

module.exports = { resolveSmokePaths }
