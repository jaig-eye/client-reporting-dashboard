// Admin Preview Layout — sidebar shell for /admin/preview/* pages.
// Full-width main area (no max-w-5xl constraint) so dashboard content renders properly.

import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import Sidebar from '@/components/admin/Sidebar'
import NavigationRefresher from '@/components/admin/NavigationRefresher'

export default async function PreviewLayout({ children }: { children: React.ReactNode }) {
  const db = createAdminClient()
  const cookieStore = await cookies()
  const userId = cookieStore.get('admin_user_id')?.value

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
        isSuperAdmin={!userId}
      />
      <NavigationRefresher />
      {/* Full-width — no max-w or padding so dashboard content uses full viewport */}
      <div className="flex-1 min-w-0 overflow-auto">
        {children}
      </div>
    </div>
  )
}
