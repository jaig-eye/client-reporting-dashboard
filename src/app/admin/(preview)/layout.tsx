// Admin Preview Layout — sidebar shell for /admin/preview/* pages.
// Full-width main area (no max-w-5xl constraint) so dashboard content renders properly.

import { getAdminSession } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import Sidebar from '@/components/admin/Sidebar'
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

  const [settingsResult, sessionUserResult] = await Promise.all([
    db.from('agency_settings').select('agency_name, agency_logo_url, app_version').single(),
    userId
      ? db.from('users').select('name, email, avatar_url').eq('id', userId).single()
      : Promise.resolve({ data: null }),
  ])

  const settings    = settingsResult.data ?? { agency_name: 'My Agency', agency_logo_url: null, app_version: '2.0.0' }
  const sessionUser = sessionUserResult.data

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <Sidebar
        agencyName={settings.agency_name}
        agencyLogoUrl={settings.agency_logo_url ?? undefined}
        appVersion={(settings as Record<string, unknown>).app_version as string ?? '2.0.0'}
        userName={sessionUser?.name   ?? 'Super Admin'}
        userEmail={sessionUser?.email ?? 'Master account'}
        userAvatarUrl={sessionUser?.avatar_url ?? undefined}
        isSuperAdmin={adminSession?.isSuperAdmin === true}
      />
      <NavigationRefresher />
      {/* Full-width — no max-w or padding so dashboard content uses full viewport */}
      <div className="flex-1 min-w-0 overflow-auto">
        {children}
      </div>
    </div>
  )
}
