// Keyword research and DataForSEO spend: the rules that decide what is bought, what is billed and
// where a market is measured. Pure functions, plus the Labs helpers against a stubbed fetch — no
// network, no database.
const test = require('node:test'); const assert = require('node:assert/strict')
const path = require('path'); const src = p => path.join(process.env.WT, 'src', p)
const { resolveBudgetSetting, DEFAULT_MONTHLY_BUDGET } = require(src('lib/content/dfsBudget.ts'))
const { dfsRefusal, dfsKeywordIdeas, dfsKeywordsForSite, dfsLocalSerp } = require(src('lib/connectors/dataforseo.ts'))
const { rotatingWindow, researchTurn, parseServices, locationCandidates, geoPhrase } = require(src('lib/content/researchSeeds.ts'))
const { splitPlace } = require(src('lib/content/usStates.ts'))
const { buildSeedMatcher, isLiveOwned } = require(src('lib/content/clientResearch.ts'))

// ── The monthly ceiling fails closed ─────────────────────────────────────────
test('budget: only a present, NULL column means no ceiling', () => {
  assert.deepEqual(resolveBudgetSetting({ dataforseo_monthly_budget: null }, null), { limit: null })
  assert.deepEqual(resolveBudgetSetting({ dataforseo_monthly_budget: 40 }, null), { limit: 40 })
  assert.deepEqual(resolveBudgetSetting({ dataforseo_monthly_budget: '25.5' }, null), { limit: 25.5 })
  // $0 is a ceiling: spend nothing.
  assert.deepEqual(resolveBudgetSetting({ dataforseo_monthly_budget: 0 }, null), { limit: 0 })
})
test('budget: migration 226 missing, no row or a garbage value is the $100 default, not "no limit"', () => {
  assert.equal(DEFAULT_MONTHLY_BUDGET, 100)
  const missing = { message: 'column agency_settings.dataforseo_monthly_budget does not exist' }
  assert.deepEqual(resolveBudgetSetting(null, missing), { limit: 100 })
  assert.deepEqual(resolveBudgetSetting(null, null), { limit: 100 })
  assert.deepEqual(resolveBudgetSetting({ dataforseo_monthly_budget: -5 }, null), { limit: 100 })
  assert.deepEqual(resolveBudgetSetting({ dataforseo_monthly_budget: 'lots' }, null), { limit: 100 })
})
test('budget: an unreadable settings row holds spending', () => {
  const r = resolveBudgetSetting(null, { message: 'connection terminated unexpectedly' })
  assert.ok('hold' in r)
})

// ── Refused DataForSEO requests are not billed ───────────────────────────────
test('dfsRefusal reads both the request and the task status', () => {
  assert.equal(dfsRefusal(null), null)
  assert.equal(dfsRefusal({ status_code: 20000, tasks: [{ status_code: 20000 }] }), null)
  assert.match(dfsRefusal({ status_code: 40200, status_message: 'Payment Required.' }), /^40200/)
  assert.match(dfsRefusal({ status_code: 20000, tasks: [{ status_code: 40501, status_message: 'Invalid Field' }] }), /^40501/)
})

const creds = { login: 'test', password: 'test' }
async function withFetch(body, fn) {
  const real = global.fetch
  global.fetch = async () => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  try { return await fn() } finally { global.fetch = real }
}
const answered = {
  status_code: 20000, cost: 0.0123,
  tasks: [{ status_code: 20000, result: [{ items: [{ keyword: 'roof repair', keyword_info: { search_volume: 900 } }] }] }],
}
const refusedTask = { status_code: 20000, cost: 0, tasks: [{ status_code: 40501, status_message: 'Invalid Field', result: null }] }
const refusedRequest = { status_code: 40200, status_message: 'Payment Required.', cost: 0, tasks: [] }

test('Labs helpers bill an answer and nothing for a refusal', async () => {
  for (const [name, call] of [
    ['keyword_ideas',   onCost => dfsKeywordIdeas(['roof repair'], creds, { onCost })],
    ['ranked_keywords', onCost => dfsKeywordsForSite('example.com', creds, { onCost })],
  ]) {
    let billed = []
    const rows = await withFetch(answered, () => call(c => billed.push(c)))
    assert.deepEqual(billed, [0.0123], `${name} bills the reported cost`)
    assert.equal(rows.length, 1)

    for (const refusal of [refusedTask, refusedRequest]) {
      billed = []
      const none = await withFetch(refusal, () => call(c => billed.push(c)))
      assert.deepEqual(billed, [], `${name} must not bill a refusal (${refusal.status_code})`)
      assert.deepEqual(none, [])
    }
  }
})
test('a local SERP refused at the request level is not billed either', async () => {
  const billed = []
  const r = await withFetch(refusedRequest, () => dfsLocalSerp('roof repair', creds, { locationCode: 1015116, onCost: c => billed.push(c) }))
  assert.equal(r, null)
  assert.deepEqual(billed, [])
})

// ── Every service gets its turn ──────────────────────────────────────────────
test('rotatingWindow covers every item within ceil(n / size) consecutive turns', () => {
  const services = Array.from({ length: 22 }, (_, i) => `service ${i}`)
  const seen = new Map(services.map(s => [s, 0]))
  for (let turn = 100; turn < 104; turn++) {
    const w = rotatingWindow(services, 6, turn)
    assert.equal(w.length, 6, 'the per-run cost does not change')
    for (const s of w) seen.set(s, seen.get(s) + 1)
  }
  assert.ok(Array.from(seen.values()).every(n => n >= 1), 'no service is left out across four turns')
  // Over many turns, every service is expanded as often as any other, give or take one.
  const counts = new Map(services.map(s => [s, 0]))
  for (let turn = 0; turn < 110; turn++) for (const s of rotatingWindow(services, 6, turn)) counts.set(s, counts.get(s) + 1)
  const values = Array.from(counts.values())
  assert.ok(Math.max(...values) - Math.min(...values) <= 1)
})
test('rotatingWindow leaves a short list alone, and turns advance monthly', () => {
  assert.deepEqual(rotatingWindow(['a', 'b'], 6, 7), ['a', 'b'])
  assert.deepEqual(rotatingWindow(['a', 'b', 'c'], 0, 1), [])
  assert.equal(researchTurn(new Date('2026-11-03T00:00:00Z')) - researchTurn(new Date('2026-10-31T00:00:00Z')), 1)
})
test('services are not capped, so the matcher knows every one of them', () => {
  const list = Array.from({ length: 14 }, (_, i) => `widget${String.fromCharCode(97 + i)} repair`).join(', ')
  const services = parseServices(list)
  assert.equal(services.length, 14)
  const m = buildSeedMatcher(services, 'Tampa')
  // The fourteenth service used to fall outside the first twelve and every keyword about it was
  // thrown away as off-topic.
  assert.equal(m.serviceOf('widgetn repair cost'), 'widgetn repair')
})

// ── Where a market is measured ───────────────────────────────────────────────
test('splitPlace: a state on its own, or part of one, is not a town', () => {
  assert.deepEqual(splitPlace('West Virginia'), { head: 'West Virginia', region: null })
  assert.deepEqual(splitPlace('South Florida'), { head: 'South Florida', region: null })
  assert.deepEqual(splitPlace('Northern Virginia'), { head: 'Northern Virginia', region: null })
  assert.deepEqual(splitPlace('Florida'), { head: 'Florida', region: null })
})
test('splitPlace: a town keeps its state, including a two-word one', () => {
  assert.deepEqual(splitPlace('Charleston West Virginia'), { head: 'Charleston', region: 'West Virginia' })
  assert.deepEqual(splitPlace('Melbourne FL'), { head: 'Melbourne', region: 'Florida' })
  assert.deepEqual(splitPlace('Melbourne, FL'), { head: 'Melbourne', region: 'Florida' })
  assert.deepEqual(splitPlace('Manchester New Hampshire'), { head: 'Manchester', region: 'New Hampshire' })
})
test('"with" ends a place: the state stays on the city', () => {
  assert.deepEqual(locationCandidates('Melbourne, FL with nationwide and Canada service area'), ['Melbourne, FL'])
  assert.deepEqual(locationCandidates('Melbourne, FL with nationwide'), ['Melbourne, FL'])
  assert.equal(geoPhrase(null, 'Tampa with statewide delivery'), 'Tampa')
})

// ── The Labs snapshot leaves live-checked keywords alone ─────────────────────
test('isLiveOwned: only tracked keywords read live recently', () => {
  const now = Date.parse('2026-10-01T00:00:00Z')
  const daysAgo = d => new Date(now - d * 86_400_000).toISOString()
  assert.equal(isLiveOwned({ is_tracked: true, last_checked_at: daysAgo(10) }, now), true)
  assert.equal(isLiveOwned({ is_tracked: true, last_checked_at: daysAgo(190) }, now), true)
  // Not read live in that long: retired, or a money keyword the cron leaves alone.
  assert.equal(isLiveOwned({ is_tracked: true, last_checked_at: daysAgo(400) }, now), false)
  assert.equal(isLiveOwned({ is_tracked: true, last_checked_at: null }, now), false)
  assert.equal(isLiveOwned({ is_tracked: false, last_checked_at: daysAgo(1) }, now), false)
})
