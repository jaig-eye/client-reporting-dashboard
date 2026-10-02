const test = require('node:test'); const assert = require('node:assert/strict')
const path = require('path')
const F = require(path.join(process.env.WT, 'src/lib/content/clientOverviewFlags.ts'))
const C = require(path.join(process.env.WT, 'src/lib/content/cadence.ts'))

// A healthy running client: nothing to flag.
const ok = (over = {}) => ({
  autoGenerate: true, frequency: 'weekly', scheduleStartDate: '2026-08-03',
  site: { platform: 'WordPress', name: 'example.com', status: 'active' },
  openDates: 0, plannedFuture: 4, reviewOverdue: 0, pushErrors: 0, imageErrors: 0, seoMetaLost: 0,
  ...over,
})
const keys = facts => F.overviewFlags(facts).map(f => f.key)

test('a healthy client has no flags', () => {
  assert.deepEqual(keys(ok()), [])
  assert.deepEqual(keys(ok({ autoGenerate: false, plannedFuture: 0 })), [])
})

test('each problem raises its own issue', () => {
  assert.deepEqual(keys(ok({ site: null })), ['no_site'])
  assert.deepEqual(keys(ok({ site: { platform: 'WordPress', name: 'x.com', status: 'paused' } })), ['site_inactive'])
  assert.deepEqual(keys(ok({ openDates: 2 })), ['planner_behind'])
  assert.deepEqual(keys(ok({ reviewOverdue: 3 })), ['review_overdue'])
  assert.deepEqual(keys(ok({ pushErrors: 1 })), ['push_error'])
  assert.deepEqual(keys(ok({ imageErrors: 1 })), ['image_error'])
  assert.deepEqual(keys(ok({ seoMetaLost: 2 })), ['seo_meta'])
  assert.deepEqual(keys(ok({ frequency: 'biweekly', scheduleStartDate: null })), ['biweekly_anchor'])
  for (const f of F.overviewFlags(ok({ openDates: 2, reviewOverdue: 1, site: null }))) {
    assert.equal(f.level, 'issue')
    assert.ok(f.tip.length > 40, `${f.key} explains what to do`)
  }
})

test('a broken connection is one flag, not also "no site"; with automation off it still counts', () => {
  const broken = { platform: 'BigCommerce', name: 'store', status: 'error' }
  assert.deepEqual(keys(ok({ site: broken })), ['site_inactive'])
  assert.deepEqual(keys(ok({ autoGenerate: false, plannedFuture: 0, site: broken })), ['site_inactive'])
  assert.match(F.overviewFlags(ok({ site: broken }))[0].label, /in error/)
})

test('automation-only problems stay quiet while automation is off', () => {
  assert.deepEqual(keys(ok({ autoGenerate: false, plannedFuture: 0, openDates: 5 })), [])
})

test('no site and draft-only publishing are issues whether or not automation runs', () => {
  assert.deepEqual(keys(ok({ autoGenerate: false, plannedFuture: 0, site: null })), ['no_site'])
  assert.deepEqual(keys(ok({ draftOnly: true })), ['draft_only'])
  assert.deepEqual(keys(ok({ autoGenerate: false, plannedFuture: 0, draftOnly: true })), ['draft_only'])
  // A broken connection says more than its mode.
  assert.deepEqual(keys(ok({ draftOnly: true, site: { platform: 'WordPress', name: 'x.com', status: 'error' } })), ['site_inactive'])
})

test('paused with topics still planned is info, not an issue', () => {
  const flags = F.overviewFlags(ok({ autoGenerate: false, plannedFuture: 3 }))
  assert.deepEqual(flags.map(f => [f.key, f.level]), [['paused_with_plan', 'info']])
  assert.equal(F.issueCount(flags), 0)
})

test('a read that failed raises nothing rather than a false alarm', () => {
  assert.deepEqual(keys(ok({
    site: undefined, openDates: null, plannedFuture: null, reviewOverdue: null,
    pushErrors: null, imageErrors: null, seoMetaLost: null,
  })), [])
})

test('monthly needs no anchor: no start date is not a problem', () => {
  assert.deepEqual(keys(ok({ frequency: 'monthly', scheduleStartDate: null })), [])
  assert.deepEqual(keys(ok({ frequency: 'monthly_mid', scheduleStartDate: null })), [])
})

test('clients with issues sort first, then by name; info alone does not lift a client', () => {
  const issue = [{ key: 'x', level: 'issue', label: '', tip: '' }]
  const info  = [{ key: 'y', level: 'info', label: '', tip: '' }]
  const sorted = F.sortOverviewRows([
    { name: 'Alpha', flags: [] }, { name: 'Zeta', flags: issue }, { name: 'Beta', flags: info }, { name: 'Gamma', flags: issue },
  ])
  assert.deepEqual(sorted.map(r => r.name), ['Gamma', 'Zeta', 'Alpha', 'Beta'])
})

test('open dates: room left per date, suppressed dates never open', () => {
  const slots = ['2026-10-05', '2026-10-12', '2026-10-19']
  assert.equal(F.countOpenDates(slots, ['2026-10-05'], [], 1), 2)
  assert.equal(F.countOpenDates(slots, ['2026-10-05', '2026-10-12'], ['2026-10-19'], 1), 0)
  // Two posts a date: one topic on a date still leaves room.
  assert.equal(F.countOpenDates(slots, ['2026-10-05', '2026-10-05', '2026-10-12'], [], 2), 2)
  // Out-of-range per-date values clamp to 1..10 as the planner does.
  assert.equal(F.countOpenDates(slots, [], [], 0), 3)
})

test('schedule in words', () => {
  assert.equal(C.cadenceLabel({ schedule_frequency: 'weekly', schedule_day_of_week: 2 }), 'Weekly on Tuesdays')
  assert.equal(C.cadenceLabel({ schedule_frequency: 'monthly', schedule_day_of_week: 1, posts_per_run: 3 }), 'Monthly on the first Monday, 3 posts each date')
  assert.equal(C.cadenceLabel({ schedule_frequency: 'monthly_mid' }), 'Monthly on the 15th')
  assert.equal(C.planningWindowLabel('weekly', 4), '4 weeks ahead')
  assert.equal(C.planningWindowLabel('biweekly', 2), '4 weeks ahead')
  assert.equal(C.planningWindowLabel('monthly', 1), '1 month ahead')
  assert.equal(C.planningWindowLabel('daily', null), '1 day ahead')
})

test('open dates the planner hasn’t had a run for wait for the next run, not flagged as behind', () => {
  const now = new Date('2026-10-02T19:20:00Z')        // the last run was 18:00 UTC
  // Space Coast: switched to monthly with four months ahead at 18:30, so Dec 7 and Jan 4 are new.
  assert.deepEqual(F.splitOpenDates(['2026-12-07', '2027-01-04'], 112, '2026-10-02T18:30:00Z', now),
    { behind: [], waiting: ['2026-12-07', '2027-01-04'] })
  // The same dates with the schedule saved yesterday: they have been in the window for weeks.
  assert.deepEqual(F.splitOpenDates(['2026-12-07'], 112, '2026-10-01T09:00:00Z', now), { behind: ['2026-12-07'], waiting: [] })
  // No save since: a date that entered the window before 18:00 is behind, one that entered after waits.
  assert.deepEqual(F.splitOpenDates(['2026-10-30', '2026-11-01'], 28, null, now), { behind: ['2026-10-30'], waiting: ['2026-11-01'] })
})

test('open dates are listed, not just counted', () => {
  assert.deepEqual(F.openDatesIn(['2026-12-07', '2027-01-04'], [], [], 1), ['2026-12-07', '2027-01-04'])
  assert.deepEqual(F.openDatesIn(['2026-10-05', '2026-10-12'], ['2026-10-05'], ['2026-10-12'], 1), [])
})

