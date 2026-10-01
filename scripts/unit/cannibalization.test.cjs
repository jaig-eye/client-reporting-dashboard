const test = require('node:test'); const assert = require('node:assert/strict')
const path = require('path')
const C = require(path.join(process.env.WT, 'src/lib/content/cannibalization.ts'))
const B = require(path.join(process.env.WT, 'src/lib/content/brandTerms.ts'))
const prot = new Map([
  ['roof repair', { position: 3, url: 'https://x.com/roof-repair/' }],
  ['roof', { position: 8, url: 'https://x.com/' }],
  ['gutter cleaning', { position: 5, url: null }],
])
const stub = (reply) => { const calls = []; return { calls, fn: async (extra) => { calls.push(extra); return typeof reply === 'function' ? reply(calls.length) : reply } } }

test('clean topics pass untouched and cost nothing', async () => {
  const s = stub({ topics: [] })
  const r = await C.resolveCannibalization({ topics: [{ target_keyword: 'metal roof lifespan' }], protectedKeywords: prot, requestTopics: s.fn })
  assert.equal(s.calls.length, 0); assert.equal(r.topics.length, 1); assert.equal(r.demoted.length, 0)
})
test('a one-word ranking query only collides exactly', async () => {
  assert.equal(C.findCollision('metal roof lifespan', prot), null)
  assert.equal(C.findCollision('roof', prot).exact, true)
})
test('containing collision becomes a supporting article with no extra model call', async () => {
  const s = stub({ topics: [] })
  const t = { target_keyword: 'roof repair cost guide' }
  const r = await C.resolveCannibalization({ topics: [t], protectedKeywords: prot, requestTopics: s.fn })
  assert.equal(s.calls.length, 0)
  assert.equal(r.topics.length, 1); assert.equal(r.demoted.length, 1)
  assert.equal(t.page_to_support, 'https://x.com/roof-repair/')
  const d = C.readDemotion(t.ranking_strategy, t.target_keyword)
  assert.equal(d.prot, 'roof repair'); assert.equal(d.exact, false)
})
test('exact collision gets exactly one retry; a clean replacement wins', async () => {
  const s = stub({ topics: [{ target_keyword: 'how to spot hail damage on shingles' }] })
  const r = await C.resolveCannibalization({ topics: [{ target_keyword: 'Roof Repair' }], protectedKeywords: prot, requestTopics: s.fn })
  assert.equal(s.calls.length, 1); assert.equal(r.replaced, 1); assert.equal(r.demoted.length, 0)
  assert.deepEqual(r.topics.map(t => t.target_keyword), ['how to spot hail damage on shingles'])
})
test('exact collision whose retry collides exactly again is demoted after ONE retry', async () => {
  const s = stub({ topics: [{ target_keyword: 'roof repair' }] })
  const t = { target_keyword: 'roof repair', ranking_strategy: 'Model text.' }
  const r = await C.resolveCannibalization({ topics: [t], protectedKeywords: prot, requestTopics: s.fn })
  assert.equal(s.calls.length, 1); assert.equal(r.topics.length, 1); assert.equal(r.demoted.length, 1)
  const d = C.readDemotion(t.ranking_strategy, t.target_keyword)
  assert.equal(d.exact, true); assert.equal(d.prot, 'roof repair')
  assert.ok(d.directive.endsWith('as the primary internal link.'), 'directive stops before model text')
  assert.ok(!d.directive.includes('Model text'))
})
test('a queued keyword (maxRounds 0) is kept and demoted on an exact collision, never swapped', async () => {
  const s = stub({ topics: [{ target_keyword: 'something else entirely' }] })
  const t = { target_keyword: 'Roof Repair' }
  const r = await C.resolveCannibalization({ topics: [t], protectedKeywords: prot, requestTopics: s.fn, maxRounds: 0 })
  assert.equal(s.calls.length, 0)
  assert.deepEqual(r.topics.map(x => x.target_keyword), ['Roof Repair'])
  assert.equal(r.demoted.length, 1); assert.equal(t.page_to_support, 'https://x.com/roof-repair/')
  assert.equal(C.readDemotion(t.ranking_strategy, t.target_keyword).exact, true)
})
test('a replacement that only contains a ranking phrase is kept as a supporting article', async () => {
  const s = stub({ topics: [{ target_keyword: 'roof repair after hail' }] })
  const r = await C.resolveCannibalization({ topics: [{ target_keyword: 'roof repair' }], protectedKeywords: prot, requestTopics: s.fn })
  assert.equal(r.topics.length, 1)
  assert.equal(r.topics[0].target_keyword, 'roof repair after hail'); assert.equal(r.demoted.length, 1)
})
test('a failed retry demotes rather than dropping', async () => {
  const s = stub({ topics: [], error: 'boom' })
  const r = await C.resolveCannibalization({ topics: [{ target_keyword: 'gutter cleaning' }, { target_keyword: 'x y' }], protectedKeywords: prot, requestTopics: s.fn })
  assert.equal(r.topics.length, 2); assert.equal(r.demoted.length, 1)
  assert.match(r.demoted[0], /no URL known/)
})
test('an already-demoted topic is not judged again', async () => {
  const t = { target_keyword: 'roof repair' }
  await C.resolveCannibalization({ topics: [t], protectedKeywords: prot, requestTopics: async () => ({ topics: [] }) })
  const before = t.ranking_strategy
  const s = stub({ topics: [] })
  const r = await C.resolveCannibalization({ topics: [t], protectedKeywords: prot, requestTopics: s.fn })
  assert.equal(s.calls.length, 0); assert.equal(t.ranking_strategy, before); assert.equal(r.topics.length, 1)
})
test('readDemotion handles directives written before the phrase was quoted', () => {
  const old = 'SUPPORTING ARTICLE — the client ALREADY RANKS #2 for this exact keyword at https://a/. Do NOT write another page targeting it. Shift to a genuinely narrower question this page does not answer, and link to it (https://a/) as the primary internal link. Extra.'
  const d = C.readDemotion(old, 'Window Tint')
  assert.equal(d.prot, 'window tint'); assert.equal(d.exact, true); assert.ok(!d.directive.includes('Extra'))
  assert.equal(C.readDemotion('A unique angle on depth', 'x'), null)
})
test('brand matcher: place+service names gate nothing, distinctive names still gate', () => {
  const vn = B.brandMatcher('Van Nuys Awning', 'vannuysawning.com', 'awnings, patio covers', 'Van Nuys, CA')
  assert.equal(vn('van nuys awnings'), false)
  const dr = B.brandMatcher('Dallas Roofing Pros', 'dallasroofingpros.com', 'roofing, roof repair', 'Dallas, TX')
  assert.equal(dr('dallas roofing'), false); assert.equal(dr('dallas roofing prices'), false)
  assert.equal(dr('dallas roofing pros reviews'), true)
  const fs = B.brandMatcher('5 Star Tuning', '5startuning.com', 'ECU tuning, dyno tuning', 'Tampa, FL')
  assert.equal(fs('five star tuning'), true); assert.equal(fs('5star tuning f150'), true); assert.equal(fs('ecu tuning tampa'), false)
  const ii = B.brandMatcher('Irrigation Inc', 'irrigationinc.com', 'irrigation repair, sprinklers', 'Orlando')
  assert.equal(ii('irrigation repair'), false)
})

test('demotion keeps the input order, so the queue pairs each keyword with its own topic', async () => {
  // A containing collision first, a clean topic second: demoting used to move the first to the end.
  const a = { target_keyword: 'roof repair cost guide' }, b = { target_keyword: 'metal roof lifespan' }
  const r = await C.resolveCannibalization({ topics: [a, b], protectedKeywords: prot, requestTopics: async () => ({ topics: [] }), maxRounds: 0 })
  assert.deepEqual(r.topics, [a, b]); assert.equal(r.demoted.length, 1)
})
test('a replacement takes the place of the topic it replaces', async () => {
  const s = stub({ topics: [{ target_keyword: 'how to spot hail damage on shingles' }] })
  const r = await C.resolveCannibalization({
    topics: [{ target_keyword: 'metal roof lifespan' }, { target_keyword: 'roof repair' }, { target_keyword: 'roof repair after a storm' }],
    protectedKeywords: prot, requestTopics: s.fn,
  })
  assert.deepEqual(r.topics.map(t => t.target_keyword), ['metal roof lifespan', 'how to spot hail damage on shingles', 'roof repair after a storm'])
  assert.equal(r.replaced, 1); assert.equal(r.demoted.length, 1)
})
test('with no URL for the ranking page, the directive asks for no link', async () => {
  const exact = { target_keyword: 'gutter cleaning', ranking_strategy: 'Model text.' }
  const near  = { target_keyword: 'gutter cleaning tools' }
  await C.resolveCannibalization({ topics: [exact, near], protectedKeywords: prot, requestTopics: async () => ({ topics: [] }), maxRounds: 0 })
  for (const t of [exact, near]) {
    const d = C.readDemotion(t.ranking_strategy, t.target_keyword)
    assert.equal(d.prot, 'gutter cleaning')
    assert.doesNotMatch(d.directive, /link to it/)
    assert.match(d.directive, /add no link for it\.$/)
    assert.equal(t.page_to_support, undefined)
  }
  assert.ok(!C.readDemotion(exact.ranking_strategy, exact.target_keyword).directive.includes('Model text'))
})
