const test = require('node:test'); const assert = require('node:assert/strict')
const path = require('path')
const S = require(path.join(process.env.WT, 'src/lib/content/scheduleSlots.ts'))
const Q = require(path.join(process.env.WT, 'src/lib/content/siloQueue.ts'))
const I = require(path.join(process.env.WT, 'src/lib/content/generatePostImage.ts'))

// ── The planning window (calendar/generate without a start date, and the cron) ──────────────

const weekly = { frequency: 'weekly', dayOfWeek: 1, weeksAhead: 4 }

test('a start date three months back still plans the next weeks_ahead dates from today', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T12:00:00Z') })
  assert.deepEqual(
    S.windowSlots({ ...weekly, scheduleStartDate: '2026-07-01' }),
    ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'],
  )
})

test('the window is one cadence cycle per weeks_ahead, at least one', () => {
  assert.equal(S.leadWindowDays('weekly', 4), 28)
  assert.equal(S.leadWindowDays('monthly', 2), 56)
  assert.equal(S.leadWindowDays('biweekly', null), 14)
  assert.equal(S.leadWindowDays('weekly', 0), 7)
})

test('monthly on the first Monday plans weeks_ahead months', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T12:00:00Z') })
  assert.deepEqual(
    S.windowSlots({ frequency: 'monthly', dayOfWeek: 1, weeksAhead: 2, scheduleStartDate: '2026-01-25' }),
    ['2026-10-05', '2026-11-02'],
  )
})

// ── Biweekly runs on the client's own fortnight ──────────────────────────────────────────────

const biweekly = { frequency: 'biweekly', dayOfWeek: 1, weeksAhead: 4, scheduleStartDate: '2026-09-09' }

test('biweekly dates keep one fortnight whichever day the cron runs on', (t) => {
  // Start 2026-09-09 (a Wednesday): the series is the Mondays from 09-14, every 14 days.
  const series = new Set(['2026-09-14', '2026-09-28', '2026-10-12', '2026-10-26', '2026-11-09', '2026-11-23', '2026-12-07'])
  for (const now of ['2026-10-01T12:00:00Z', '2026-10-04T19:00:00Z', '2026-10-05T01:00:00Z', '2026-10-11T19:00:00Z']) {
    t.mock.timers.reset()
    t.mock.timers.enable({ apis: ['Date'], now: new Date(now) })
    const got = S.computeFutureSlots('biweekly', 1, 9, biweekly.scheduleStartDate)
    assert.ok(got.length >= 3, now)
    for (const d of got) assert.ok(series.has(d), `${d} (run at ${now}) is off the client's fortnight`)
  }
})

test('the biweekly window never holds two consecutive weeks', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-04T19:00:00Z') })
  assert.deepEqual(S.windowSlots(biweekly), ['2026-10-12', '2026-10-26', '2026-11-09', '2026-11-23'])
})

test('biweekly with no start date keeps its old anchor: the next publish weekday after today', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T12:00:00Z') })
  assert.deepEqual(S.computeFutureSlots('biweekly', 1, 5, null), ['2026-10-05', '2026-10-19', '2026-11-02'])
})

test('alignToFortnight moves only an off-week date, by a week', () => {
  const at = (d) => new Date(d + 'T07:00:00Z')
  assert.equal(S.alignToFortnight(at('2026-10-12'), 1, '2026-09-09').toISOString().slice(0, 10), '2026-10-12')
  assert.equal(S.alignToFortnight(at('2026-10-05'), 1, '2026-09-09').toISOString().slice(0, 10), '2026-10-12')
  // A start date ON the publish weekday is the series' first date.
  assert.equal(S.alignToFortnight(at('2026-10-05'), 1, '2026-09-21').toISOString().slice(0, 10), '2026-10-05')
  assert.equal(S.alignToFortnight(at('2026-10-05'), 1, null).toISOString().slice(0, 10), '2026-10-05')
  assert.equal(S.alignToFortnight(at('2026-10-05'), 1, 'not a date').toISOString().slice(0, 10), '2026-10-05')
})

// ── Which dates priority sets take ───────────────────────────────────────────────────────────

test('the oldest set takes the first slots, one per keyword waiting, then the next set, then the usual selection', () => {
  const plan = Q.splitSlotsBySets(['d1', 'd2', 'd3', 'd4', 'd5'], [{ id: 'old', waiting: 2 }, { id: 'new', waiting: 1 }])
  assert.deepEqual(plan, [
    { slot: 'd1', siloId: 'old' }, { slot: 'd2', siloId: 'old' },
    { slot: 'd3', siloId: 'new' },
    { slot: 'd4', siloId: null }, { slot: 'd5', siloId: null },
  ])
})

test('a set never takes more slots than it has keywords, even when a date wants two posts', () => {
  const plan = Q.splitSlotsBySets(['d1', 'd1', 'd2', 'd2'], [{ id: 's', waiting: 3 }])
  assert.deepEqual(plan.map(p => p.siloId), ['s', 's', 's', null])
  assert.deepEqual(Q.splitSlotsBySets(['d1'], [{ id: 's', waiting: 5 }]), [{ slot: 'd1', siloId: 's' }])
  assert.deepEqual(Q.splitSlotsBySets(['d1'], []), [{ slot: 'd1', siloId: null }])
})

test('a set that runs out partway through a date leaves the rest of it to the usual selection, as the cron does', () => {
  const plan = Q.splitSlotsBySets(['d1', 'd1', 'd2', 'd2'], [{ id: 'a', waiting: 1 }, { id: 'b', waiting: 5 }])
  assert.deepEqual(plan.map(p => p.siloId), ['a', null, 'b', 'b'])
})

// A query-builder stand-in for waitingSets: the silo list, then one head count per silo.
function setsDb({ silos, waiting, silosError = null, countError = null }) {
  return {
    from(table) {
      let silo = null
      const chain = {
        select: () => chain, order: () => chain, is: () => chain,
        eq: (col, v) => { if (col === 'silo_id') silo = v; return chain },
        then: (res) => res(table === 'content_silos'
          ? { data: silos.map(id => ({ id })), error: silosError }
          : { count: waiting[silo] ?? 0, error: countError }),
      }
      return chain
    },
  }
}

test('waitingSets: oldest first, finished sets left out', async () => {
  const r = await Q.waitingSets(setsDb({ silos: ['a', 'b', 'c'], waiting: { a: 0, b: 3, c: 1 } }), 'client')
  assert.deepEqual(r, { sets: [{ id: 'b', waiting: 3 }, { id: 'c', waiting: 1 }], error: null })
})

test('waitingSets: a failed read plans without sets and says why', async () => {
  assert.deepEqual(await Q.waitingSets(setsDb({ silos: [], waiting: {}, silosError: { message: 'boom' } }), 'c'), { sets: [], error: 'boom' })
  assert.deepEqual(await Q.waitingSets(setsDb({ silos: ['a'], waiting: { a: 2 }, countError: { message: 'nope' } }), 'c'), { sets: [], error: 'nope' })
})

// ── A rewrite pinned to its keyword ──────────────────────────────────────────────────────────

test('a pinned rewrite is prompted with its own keyword and asked for a fresh angle', () => {
  const entry = Q.pinnedKeywordEntry('how to choose an "awning" company')
  assert.equal(entry.keyword, 'how to choose an awning company')
  const block = Q.buildKeywordQueueBlock('Awnings', null, [entry], '', 1) + Q.pinnedKeywordNote(entry.keyword)
  assert.match(block, /1\. "how to choose an awning company"/)
  assert.match(block, /REPLACES AN ARTICLE ALREADY WRITTEN FOR "how to choose an awning company"/)
  assert.match(block, /fresh angle/)
})

// ── Where a featured image is set ────────────────────────────────────────────────────────────

const post = { id: 'p', client_id: 'c', image_concept: null, seo_title: 'How to pick a tuner', title: null, target_keyword: 'ecu tuner' }
const setting = (geo) => I.buildImagePrompt(post, { services: 'ECU tuning', geographic_focus: geo, content_image_prompt: null })

test('a business with no local market gets no place in its image prompt', () => {
  for (const geo of ['Nationwide', 'Nationwide online (ships across the US); in-shop at 1820 Trade St, Florence, SC', 'All of Canada (coast to coast)', 'online store']) {
    assert.match(setting(geo), /in a real-world ECU tuning setting\./, geo)
  }
})

test('a local business is placed in its primary market, not the sentence it was written in', () => {
  assert.match(setting('Brevard County, FL (based in Cocoa, FL)'), /setting in Brevard County, FL\./)
  assert.match(setting('Fort Worth, Dallas, Arlington, and surrounding DFW areas'), /setting in Fort Worth\./)
})
