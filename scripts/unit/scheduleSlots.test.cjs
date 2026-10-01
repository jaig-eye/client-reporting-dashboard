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
        is: (col, v) => { if (v === null) q.isNull = true; return chain },
        maybeSingle: async () => ({ data: q.isNull ? global : settings, error: null }),
        then: (res) => res({
          data: table === 'content_topics' ? topics.map(d => ({ target_publish_date: d })) : suppressed.map(d => ({ target_publish_date: d })),
          error: null,
        }),
      }
      return chain
    },
  }
}

const weekly = { schedule_frequency: 'weekly', schedule_day_of_week: 1, weeks_ahead: 4, monthly_publish_day: null, schedule_start_date: null, posts_per_run: 1, auto_generate: true }

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
