// Daily cron — two-phase metric alert system.
// Phase 1 (daily / red alert): yesterday vs day-before, per platform, 50% default threshold.
// Phase 2 (weekly / notable change): 7d ending yesterday vs prior 7d, per platform, 25% default.
// Data accuracy: Google uses conversions_value column; Meta uses resolveMetaConversions
// for the client's configured action type rather than the pre-computed conversions sum.

import { NextRequest, NextResponse }      from 'next/server'
import { createAdminClient }              from '@/lib/supabase/server'
import { summarizeMetrics }               from '@/lib/metrics'
import { resolveMetaConversions }         from '@/lib/metrics'
import { sendEmail }                      from '@/lib/email'

export const maxDuration = 120

// ─── Types ────────────────────────────────────────────────────────────────────

type MetaAction = { action_type: string; value: string }

type GoogleRow = {
  spend:             number
  impressions:       number
  clicks:            number
  conversions:       number
  conversions_value: number   // note: plural — matches DB column
}

type MetaRow = {
  spend:        number
  impressions:  number
  clicks:       number
  actions:      MetaAction[] | null
  action_values: MetaAction[] | null
}

type MetricKey = 'spend' | 'cpa' | 'roas' | 'ctr' | 'conversions'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function offsetDay(base: Date, n: number): string {
  return new Date(base.getTime() + n * 86_400_000).toISOString().slice(0, 10)
}

function metricLabel(key: MetricKey): string {
  return { spend: 'Spend', cpa: 'CPA', roas: 'ROAS', ctr: 'CTR', conversions: 'Conversions' }[key]
}

function formatVal(key: MetricKey, val: number): string {
  if (key === 'spend' || key === 'cpa') return `$${val.toFixed(2)}`
  if (key === 'roas')                   return `${val.toFixed(2)}x`
  if (key === 'ctr')                    return `${(val * 100).toFixed(2)}%`
  return val.toFixed(0)
}

function extractMetric(summary: ReturnType<typeof summarizeMetrics>, key: MetricKey): number {
  switch (key) {
    case 'spend':       return summary.spend
    case 'cpa':         return summary.cpl
    case 'roas':        return summary.roas
    case 'ctr':         return summary.ctr
    case 'conversions': return summary.conversions
  }
}

// Map Google rows: conversions_value → conversion_value for summarizeMetrics
function normalizeGoogleRows(rows: GoogleRow[]): Parameters<typeof summarizeMetrics>[0] {
  return rows.map(r => ({
    spend:            Number(r.spend),
    impressions:      Number(r.impressions),
    clicks:           Number(r.clicks),
    conversions:      Number(r.conversions),
    conversion_value: Number(r.conversions_value ?? 0),
  }))
}

// Map Meta rows: resolve correct conversions via action type, not the pre-computed sum
function normalizeMetaRows(
  rows: MetaRow[],
  primaryAction: string,
  fallbackAction: string | null,
): Parameters<typeof summarizeMetrics>[0] {
  return rows.map(r => {
    const resolved = resolveMetaConversions(r.actions, r.action_values, primaryAction, fallbackAction)
    return {
      spend:            Number(r.spend),
      impressions:      Number(r.impressions),
      clicks:           Number(r.clicks),
      conversions:      resolved.conversions,
      conversion_value: resolved.conversionValue,
    }
  })
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  // ── Fetch settings + clients ───────────────────────────────────────────────
  const [agencyRes, clientsRes] = await Promise.all([
    db.from('agency_settings')
      .select([
        'notify_metric_alerts', 'notification_email', 'agency_name',
        'metric_alert_threshold', 'daily_alert_threshold',
        'daily_alert_metrics', 'weekly_alert_metrics',
        'default_lead_action', 'default_lead_action_fallback',
        'default_purchase_action', 'default_purchase_action_fallback',
      ].join(', '))
      .single(),
    db.from('clients')
      .select('id, name, discord_channel_id, layout_type, lead_action, lead_action_fallback, purchase_action, purchase_action_fallback'),
  ])

  const agency   = agencyRes.data  as Record<string, unknown> | null
  const clients  = (clientsRes.data ?? []) as {
    id: string; name: string
    discord_channel_id: string | null
    layout_type: string | null
    lead_action: string | null
    lead_action_fallback: string | null
    purchase_action: string | null
    purchase_action_fallback: string | null
  }[]

  const weeklyThreshold        = Number(agency?.metric_alert_threshold ?? 0.25)
  const dailyThreshold         = Number(agency?.daily_alert_threshold  ?? 0.50)
  const defaultPrimary         = String(agency?.default_lead_action              ?? 'onsite_conversion.lead_grouped')
  const defaultFallback        = String(agency?.default_lead_action_fallback     ?? 'lead')
  const defaultPurchasePrimary = String(agency?.default_purchase_action          ?? 'purchase')
  const defaultPurchaseFallback= String(agency?.default_purchase_action_fallback ?? 'omni_purchase')

  // ── Date anchors ─────────────────────────────────────────────────────────
  // Shift back 2 days instead of 1: Google conversion data is not finalized
  // until ~24h after the day closes, so a 4am cron reading "yesterday" gets
  // incomplete numbers. Using day-before-yesterday guarantees settled data.
  const now          = new Date()
  const yesterday    = offsetDay(now, -2)   // settled "yesterday" (2 days ago)
  const dayBefore    = offsetDay(now, -3)
  const w7start      = offsetDay(now, -8)   // 7-day window ending on settled yesterday
  const w7priorStart = offsetDay(now, -15)  // prior 7-day window

  // ── Auto-dismiss stale daily alerts (>48h, not yet dismissed) ─────────────
  const staleCutoff = new Date(Date.now() - 48 * 3_600_000).toISOString()
  await db.from('metric_alerts')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('alert_type', 'daily')
    .is('dismissed_at', null)
    .lt('created_at', staleCutoff)

  // ── Process each client ───────────────────────────────────────────────────
  const newAlerts: {
    clientId: string; clientName: string; metric: string
    currentVal: number; priorVal: number; pctChange: number
    direction: string; alertType: string; platform: string
  }[] = []

  const GOOGLE_SELECT = 'spend,impressions,clicks,conversions,conversions_value'
  const META_SELECT   = 'spend,impressions,clicks,actions,action_values'

  const DAILY_METRICS:  MetricKey[] = ((agency?.daily_alert_metrics  as MetricKey[] | null) ?? ['spend', 'conversions', 'cpa']).filter(m => ['spend','conversions','cpa','roas','ctr'].includes(m))
  const WEEKLY_METRICS: MetricKey[] = ((agency?.weekly_alert_metrics as MetricKey[] | null) ?? ['spend', 'conversions', 'cpa', 'roas', 'ctr']).filter(m => ['spend','conversions','cpa','roas','ctr'].includes(m))

  for (const client of clients) {
    const isEcom         = client.layout_type === 'ecom'
    const primaryAction  = isEcom
      ? (client.purchase_action          ?? defaultPurchasePrimary)
      : (client.lead_action              ?? defaultPrimary)
    const fallbackAction = isEcom
      ? (client.purchase_action_fallback ?? defaultPurchaseFallback)
      : (client.lead_action_fallback     ?? defaultFallback)

    // ── Fetch all 8 queries in parallel ────────────────────────────────────
    const [
      gYest, gDayBefore,
      mYest, mDayBefore,
      gCurr7, gPrior7,
      mCurr7, mPrior7,
    ] = await Promise.all([
      db.from('google_ads_metrics').select(GOOGLE_SELECT).eq('client_id', client.id).eq('date', yesterday),
      db.from('google_ads_metrics').select(GOOGLE_SELECT).eq('client_id', client.id).eq('date', dayBefore),
      db.from('meta_ads_metrics').select(META_SELECT).eq('client_id', client.id).eq('date', yesterday),
      db.from('meta_ads_metrics').select(META_SELECT).eq('client_id', client.id).eq('date', dayBefore),
      db.from('google_ads_metrics').select(GOOGLE_SELECT).eq('client_id', client.id).gte('date', w7start).lte('date', yesterday),
      db.from('google_ads_metrics').select(GOOGLE_SELECT).eq('client_id', client.id).gte('date', w7priorStart).lt('date', w7start),
      db.from('meta_ads_metrics').select(META_SELECT).eq('client_id', client.id).gte('date', w7start).lte('date', yesterday),
      db.from('meta_ads_metrics').select(META_SELECT).eq('client_id', client.id).gte('date', w7priorStart).lt('date', w7start),
    ])

    // ── Phase 1: Day-over-day (red alert) ──────────────────────────────────
    const dailyPlatforms: Array<{ platform: 'google' | 'meta'; currRows: Parameters<typeof summarizeMetrics>[0]; priorRows: Parameters<typeof summarizeMetrics>[0] }> = []

    if ((gYest.data?.length ?? 0) > 0 || (gDayBefore.data?.length ?? 0) > 0) {
      dailyPlatforms.push({
        platform:  'google',
        currRows:  normalizeGoogleRows((gYest.data ?? []) as GoogleRow[]),
        priorRows: normalizeGoogleRows((gDayBefore.data ?? []) as GoogleRow[]),
      })
    }
    if ((mYest.data?.length ?? 0) > 0 || (mDayBefore.data?.length ?? 0) > 0) {
      dailyPlatforms.push({
        platform:  'meta',
        currRows:  normalizeMetaRows((mYest.data ?? []) as MetaRow[], primaryAction, fallbackAction),
        priorRows: normalizeMetaRows((mDayBefore.data ?? []) as MetaRow[], primaryAction, fallbackAction),
      })
    }

    for (const { platform, currRows, priorRows } of dailyPlatforms) {
      if (currRows.length === 0) continue  // yesterday not synced yet — skip

      const curr  = summarizeMetrics(currRows)
      const prior = summarizeMetrics(priorRows)

      if (curr.spend < 5 && prior.spend < 5) continue

      for (const key of DAILY_METRICS) {
        const cv = extractMetric(curr,  key)
        const pv = extractMetric(prior, key)
        if (cv === 0 && pv === 0) continue
        if (pv === 0) continue
        if ((key === 'cpa' || key === 'conversions') && curr.conversions < 3 && prior.conversions < 3) continue

        const pct = (cv - pv) / pv
        if (Math.abs(pct) < dailyThreshold) continue

        // Same-day dedup: skip if undismissed daily alert for same client+metric+platform+date_label
        const { count } = await db.from('metric_alerts')
          .select('id', { count: 'exact', head: true })
          .eq('client_id', client.id).eq('metric', key)
          .eq('alert_type', 'daily').eq('platform', platform)
          .eq('date_label', yesterday)
          .is('dismissed_at', null)
        if ((count ?? 0) > 0) continue

        const direction = pct > 0 ? 'up' : 'down'
        const pctLabel  = `${Math.abs(pct * 100).toFixed(0)}%`
        const platformLabel = platform === 'google' ? 'Google Ads' : 'Meta Ads'
        const insight = `${platformLabel} ${metricLabel(key)} ${direction === 'up' ? 'increased' : 'decreased'} ${pctLabel} — ${formatVal(key, pv)} → ${formatVal(key, cv)} (${yesterday} vs ${dayBefore}).`

        await db.from('metric_alerts').insert({
          client_id:   client.id,
          metric:      key,
          current_val: cv,
          prior_val:   pv,
          pct_change:  pct * 100,
          direction,
          insight,
          alert_type:  'daily',
          platform,
          date_label:  yesterday,
        })

        const { error: alertErr } = await db.from('admin_alerts').insert({
          type:        'ad_insights',
          severity:    'warning',
          client_id:   client.id,
          client_name: client.name,
          title:       `${platformLabel} ${metricLabel(key)} ${direction === 'up' ? '▲' : '▼'} ${Math.abs(pct * 100).toFixed(0)}%`,
          body:        insight,
          meta:        { metric: key, current_val: cv, prior_val: pv, pct_change: pct * 100, direction, alert_type: 'daily', platform, date_label: yesterday },
          link_url:    `/admin/dashboard?highlight=${client.id}`,
        })
        if (alertErr) console.error(`[metric-alerts] admin_alerts insert failed for ${client.name}:`, alertErr)

        newAlerts.push({ clientId: client.id, clientName: client.name, metric: key, currentVal: cv, priorVal: pv, pctChange: pct * 100, direction, alertType: 'daily', platform })
      }
    }

    // ── Phase 2: 7v7 (notable change) ──────────────────────────────────────
    const weeklyPlatforms: Array<{ platform: 'google' | 'meta'; currRows: Parameters<typeof summarizeMetrics>[0]; priorRows: Parameters<typeof summarizeMetrics>[0] }> = []

    if ((gCurr7.data?.length ?? 0) > 0 || (gPrior7.data?.length ?? 0) > 0) {
      weeklyPlatforms.push({
        platform:  'google',
        currRows:  normalizeGoogleRows((gCurr7.data ?? []) as GoogleRow[]),
        priorRows: normalizeGoogleRows((gPrior7.data ?? []) as GoogleRow[]),
      })
    }
    if ((mCurr7.data?.length ?? 0) > 0 || (mPrior7.data?.length ?? 0) > 0) {
      weeklyPlatforms.push({
        platform:  'meta',
        currRows:  normalizeMetaRows((mCurr7.data ?? []) as MetaRow[], primaryAction, fallbackAction),
        priorRows: normalizeMetaRows((mPrior7.data ?? []) as MetaRow[], primaryAction, fallbackAction),
      })
    }

    for (const { platform, currRows, priorRows } of weeklyPlatforms) {
      const curr  = summarizeMetrics(currRows)
      const prior = summarizeMetrics(priorRows)

      if (curr.spend < 10 && prior.spend < 10) continue

      const clientWeeklyMetrics = isEcom ? WEEKLY_METRICS : WEEKLY_METRICS.filter(k => k !== 'roas')
      for (const key of clientWeeklyMetrics) {
        const cv = extractMetric(curr,  key)
        const pv = extractMetric(prior, key)
        if (cv === 0 && pv === 0) continue
        if (pv === 0) continue
        if ((key === 'cpa' || key === 'conversions') && curr.conversions < 5 && prior.conversions < 5) continue

        const pct = (cv - pv) / pv
        if (Math.abs(pct) < weeklyThreshold) continue

        // Weekly dedup: skip if already sent in the last 7 days (regardless of dismissed status)
        const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
        const { count } = await db.from('metric_alerts')
          .select('id', { count: 'exact', head: true })
          .eq('client_id', client.id).eq('metric', key)
          .eq('alert_type', 'weekly').eq('platform', platform)
          .gte('created_at', sevenDaysAgo)
        if ((count ?? 0) > 0) continue

        const direction = pct > 0 ? 'up' : 'down'
        const pctLabel  = `${Math.abs(pct * 100).toFixed(0)}%`
        const platformLabel = platform === 'google' ? 'Google Ads' : 'Meta Ads'
        const insight = `${platformLabel} ${metricLabel(key)} ${direction === 'up' ? 'increased' : 'decreased'} ${pctLabel} over the last 7 days vs the prior 7 days — ${formatVal(key, pv)} → ${formatVal(key, cv)}.`

        await db.from('metric_alerts').insert({
          client_id:   client.id,
          metric:      key,
          current_val: cv,
          prior_val:   pv,
          pct_change:  pct * 100,
          direction,
          insight,
          alert_type:  'weekly',
          platform,
          date_label:  null,
        })

        const { error: weeklyAlertErr } = await db.from('admin_alerts').insert({
          type:        'ad_insights',
          severity:    'info',
          client_id:   client.id,
          client_name: client.name,
          title:       `${platformLabel} ${metricLabel(key)} ${direction === 'up' ? '▲' : '▼'} ${Math.abs(pct * 100).toFixed(0)}% (7d)`,
          body:        insight,
          meta:        { metric: key, current_val: cv, prior_val: pv, pct_change: pct * 100, direction, alert_type: 'weekly', platform, date_label: null },
          link_url:    `/admin/dashboard?highlight=${client.id}`,
        })
        if (weeklyAlertErr) console.error(`[metric-alerts] admin_alerts weekly insert failed for ${client.name}:`, weeklyAlertErr)

        newAlerts.push({ clientId: client.id, clientName: client.name, metric: key, currentVal: cv, priorVal: pv, pctChange: pct * 100, direction, alertType: 'weekly', platform })
      }
    }
  }

  // ── Email digest ──────────────────────────────────────────────────────────
  if (newAlerts.length > 0 && agency?.notify_metric_alerts && agency?.notification_email) {
    const agencyName = String(agency.agency_name || 'Agency Dashboard')
    const appUrl     = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')

    const redAlerts    = newAlerts.filter(a => a.alertType === 'daily')
    const notableAlerts = newAlerts.filter(a => a.alertType === 'weekly')

    const buildRows = (alerts: typeof newAlerts) => alerts.map(a => {
      const dir = a.direction === 'up' ? '▲' : '▼'
      return `<tr>
        <td>${a.clientName}</td>
        <td>${a.platform === 'google' ? 'Google' : 'Meta'}</td>
        <td>${metricLabel(a.metric as MetricKey)}</td>
        <td>${dir} ${Math.abs(a.pctChange).toFixed(0)}%</td>
        <td>${formatVal(a.metric as MetricKey, a.priorVal)} → ${formatVal(a.metric as MetricKey, a.currentVal)}</td>
      </tr>`
    }).join('')

    const tableStyle = 'border="1" cellpadding="6" style="border-collapse:collapse;font-size:13px"'
    const tableHead  = '<tr><th>Client</th><th>Platform</th><th>Metric</th><th>Change</th><th>Values</th></tr>'

    let html = `<p>${newAlerts.length} metric alert${newAlerts.length > 1 ? 's' : ''} detected:</p>`
    if (redAlerts.length > 0) {
      html += `<p><strong>🔴 Red Alerts — Day-over-day (${yesterday} vs ${dayBefore})</strong></p>
               <table ${tableStyle}>${tableHead}${buildRows(redAlerts)}</table>`
    }
    if (notableAlerts.length > 0) {
      html += `<p><strong>🟡 Notable Changes — 7-day comparison</strong></p>
               <table ${tableStyle}>${tableHead}${buildRows(notableAlerts)}</table>`
    }
    html += `<p><a href="${appUrl}/admin/clients">View Clients →</a></p>`

    try {
      await sendEmail({
        to:      String(agency.notification_email),
        subject: `[${agencyName}] ${redAlerts.length > 0 ? '🔴 ' : ''}Metric Alerts — ${newAlerts.length} alert${newAlerts.length > 1 ? 's' : ''}`,
        html,
      })
    } catch (e) {
      console.error('[metric-alerts] email error:', e)
    }
  }

  return NextResponse.json({ alerts: newAlerts.length, details: newAlerts })
}
