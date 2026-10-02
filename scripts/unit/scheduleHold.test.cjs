const test = require('node:test'); const assert = require('node:assert/strict')
const path = require('path')
const H = require(path.join(process.env.WT, 'src/lib/content/scheduleHold.ts'))

const weeklyMon  = { frequency: 'weekly',  dayOfWeek: 1, scheduleStartDate: null }
const monthlyMon = { frequency: 'monthly', dayOfWeek: 1, scheduleStartDate: null }

test('weekly to monthly moves the dates and strands the weekly plan, all but the first Monday', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T12:00:00Z') })
  assert.equal(H.cadenceMoved(weeklyMon, monthlyMon), true)
  const planned = ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']
  assert.deepEqual(H.offScheduleDates(planned, monthlyMon), ['2026-10-12', '2026-10-19', '2026-10-26'])
})

test('a change that keeps the dates is not a move', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T12:00:00Z') })
  // The weekday means nothing on a fixed-date monthly schedule.
  assert.equal(H.cadenceMoved({ frequency: 'monthly_mid', dayOfWeek: 1, scheduleStartDate: null }, { frequency: 'monthly_mid', dayOfWeek: 4, scheduleStartDate: null }), false)
  assert.equal(H.cadenceMoved(weeklyMon, { ...weeklyMon }), false)
})

test('going back to the schedule the plan was made for strands nothing, so the hold lifts', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T12:00:00Z') })
  assert.deepEqual(H.offScheduleDates(['2026-10-05', '2026-10-12', '2026-11-30'], weeklyMon), [])
  assert.deepEqual(H.offScheduleDates([], monthlyMon), [])
})

test('the schedule the cron would use: the client’s own, else the agency default', () => {
  assert.deepEqual(H.resolveCadence(null, { schedule_frequency: 'biweekly', schedule_day_of_week: 3 }), { frequency: 'biweekly', dayOfWeek: 3, scheduleStartDate: null })
  assert.deepEqual(H.resolveCadence({ schedule_frequency: 'monthly', schedule_day_of_week: null, schedule_start_date: '2026-09-01' }, null), { frequency: 'monthly', dayOfWeek: 1, scheduleStartDate: '2026-09-01' })
})

test('planned means waiting for its date: not live, not turned down', () => {
  assert.ok(!H.PLANNED_STATUSES.includes('published'))
  assert.ok(!H.PLANNED_STATUSES.includes('rejected'))
  assert.ok(H.PLANNED_STATUSES.includes('pending') && H.PLANNED_STATUSES.includes('approved'))
})
