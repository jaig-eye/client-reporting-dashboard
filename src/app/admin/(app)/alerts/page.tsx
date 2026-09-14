export const dynamic = 'force-dynamic'

import { createAdminClient } from '@/lib/supabase/server'
import AlertsPage from '@/components/admin/AlertsPage'
import type { Alert, AlertIndexRow } from '@/components/admin/alerts/inbox'

const INDEX_CHUNK = 1000

export default async function AdminAlertsPage() {
  const db = createAdminClient()

  // The light index of every open alert, fetched in chunks so it isn't capped at PostgREST's row
  // limit. Counts, the client filter and view-wide actions come from this; bodies load a page at a time.
  async function loadIndex(): Promise<AlertIndexRow[]> {
    const rows: AlertIndexRow[] = []
    for (let from = 0; ; from += INDEX_CHUNK) {
      const { data, error } = await db
        .from('admin_alerts')
        .select('id, type, severity, client_id, client_name, read_at, created_at')
        .is('dismissed_at', null)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, from + INDEX_CHUNK - 1)
      if (error || !data) break
      rows.push(...(data as AlertIndexRow[]))
      if (data.length < INDEX_CHUNK) break
    }
    return rows
  }

  const [alertsRes, index] = await Promise.all([
    db.from('admin_alerts')
      .select('id, type, severity, client_id, client_name, title, body, meta, link_url, read_at, created_at')
      .is('dismissed_at', null)
      .order('created_at', { ascending: false })
      .limit(100),
    loadIndex(),
  ])

  const alerts = (alertsRes.data ?? []) as Alert[]

  return <AlertsPage initialAlerts={alerts} initialIndex={index} />
}
