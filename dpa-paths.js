'use strict'

const os = require('node:os')
const path = require('node:path')

// Shared defaults for Electron and standalone modules. Resolution never creates,
// migrates or removes a directory; explicit caller settings and environment win.
function resolveDpaPaths(options = {}) {
  const env = options.env || process.env
  const platform = options.platform || process.platform
  const home = options.userHome || os.homedir()
  const appData = env.LOCALAPPDATA || options.appDataDir || env.APPDATA ||
    (platform === 'win32' ? path.join(home, 'AppData', 'Roaming') : env.XDG_CONFIG_HOME || path.join(home, '.config'))
  const userRoot = path.resolve(appData, 'DeepSeek-PA')
  return {
    userRoot,
    dshHome: path.resolve(options.homeDir || options.dshHome || env.DSH_DESKTOP_DSH_HOME || env.DSH_HOME || path.join(userRoot, 'dsh-home')),
    dataDir: path.resolve(options.dataDir || env.DSH_DESKTOP_DATA_DIR || path.join(userRoot, 'data')),
    harnessDir: path.resolve(options.harnessDir || env.DSH_DESKTOP_HARNESS_DIR || path.join(userRoot, 'runtime', 'harness')),
  }
}

module.exports = { resolveDpaPaths }
