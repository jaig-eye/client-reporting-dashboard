// Daily cron — checks all active clients for 14-day metric anomalies vs prior 14 days.
// Inserts metric_alerts rows for significant changes; optionally sends email summary.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient }         from '@/lib/supabase/server'
import { summarizeMetrics }          from '@/lib/metrics'
import { sendEmail }                 from '@/lib/email'

export const maxDuration = 120

const METRICS_TO_CHECK = ['spend', 'cpa', 'roas', 'ctr', 'conversions'] as const
type MetricKey = typeof METRICS_TO_CHECK[number]

function extractMetric(summary: ReturnType<typeof summarizeMetrics>, key: MetricKey): number {
  switch (key) {
    case 'spend':       return summary.spend
    case 'cpa':         return summary.cpl          // cost per lead = CPA
    case 'roas':        return summary.roas
    case 'ctr':         return summary.ctr
    case 'conversions': return summary.conversions
  }
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

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  const [agencyRes, clientsRes] = await Promise.all([
    db.from('agency_settings')
      .select('notify_metric_alerts, metric_alert_threshold, metric_alert_window_days, notification_email, agency_name, ai_provider, ai_model, ai_api_key')
      .single(),
    db.from('clients').select('id, name'),
  ])

  const agency      = agencyRes.data as Record<string, unknown> | null
  const threshold   = Number(agency?.metric_alert_threshold ?? 0.40)
  const windowDays  = Math.max(1, Number(agency?.metric_alert_window_days ?? 14))
  const clients     = (clientsRes.data ?? []) as { id: string; name: string }[]

  const now    = new Date()
  const d14    = new Date(now.getTime() - windowDays * 86_400_000).toISOString().slice(0, 10)
  const d28    = new Date(now.getTime() - windowDays * 2 * 86_400_000).toISOString().slice(0, 10)

  const newAlerts: { clientId: string; clientName: string; metric: string; currentVal: number; priorVal: number; pctChange: number; direction: string }[] = []

  for (const client of clients) {
    const [gCurr, mCurr, gPrior, mPrior] = await Promise.all([
      db.from('google_ads_metrics').select('spend,impressions,clicks,conversions,conversion_value')
        .eq('client_id', client.id).gte('date', d14),
      db.from('meta_ads_metrics').select('spend,impressions,clicks,conversions,conversion_value')
        .eq('client_id', client.id).gte('date', d14),
      db.from('google_ads_metrics').select('spend,impressions,clicks,conversions,conversion_value')
        .eq('client_id', client.id).gte('date', d28).lt('date', d14),
      db.from('meta_ads_metrics').select('spend,impressions,clicks,conversions,conversion_value')
        .eq('client_id', client.id).gte('date', d28).lt('date', d14),
    ])

    const currRows  = [...(gCurr.data ?? []), ...(mCurr.data ?? [])] as Parameters<typeof summarizeMetrics>[0]
    const priorRows = [...(gPrior.data ?? []), ...(mPrior.data ?? [])] as Parameters<typeof summarizeMetrics>[0]

    // Skip if no meaningful data
    if (currRows.length === 0 && priorRows.length === 0) continue

    const curr  = summarizeMetrics(currRows)
    const prior = summarizeMetrics(priorRows)

    // Need at least some spend activity to avoid noise
    if (curr.spend < 10 && prior.spend < 10) continue

    for (const key of METRICS_TO_CHECK) {
      const cv = extractMetric(curr,  key)
      const pv = extractMetric(prior, key)
      if (cv === 0 && pv === 0) continue
      if (pv === 0) continue   // can't compute % change from zero

      const pct = (cv - pv) / pv
      if (Math.abs(pct) < threshold) continue

      // Skip if an undismissed alert already exists for this client+metric.
      // This prevents compounding: once dismissed, a new alert can fire next run.
      const { count } = await db
        .from('metric_alerts')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .eq('metric', key)
        .is('dismissed_at', null)

      if ((count ?? 0) > 0) continue

      const direction = pct > 0 ? 'up' : 'down'

      // Simple insight without calling AI for now (AI call adds latency + cost)
      const pctLabel = `${Math.abs(pct * 100).toFixed(0)}%`
      const insight  = `${metricLabel(key)} ${direction === 'up' ? 'increased' : 'decreased'} ${pctLabel} over the last ${windowDays} days vs the prior ${windowDays} days, from ${formatVal(key, pv)} to ${formatVal(key, cv)}.`

      await db.from('metric_alerts').insert({
        client_id:   client.id,
        metric:      key,
        current_val: cv,
        prior_val:   pv,
        pct_change:  pct * 100,
        direction,
        insight,
      })

      newAlerts.push({ clientId: client.id, clientName: client.name, metric: key, currentVal: cv, priorVal: pv, pctChange: pct * 100, direction })
    }
  }

  // Send email summary if any alerts and notifications are on
  if (newAlerts.length > 0 && agency?.notify_metric_alerts && agency?.notification_email) {
    const agencyName = String(agency.agency_name || 'Agency Dashboard')
    const appUrl     = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
    const rows = newAlerts.map(a =>
      `<tr><td>${a.clientName}</td><td>${metricLabel(a.metric as MetricKey)}</td><td>${a.direction === 'up' ? '▲' : '▼'} ${Math.abs(a.pctChange).toFixed(0)}%</td><td>${formatVal(a.metric as MetricKey, a.priorVal)} → ${formatVal(a.metric as MetricKey, a.currentVal)}</td></tr>`
    ).join('')
    try {
      await sendEmail({
        to:      String(agency.notification_email),
        subject: `[${agencyName}] Metric Anomalies Detected — ${newAlerts.length} alert${newAlerts.length > 1 ? 's' : ''}`,
        html:    `<p>${newAlerts.length} metric anomal${newAlerts.length > 1 ? 'ies' : 'y'} detected across your clients (${windowDays}-day vs prior ${windowDays} days):</p>
                  <table border="1" cellpadding="6" style="border-collapse:collapse">
                    <tr><th>Client</th><th>Metric</th><th>Change</th><th>Values</th></tr>
                    ${rows}
                  </table>
                  <p><a href="${appUrl}/admin/clients">View Clients →</a></p>`,
      })
    } catch (e) {
      console.error('[metric-alerts] email error:', e)
    }
  }

  return NextResponse.json({ alerts: newAlerts.length, details: newAlerts })
}
