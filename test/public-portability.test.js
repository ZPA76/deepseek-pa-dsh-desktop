'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { spawnSync } = require('node:child_process')
const { resolveSmokePaths } = require('../scripts/acp-smoke-options')
const { resolveDpaPaths } = require('../dpa-paths')

const appRoot = path.resolve(__dirname, '..')
const mainSource = fs.readFileSync(path.join(appRoot, 'main.js'), 'utf8')
const bootstrap = mainSource.slice(mainSource.indexOf('const SERVER_URL ='), mainSource.indexOf('const DIAGNOSTIC_LOG_MAX_BYTES ='))
const fixtureBase = path.resolve(os.tmpdir(), 'dpa-portability-virtual')
const fixtureSource = path.join(fixtureBase, 'source checkout')
const fixtureExe = path.join(fixtureBase, 'installed app', 'DeepSeek-PA.exe')
const fixtureAppData = path.join(fixtureBase, 'local app data')

function resolveBootstrap(env = {}, runtimes = {}) {
  const reads = []
  let homeAtImport
  const sandbox = {
    path, __dirname: fixtureSource, clusterEngine: null, console,
    process: { env: { ...env }, execPath: fixtureExe },
    app: { getPath(name) { assert.equal(name, 'appData'); return fixtureAppData } },
    fs: { readFileSync(file) {
      reads.push(file)
      const runtime = runtimes[path.dirname(file)]
      if (runtime === undefined) throw new Error('fixture runtime missing')
      return JSON.stringify({ name: runtime })
    } },
    require(name) {
      assert.equal(name, './cluster-engine.js')
      homeAtImport = sandbox.process.env.DSH_HOME
      return {}
    },
  }
  sandbox.resolveDpaPaths = options => resolveDpaPaths({ ...options, env: sandbox.process.env })
  const result = vm.runInNewContext(`${bootstrap}\n;({ HARNESS_DIR, DSH_HOME_DIR, DATA_DIR })`, sandbox)
  return { ...result, reads, homeAtImport }
}

test('public desktop defaults use user data outside the install tree and propagate home before engine import', () => {
  const result = resolveBootstrap({ LOCALAPPDATA: fixtureAppData })
  const userRoot = path.join(fixtureAppData, 'DeepSeek-PA')
  assert.equal(result.HARNESS_DIR, path.join(userRoot, 'runtime', 'harness'))
  assert.equal(result.DSH_HOME_DIR, path.join(userRoot, 'dsh-home'))
  assert.equal(result.DATA_DIR, path.join(userRoot, 'data'))
  assert.equal(result.homeAtImport, result.DSH_HOME_DIR)
  assert.equal(resolveBootstrap().DATA_DIR, result.DATA_DIR)
})

test('public runtime discovery checks executable, source, then user-managed runtime in order', () => {
  const candidates = [
    path.join(path.dirname(fixtureExe), 'runtime', 'harness'),
    path.join(fixtureSource, 'runtime', 'harness'),
    path.join(fixtureAppData, 'DeepSeek-PA', 'runtime', 'harness'),
  ]
  for (let first = 0; first < candidates.length; first += 1) {
    const runtimes = Object.fromEntries(candidates.slice(first).map(item => [item, '@deepseek-ai/dsh-root']))
    const result = resolveBootstrap({ LOCALAPPDATA: fixtureAppData }, runtimes)
    assert.equal(result.HARNESS_DIR, candidates[first])
    assert.equal(result.reads.length, first + 1)
  }
  const wrongPackage = resolveBootstrap({}, { [candidates[0]]: 'unrelated-package' })
  assert.equal(wrongPackage.HARNESS_DIR, candidates[2])
})

test('explicit runtime and data environment settings win without probing unrelated directories', () => {
  const runtime = path.join(fixtureBase, 'chosen runtime')
  const home = path.join(fixtureBase, 'chosen home')
  const data = path.join(fixtureBase, 'chosen data')
  const result = resolveBootstrap({ DSH_DESKTOP_HARNESS_DIR: runtime, DSH_DESKTOP_DSH_HOME: home, DSH_HOME: 'ignored-home', DSH_DESKTOP_DATA_DIR: data })
  assert.equal(result.HARNESS_DIR, runtime)
  assert.equal(result.DSH_HOME_DIR, home)
  assert.equal(result.DATA_DIR, data)
  assert.equal(result.reads.length, 0)
  assert.equal(resolveBootstrap({ DSH_HOME: home }).DSH_HOME_DIR, home)
})

test('shared standalone defaults and caller overrides match desktop paths without creating directories', () => {
  const env = { LOCALAPPDATA: fixtureAppData }
  const defaults = resolveDpaPaths({ env })
  const desktop = resolveBootstrap(env)
  assert.equal(defaults.dshHome, desktop.DSH_HOME_DIR)
  assert.equal(defaults.dataDir, desktop.DATA_DIR)
  assert.equal(defaults.harnessDir, desktop.HARNESS_DIR)
  const custom = { homeDir: path.join(fixtureBase, 'custom home'), dataDir: path.join(fixtureBase, 'custom data'), harnessDir: path.join(fixtureBase, 'custom runtime') }
  const resolved = resolveDpaPaths({ ...custom, env: { DSH_HOME: 'ignored', DSH_DESKTOP_HARNESS_DIR: 'ignored' } })
  assert.equal(resolved.dshHome, custom.homeDir)
  assert.equal(resolved.dataDir, custom.dataDir)
  assert.equal(resolved.harnessDir, custom.harnessDir)
})

test('standalone registry and cluster preflight use the explicit store runtime instead of private machine defaults', (t) => {
  const { ClusterStore, validateProjectStart } = require('../cluster-runtime')
  const { createCapabilityRegistry } = require('../capability-registry')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpa-public-paths-test-'))
  // Only synthetic directories/files are created here: no ACP launch, dependency links or real credentials.
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const homeDir = path.join(root, 'test home')
  const harnessDir = path.join(root, 'test runtime')
  const dataDir = path.join(root, 'data')
  const bin = path.join(harnessDir, 'apps', 'cli', 'lib', 'bin.js')
  fs.mkdirSync(path.dirname(bin), { recursive: true })
  fs.writeFileSync(bin, '')
  const store = new ClusterStore({ homeDir, harnessDir })
  const registry = createCapabilityRegistry({ dshHome: homeDir, harnessDir, dataDir })
  assert.equal(store.homeDir, registry.paths.dshHome)
  assert.equal(store.harnessDir, registry.paths.harnessDir)
  assert.equal(registry.paths.dataDir, dataDir)
  fs.writeFileSync(path.join(homeDir, '.credentials.yaml'), 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: synthetic-portability-test-key\n')
  store.saveEmployee({ id: 'fixture', name: 'Fixture', provider: 'deepseek', brain: { type: 'dsh-acp' } })
  const oldRuntime = process.env.DSH_DESKTOP_HARNESS_DIR
  delete process.env.DSH_DESKTOP_HARNESS_DIR
  t.after(() => { if (oldRuntime === undefined) delete process.env.DSH_DESKTOP_HARNESS_DIR; else process.env.DSH_DESKTOP_HARNESS_DIR = oldRuntime })
  assert.deepEqual(validateProjectStart({ members: [{ agent: 'fixture' }] }, store), { ready: true })
})

function smokeFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpa-smoke-options-'))
  const harnessDir = path.join(root, 'runtime with spaces')
  const dshHome = path.join(root, 'test home')
  fs.mkdirSync(harnessDir)
  fs.mkdirSync(dshHome)
  const packageFile = path.join(harnessDir, 'package.json')
  fs.writeFileSync(packageFile, JSON.stringify({ name: '@deepseek-ai/dsh-root' }))
  t.after(() => {
    fs.unlinkSync(packageFile)
    fs.rmdirSync(harnessDir)
    fs.rmdirSync(dshHome)
    fs.rmdirSync(root)
  })
  return { harnessDir, dshHome }
}

test('live smoke options accept explicit env or CLI paths including spaces', (t) => {
  const fixture = smokeFixture(t)
  assert.deepEqual(resolveSmokePaths({ argv: [], env: { DSH_DESKTOP_HARNESS_DIR: fixture.harnessDir, DSH_HOME: fixture.dshHome } }), fixture)
  assert.deepEqual(resolveSmokePaths({ argv: ['--harness-dir', fixture.harnessDir, `--dsh-home=${fixture.dshHome}`], env: {} }), fixture)
  assert.deepEqual(resolveSmokePaths({ argv: [], env: { DSH_DESKTOP_HARNESS_DIR: fixture.harnessDir, DSH_DESKTOP_DSH_HOME: fixture.dshHome, DSH_HOME: 'ignored-home' } }), fixture)
})

test('live smoke options reject missing or invalid paths without silently choosing private data', (t) => {
  const fixture = smokeFixture(t)
  assert.throws(() => resolveSmokePaths({ argv: [], env: {} }), /requires --harness-dir/)
  assert.throws(() => resolveSmokePaths({ argv: [], env: { DSH_DESKTOP_HARNESS_DIR: fixture.harnessDir } }), /requires --dsh-home/)
  assert.throws(() => resolveSmokePaths({ argv: ['--harness-dir'], env: {} }), /Missing value/)
  assert.throws(() => resolveSmokePaths({ argv: ['--unexpected'], env: {} }), /Unknown smoke option/)
  assert.throws(() => resolveSmokePaths({ argv: [], env: { DSH_DESKTOP_HARNESS_DIR: fixture.dshHome, DSH_HOME: fixture.dshHome } }), /not a DeepSeek Harness runtime/)
  assert.throws(() => resolveSmokePaths({ argv: [], env: { DSH_DESKTOP_HARNESS_DIR: fixture.harnessDir, DSH_HOME: path.join(fixture.dshHome, 'missing') } }), /home directory does not exist/)
})

test('both live smoke entrypoints fail before making a workspace when configuration is missing', () => {
  const env = { ...process.env }
  delete env.DSH_DESKTOP_HARNESS_DIR
  delete env.DSH_DESKTOP_DSH_HOME
  delete env.DSH_HOME
  const root = path.join(os.tmpdir(), `dpa-smoke-unconfigured-${process.pid}-${Date.now()}`)
  env.DPA_ACP_SMOKE_ROOT = root
  for (const script of ['acp-live-smoke.js', 'skill-acp-smoke.js']) {
    const result = spawnSync(process.execPath, [path.join(appRoot, 'scripts', script)], { env, windowsHide: true, encoding: 'utf8', timeout: 10000 })
    assert.equal(result.status, 1, result.error?.message)
    assert.match(result.stderr, /requires --harness-dir/)
    assert.equal(fs.existsSync(root), false)
  }
})

test('public entrypoints, smoke scripts and update policy contain no developer installation paths', () => {
  for (const name of ['main.js', 'dpa-paths.js', 'capability-registry.js', 'cluster-store.js', 'cluster-runtime.js', 'scripts/acp-live-smoke.js', 'scripts/skill-acp-smoke.js', 'test/remote-skill-market.test.js', 'docs/UPDATE_POLICY.md']) {
    const source = fs.readFileSync(path.join(appRoot, name), 'utf8')
    assert.doesNotMatch(source, /TOBETHEBEST|Z:[\\/]/, name)
  }
  assert.doesNotMatch(fs.readFileSync(path.join(appRoot, 'scripts/skill-acp-smoke.js'), 'utf8'), /fs\.rmSync/)
})
