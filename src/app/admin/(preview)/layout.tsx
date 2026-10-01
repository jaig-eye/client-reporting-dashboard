// Admin Preview Layout — the admin frame around /admin/preview/* (the client dashboard as a client
// sees it). Flush: no padding or width cap, so the dashboard uses the full page.

import '@/styles/admin.css'
import { getAdminSession } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { getAgencySettings } from '@/lib/agency-settings'
import AdminShell from '@/components/admin/AdminShell'
import NavigationRefresher from '@/components/admin/NavigationRefresher'

export default async function PreviewLayout({ children }: { children: React.ReactNode }) {
  const db = createAdminClient()
  // Identity from the SIGNED session, never the admin_user_id cookie. That cookie
  // is client-editable, so the sidebar could be made to show a colleague's name and
  // avatar, and the super-admin flag flipped on simply by
  // deleting it — the UI lying about privilege in both directions. It is also
  // dropped unreliably in the cross-origin iframe, so a stale value could outlive
  // the session that set it.
  const adminSession = await getAdminSession()
  const userId = adminSession?.userId ?? null

  const [settings, sessionUserResult] = await Promise.all([
    getAgencySettings() as unknown as Promise<{ agency_name?: string; agency_logo_url?: string | null }>,
    userId
      ? db.from('users').select('name, email, avatar_url').eq('id', userId).single()
      : Promise.resolve({ data: null }),
  ])

  const sessionUser = sessionUserResult.data

  return (
    <AdminShell
      flush
      agencyName={settings.agency_name ?? 'My Agency'}
      agencyLogoUrl={settings.agency_logo_url ?? undefined}
      userName={sessionUser?.name   ?? 'Super Admin'}
      userEmail={sessionUser?.email ?? 'Master account'}
      userAvatarUrl={sessionUser?.avatar_url ?? undefined}
      isSuperAdmin={adminSession?.isSuperAdmin === true}
    >
      {/* The preview is the client dashboard, which reloads its data per page the way the real
          one does. */}
      <NavigationRefresher />
      {children}
    </AdminShell>
  )
}
