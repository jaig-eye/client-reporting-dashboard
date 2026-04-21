// Admin Layout — sidebar shell for all protected /admin/* pages

export const dynamic = 'force-dynamic'

import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import Sidebar from '@/components/admin/Sidebar'
import NavigationRefresher from '@/components/admin/NavigationRefresher'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const db = createAdminClient()
  const cookieStore = await cookies()
  const userId = cookieStore.get('admin_user_id')?.value

  // Resolve the current user — super admin has no userId cookie
  const [settingsResult, sessionUserResult] = await Promise.all([
    db.from('agency_settings').select('agency_name, agency_logo_url, app_version').single(),
    userId
      ? db.from('users').select('name, email, avatar_url').eq('id', userId).single()
      : Promise.resolve({ data: null }),
  ])

  const settings = settingsResult.data ?? { agency_name: 'My Agency', agency_logo_url: null, app_version: '2.0.0' }
  const sessionUser = sessionUserResult.data

  // Show the logged-in user's details; fall back to "Super Admin" for the master account
  const userName   = sessionUser?.name   ?? 'Super Admin'
  const userEmail  = sessionUser?.email  ?? 'Master account'
  const avatarUrl  = sessionUser?.avatar_url ?? undefined

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <Sidebar
        agencyName={settings.agency_name}
        agencyLogoUrl={settings.agency_logo_url ?? undefined}
        appVersion={(settings as Record<string, unknown>).app_version as string ?? '2.0.0'}
        userName={userName}
        userEmail={userEmail}
        userAvatarUrl={avatarUrl}
        isSuperAdmin={!userId}
      />
      <NavigationRefresher />
      <div className="flex-1 min-w-0">
        <main className="p-8">{children}</main>
      </div>
    </div>
  )
}
