export const dynamic = 'force-dynamic'

import { createAdminClient } from '@/lib/supabase/server'
import AlertsPage from '@/components/admin/AlertsPage'

export default async function AdminAlertsPage() {
  const db = createAdminClient()

  const [alertsRes, unreadCountRes, totalCountRes] = await Promise.all([
    db.from('admin_alerts')
      .select('id, type, severity, client_id, client_name, title, body, meta, link_url, read_at, created_at')
      .is('dismissed_at', null)
      .order('created_at', { ascending: false })
      .limit(100),
    db.from('admin_alerts')
      .select('type')
      .is('read_at', null)
      .is('dismissed_at', null),
    db.from('admin_alerts')
      .select('type')
      .is('dismissed_at', null),
  ])

  const alerts = (alertsRes.data ?? []) as {
    id: string; type: string; severity: string
    client_id: string | null; client_name: string | null
    title: string; body: string | null; meta: Record<string, unknown>
    link_url: string | null; read_at: string | null; created_at: string
  }[]

  const unreadRows = (unreadCountRes.data ?? []) as { type: string }[]
  const byTypeUnread: Record<string, number> = { ad_insights: 0, ad_fuel: 0, content: 0, integration: 0 }
  for (const r of unreadRows) {
    if (r.type in byTypeUnread) byTypeUnread[r.type]++
  }

  const totalRows = (totalCountRes.data ?? []) as { type: string }[]
  const byTypeTotal: Record<string, number> = { ad_insights: 0, ad_fuel: 0, content: 0, integration: 0 }
  for (const r of totalRows) {
    if (r.type in byTypeTotal) byTypeTotal[r.type]++
  }

  const initialCounts      = { total: unreadRows.length, byType: byTypeUnread }
  const initialTotalCounts = { total: totalRows.length,  byType: byTypeTotal }

  return <AlertsPage initialAlerts={alerts} initialCounts={initialCounts} initialTotalCounts={initialTotalCounts} />
}
