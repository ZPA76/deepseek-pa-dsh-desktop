'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const vm = require('node:vm')
const { createExtensionMarket, mapRepository, githubError } = require('../extension-market')

function repo(number, extra = {}) {
  return { name:`result-${number}`, full_name:`owner/result-${number}`, html_url:`https://github.com/owner/result-${number}`, owner:{ login:'owner' }, description:'A repository', stargazers_count:number, ...extra }
}

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpa-pagination-'))
  t.after(() => fs.rmSync(root, { recursive:true, force:true }))
  return createExtensionMarket({ dataDir:path.join(root, 'data'), dshHome:path.join(root, 'home'), harnessDir:path.join(root, 'harness'), ...options })
}

test('GitHub 搜索保留原始关键词和全部返回项，30 项以上可继续翻页', async (t) => {
  const calls = []
  const market = fixture(t, { githubRequester:async (pathname) => {
    const query = new URL(pathname, 'https://api.github.com').searchParams
    calls.push(query)
    const page = Number(query.get('page'))
    return { total_count:85, items:Array.from({ length:page === 3 ? 25 : 30 }, (_, index) => repo((page - 1) * 30 + index + 1)) }
  } })
  const first = await market.search({ source:'github', query:'user:nicepkg', page:1 })
  const second = await market.search({ source:'github', query:'user:nicepkg', page:2 })
  const third = await market.search({ source:'github', query:'user:nicepkg', page:3 })
  assert.equal(calls[0].get('q'), 'user:nicepkg')
  assert.equal(calls[0].has('sort'), false)
  assert.equal(first.items.length, 30)
  assert.equal(second.items[0].repo, 'owner/result-31')
  assert.equal(first.totalCount, 85)
  assert.equal(first.totalPages, 3)
  assert.equal(first.hasNext, true)
  assert.equal(first.hasPrevious, false)
  assert.equal(third.items.length, 25)
  assert.equal(third.hasNext, false)
  assert.equal(third.hasPrevious, true)
})

test('显式分类公开追加查询词，但不按本地类型再次过滤；GitHub 网页条件一致', async (t) => {
  const market = fixture(t, { githubRequester:async (pathname) => {
    const params = new URL(pathname, 'https://api.github.com').searchParams
    assert.equal(params.get('q'), 'agent theme')
    assert.equal(params.get('sort'), 'updated')
    assert.equal(params.get('per_page'), '60')
    return { total_count:2, items:[repo(1), repo(2, { name:'mixed-skill', description:'Theme and skill pack' })] }
  } })
  const result = await market.search({ query:'agent', kind:'theme', perPage:60, sort:'updated' })
  assert.equal(result.items.length, 2)
  assert.equal(result.effectiveQuery, 'agent theme')
  const web = new URL(result.githubUrl)
  assert.equal(web.searchParams.get('q'), 'agent theme')
  assert.equal(web.searchParams.get('s'), 'updated')
})

test('1,000 项边界、100 项分页和 GitHub 不完整结果明确报告', async (t) => {
  const market = fixture(t, { githubRequester:async (pathname) => {
    const params = new URL(pathname, 'https://api.github.com').searchParams
    assert.equal(params.get('page'), '10')
    return { total_count:4321, incomplete_results:true, items:Array.from({ length:100 }, (_, index) => repo(index + 901)) }
  } })
  const result = await market.search({ query:'skill', perPage:100, page:500 })
  assert.equal(result.totalCount, 4321)
  assert.equal(result.accessibleCount, 1000)
  assert.equal(result.totalPages, 10)
  assert.equal(result.page, 10)
  assert.equal(result.hasNext, false)
  assert.equal(result.limited, true)
  assert.equal(result.incompleteResults, true)
})

test('30 项分页最后一页仅显示 GitHub 允许的第 991 至 1000 项', async (t) => {
  const market = fixture(t, { githubRequester:async () => ({ total_count:4000, items:Array.from({ length:30 }, (_, index) => repo(index + 991)) }) })
  const result = await market.search({ query:'skill', perPage:30, page:34 })
  assert.equal(result.items.length, 10)
  assert.equal(result.totalPages, 34)
  assert.equal(result.hasNext, false)
})

test('缓存区分页码、排序、查询和登录态，并支持手动刷新和过期', async (t) => {
  let calls = 0; let token = ''; let clock = 1000
  const market = fixture(t, { now:() => clock, githubAuth:{ token:async () => token }, githubRequester:async () => { calls++; return { total_count:99, items:[repo(calls)] } } })
  const query = { query:'mcp' }
  await market.search(query)
  assert.equal((await market.search(query)).cached, true)
  await market.search({ ...query, page:2 })
  await market.search({ ...query, sort:'stars' })
  await market.search({ query:'skill' })
  assert.equal(calls, 4)
  token = 'test-account'
  assert.equal((await market.search(query)).cached, false)
  token = ''
  assert.equal((await market.search(query)).cached, false)
  await market.search({ ...query, refresh:true })
  clock += 60001
  assert.equal((await market.search(query)).cached, false)
  assert.equal(calls, 8)
})

test('重复搜索合并在途请求；失败不缓存，重试可恢复', async (t) => {
  let resolve; let calls = 0
  const market = fixture(t, { githubRequester:() => { calls++; return new Promise((done) => { resolve = done }) } })
  const first = market.search({ query:'theme' }); const second = market.search({ query:'theme' })
  resolve({ total_count:1, items:[repo(1)] })
  assert.equal((await first).items.length, 1)
  assert.equal((await second).items.length, 1)
  assert.equal(calls, 1)
  let failures = 0
  const retryMarket = fixture(t, { githubRequester:async () => { if (!failures++) throw new Error('network'); return { total_count:1, items:[repo(2)] } } })
  await assert.rejects(retryMarket.search({ query:'x' }), /network/)
  assert.equal((await retryMarket.search({ query:'x' })).items.length, 1)
})

test('精选清单与 GitHub 搜索独立；空搜索不偷偷缩小范围或调用网络', async (t) => {
  const market = fixture(t, { githubRequester:async () => { throw new Error('should not call') } })
  const empty = await market.search({ source:'github', query:'' })
  assert.equal(empty.requiresQuery, true)
  const curated = await market.search({ source:'curated' })
  assert.equal(curated.source, 'curated')
  assert.ok(curated.items.length > 0)
})

test('GitHub 限流、登录失效和搜索条件错误提供不同的可操作提示', () => {
  assert.match(githubError(429, {}, { 'retry-after':'90' }).message, /90 秒/)
  assert.match(githubError(403, { message:'API rate limit exceeded' }).message, /限额/)
  assert.match(githubError(401).message, /重新连接/)
  assert.match(githubError(422, { message:'Validation Failed' }).message, /1,000/)
  assert.match(githubError(503).message, /503/)
})

test('全站搜索不会把普通仓库或 VS Code 主题冒充为可安装 DSH 插件', () => {
  assert.equal(mapRepository(repo(1)).kind, 'repository')
  assert.equal(mapRepository(repo(1)).installSpec, '')
  assert.equal(mapRepository(repo(2, { description:'VS Code theme' })).installSpec, '')
  assert.equal(mapRepository(repo(3, { description:'A plugin for DeepSeek Harness' })).installSpec, 'github:owner/result-3')
  assert.equal(mapRepository(repo(4, { description:'Agent skill library' })).kind, 'skill')
})

function rendererFixture() {
  const nodes = new Map()
  const values = { 'market-search':'agent', 'market-source':'github', 'market-sort':'best-match', 'market-page-size':'30' }
  const byId = (id) => { if (!nodes.has(id)) nodes.set(id, { value:values[id] || '', setAttribute() {} }); return nodes.get(id) }
  const requests = []
  const context = {
    state:{ kind:'all', extensions:[], market:{ page:1, requestId:0, signature:'', result:null } }, byId, URLSearchParams,
    renderMarket() {}, toast() {}, api:{ request:(_method, payload) => new Promise((resolve, reject) => requests.push({ payload, resolve, reject })) },
  }
  const script = fs.readFileSync(path.join(__dirname, '../capabilities.js'), 'utf8')
  vm.runInNewContext(script.slice(script.indexOf('function marketGithubUrl()'), script.indexOf('async function openSource(')), context)
  return { context, requests, byId }
}

test('快速输入的新查询胜出，旧响应不会覆盖结果；条件变化重置页码', async () => {
  const { context, requests, byId } = rendererFixture()
  const oldSearch = context.searchMarket()
  byId('market-search').value = 'new-query'
  const newSearch = context.searchMarket({ page:5 })
  assert.equal(requests[1].payload.page, 1)
  requests[1].resolve({ items:[{ name:'new' }], page:1, totalPages:5, totalCount:150, hasNext:true })
  await newSearch
  requests[0].resolve({ items:[{ name:'old' }], page:1, totalPages:1, totalCount:1 })
  await oldSearch
  assert.equal(context.state.extensions[0].name, 'new')
  const next = context.searchMarket({ page:2 })
  assert.equal(requests[2].payload.page, 2)
  requests[2].resolve({ items:[{ name:'page2' }], page:2, totalPages:5, totalCount:150, hasPrevious:true, hasNext:true })
  await next
  byId('market-sort').value = 'stars'
  const sorted = context.searchMarket()
  assert.equal(requests[3].payload.page, 1)
  requests[3].resolve({ items:[], page:1, totalPages:0, totalCount:0 })
  await sorted
})

test('搜索失败清除旧结果，分页禁用；重试成功恢复非错误提示', async () => {
  const { context, requests, byId } = rendererFixture()
  const failed = context.searchMarket()
  requests[0].reject(new Error('GitHub 限额'))
  await failed
  assert.equal(context.state.market.loading, false)
  assert.equal(byId('market-next').disabled, true)
  assert.match(byId('market-notice').className, /error/)
  const retry = context.searchMarket({ refresh:true })
  requests[1].resolve({ items:[{ name:'ok' }], page:1, totalPages:2, totalCount:40, hasNext:true })
  await retry
  assert.equal(byId('market-notice').className, 'notice')
  assert.equal(byId('market-next').disabled, false)
  assert.equal(context.state.extensions[0].name, 'ok')
})
