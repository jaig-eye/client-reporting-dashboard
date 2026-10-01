const test = require('node:test'); const assert = require('node:assert/strict')
const path = require('path')
const F = require(path.join(process.env.WT, 'src/lib/content/clientOverviewFlags.ts'))
const C = require(path.join(process.env.WT, 'src/lib/content/cadence.ts'))

// A healthy running client: nothing to flag.
const ok = (over = {}) => ({
  autoGenerate: true, frequency: 'weekly', monthlyPublishDay: null, scheduleStartDate: '2026-08-03',
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
  assert.deepEqual(keys(ok({ frequency: 'monthly', scheduleStartDate: null })), ['monthly_drift'])
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
  assert.deepEqual(keys(ok({ autoGenerate: false, plannedFuture: 0, site: null, openDates: 5 })), [])
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

test('monthly with a publish day or start date, and fixed-day monthly, do not drift', () => {
  assert.deepEqual(keys(ok({ frequency: 'monthly', scheduleStartDate: null, monthlyPublishDay: 12 })), [])
  assert.deepEqual(keys(ok({ frequency: 'monthly', scheduleStartDate: '2026-09-12' })), [])
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
  assert.equal(C.cadenceLabel({ schedule_frequency: 'monthly', schedule_start_date: '2026-08-22', posts_per_run: 3 }), 'Monthly on the 22nd, 3 posts each date')
  assert.equal(C.planningWindowLabel('weekly', 4), '4 weeks ahead')
  assert.equal(C.planningWindowLabel('biweekly', 2), '4 weeks ahead')
  assert.equal(C.planningWindowLabel('monthly', 1), '1 month ahead')
  assert.equal(C.planningWindowLabel('daily', null), '1 day ahead')
})
