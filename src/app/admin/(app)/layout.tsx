// Admin Layout — sidebar shell for all protected /admin/* pages

export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import Sidebar from '@/components/admin/Sidebar'
import NavigationRefresher from '@/components/admin/NavigationRefresher'
import ThemeProvider from '@/components/ThemeProvider'
import type { ThemeMode } from '@/components/ThemeProvider'

export async function generateMetadata(): Promise<Metadata> {
  try {
    const db = createAdminClient()
    const { data } = await db.from('agency_settings').select('favicon_url, agency_name').single()
    const faviconUrl  = (data as Record<string, unknown> | null)?.favicon_url as string | null
    const agencyName  = (data as Record<string, unknown> | null)?.agency_name  as string | null
    return {
      title:   agencyName ? `${agencyName} Admin` : 'Agency Admin',
      ...(faviconUrl ? { icons: { icon: faviconUrl } } : {}),
    }
  } catch {
    return { title: 'Agency Admin' }
  }
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const db = createAdminClient()
  const cookieStore = await cookies()
  const userId = cookieStore.get('admin_user_id')?.value

  // Resolve current user, agency settings, and unread alert count concurrently
  const [settingsResult, sessionUserResult, alertCountResult] = await Promise.all([
    db.from('agency_settings').select('agency_name, agency_logo_url, app_version, brand_primary').single(),
    userId
      ? db.from('users').select('name, email, avatar_url, theme, accent_color').eq('id', userId).single()
      : Promise.resolve({ data: null }),
    db.from('admin_alerts')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null)
      .is('dismissed_at', null),
  ])

  const settings         = settingsResult.data    ?? { agency_name: 'My Agency', agency_logo_url: null, app_version: '2.0.0', brand_primary: null }
  const sessionUser      = sessionUserResult.data
  const unreadAlertCount = alertCountResult.count ?? 0

  const userName   = sessionUser?.name   ?? 'Super Admin'
  const userEmail  = sessionUser?.email  ?? 'Master account'
  const avatarUrl  = (sessionUser as Record<string, unknown> | null)?.avatar_url as string | undefined

  const brandPrimary  = (settings as Record<string, unknown>).brand_primary as string | null ?? '#2563eb'
  const initialMode   = ((sessionUser as Record<string, unknown> | null)?.theme as ThemeMode | null) ?? 'light'
  const initialAccent = ((sessionUser as Record<string, unknown> | null)?.accent_color as string | null) ?? brandPrimary

  return (
    <ThemeProvider initialMode={initialMode} initialAccent={initialAccent}>
      <div className="flex min-h-screen" style={{ background: 'var(--bg-base)' }}>
        <Sidebar
          agencyName={settings.agency_name}
          agencyLogoUrl={settings.agency_logo_url ?? undefined}
          appVersion={(settings as Record<string, unknown>).app_version as string ?? '2.0.0'}
          userName={userName}
          userEmail={userEmail}
          userAvatarUrl={avatarUrl}
          isSuperAdmin={!userId}
          unreadAlertCount={unreadAlertCount}
        />
        <NavigationRefresher />
        <div className="flex-1 min-w-0">
          <main className="p-8">{children}</main>
        </div>
      </div>
    </ThemeProvider>
  )
}
