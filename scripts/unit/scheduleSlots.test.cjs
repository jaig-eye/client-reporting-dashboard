const test = require('node:test'); const assert = require('node:assert/strict')
const path = require('path')
const S = require(path.join(process.env.WT, 'src/lib/content/scheduleSlots.ts'))

// A query-builder stand-in: every call chains, and awaiting it (or maybeSingle) yields the rows
// registered for that table and filter shape.
function stubDb({ settings, global = null, topics = [], suppressed = [] }) {
  return {
    from(table) {
      const q = { table, isNull: false }
      const chain = {
        select: () => chain, eq: () => chain, in: () => chain, order: () => chain, limit: () => chain,
        not: () => chain, or: () => chain,
        is: (col, v) => { if (v === null) q.isNull = true; return chain },
        // content_topics' single row is the plan's frontier: its latest date.
        maybeSingle: async () => ({
          data: table === 'content_topics'
            ? (topics.length ? { target_publish_date: [...topics].sort().at(-1) } : null)
            : q.isNull ? global : settings,
          error: null,
        }),
        then: (res) => res({
          data: table === 'content_topics' ? topics.map(d => ({ target_publish_date: d })) : suppressed.map(d => ({ target_publish_date: d })),
          error: null,
        }),
      }
      return chain
    },
  }
}

const weekly = { schedule_frequency: 'weekly', schedule_day_of_week: 1, weeks_ahead: 4, schedule_start_date: null, posts_per_run: 1, auto_generate: true }

test('a full four-week window answers with the Monday after it, picked up when it enters the window', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T12:00:00Z') })
  const r = await S.nextOpenSlot(stubDb({ settings: weekly, topics: ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'] }), 'c')
  assert.deepEqual(r, { date: '2026-11-02', picksOn: '2026-10-05', autoGenerate: true })
})

test('an open date inside the window is filled on the next run; a suppressed one is skipped', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T12:00:00Z') })
  const r = await S.nextOpenSlot(stubDb({ settings: weekly, topics: ['2026-10-05'], suppressed: ['2026-10-12'] }), 'c')
  assert.deepEqual(r, { date: '2026-10-19', picksOn: null, autoGenerate: true })
})

test('no schedule row means no answer', async () => {
  assert.equal(await S.nextOpenSlot(stubDb({ settings: null }), 'c'), null)
})

test('monthly is the first of the publish weekday, whatever day the run happens on', (t) => {
  assert.equal(S.firstWeekdayOfMonth(2026, 9, 1), 5)   // October 2026 starts on a Thursday: first Monday the 5th
  assert.equal(S.firstWeekdayOfMonth(2026, 9, 4), 1)   // first Thursday is the 1st itself
  assert.equal(S.firstWeekdayOfMonth(2026, 1, 0), 1)   // February 2026 starts on a Sunday
  // Two runs a week apart plan the same dates: no anchor, so nothing to drift.
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T12:00:00Z') })
  const first = S.computeFutureSlots('monthly', 1, 12)
  assert.deepEqual(first, ['2026-10-05', '2026-11-02', '2026-12-07'])
  t.mock.timers.setTime(new Date('2026-10-08T12:00:00Z').getTime())
  assert.deepEqual(S.computeFutureSlots('monthly', 1, 12).slice(0, 2), ['2026-11-02', '2026-12-07'])
})

test('the fixed monthly dates are unchanged', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T12:00:00Z') })
  assert.deepEqual(S.computeFutureSlots('monthly_mid', 1, 9), ['2026-10-15', '2026-11-15'])
  assert.deepEqual(S.computeFutureSlots('monthly_end', 3, 9), ['2026-10-28', '2026-11-28'])
})

// ── Planning only moves forward ──────────────────────────────────────────────

test('forward slots: from the plan’s last date on, that date included', () => {
  const slots = ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']
  assert.deepEqual(S.forwardSlots(slots, '2026-10-12'), ['2026-10-12', '2026-10-19', '2026-10-26'])
  assert.deepEqual(S.forwardSlots(slots, null), slots)
  assert.deepEqual(S.forwardSlots(slots, '2026-11-30'), [])
})

test('a gap before the plan’s last date is left for Regenerate plan', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T12:00:00Z') })
  // Oct 12 is empty, but Oct 19 is planned: the next date the cron fills is Oct 26.
  const r = await S.nextOpenSlot(stubDb({ settings: weekly, topics: ['2026-10-05', '2026-10-19'] }), 'c')
  assert.deepEqual(r, { date: '2026-10-26', picksOn: null, autoGenerate: true })
})

test('weekly to monthly: the old weekly plan stands and monthly carries on after it', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T12:00:00Z') })
  // Planned weekly through Oct 26. The first Monday of October (Oct 5) sits inside the old plan's
  // span and is left alone; the first Monday of November is the next date filled.
  const monthly = { ...weekly, schedule_frequency: 'monthly', weeks_ahead: 2 }
  const r = await S.nextOpenSlot(stubDb({ settings: monthly, topics: ['2026-10-12', '2026-10-19', '2026-10-26'] }), 'c')
  assert.equal(r.date, '2026-11-02')
})

