// Admin Layout — sidebar shell for all protected /admin/* pages

export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getAdminSession } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import Sidebar from '@/components/admin/Sidebar'
import NavigationRefresher from '@/components/admin/NavigationRefresher'
import ThemeProvider from '@/components/ThemeProvider'
import type { ThemeMode } from '@/components/ThemeProvider'
import PaymentNotifier from '@/components/admin/PaymentNotifier'

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
  // Identity from the SIGNED session, never the admin_user_id cookie. That cookie
  // is client-editable, so the sidebar could be made to show a colleague's name and
  // avatar, and the super-admin flag flipped on simply by
  // deleting it — the UI lying about privilege in both directions. It is also
  // dropped unreliably in the cross-origin iframe, so a stale value could outlive
  // the session that set it.
  const adminSession = await getAdminSession()

  // No session means unauthenticated, deactivated, or revoked (getAdminSession
  // enforces is_active and the password_changed_at cutoff). Without this redirect
  // the layout carried on and every `?? default` below took over: the shell rendered
  // in full and the sidebar labelled the visitor "Super Admin / Master account",
  // which is both a broken gate and the most misleading possible way to fail.
  // Middleware bounces these requests first; this is the defence in depth that does
  // not depend on the matcher staying correct.
  if (!adminSession) redirect('/admin')

  const userId = adminSession.userId ?? null

  // Resolve current user, agency settings, and unread alert count concurrently
  const [settingsResult, sessionUserResult, alertCountResult] = await Promise.all([
    db.from('agency_settings').select('agency_name, agency_logo_url, app_version, brand_primary, payment_sound_url').single(),
    userId
      ? db.from('users').select('name, email, avatar_url, theme, accent_color').eq('id', userId).single()
      : Promise.resolve({ data: null }),
    db.from('admin_alerts')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null)
      .is('dismissed_at', null),
  ])

  const settings         = settingsResult.data    ?? { agency_name: 'My Agency', agency_logo_url: null, app_version: '2.0.0', brand_primary: null, payment_sound_url: null }
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
          isSuperAdmin={adminSession?.isSuperAdmin === true}
          unreadAlertCount={unreadAlertCount}
        />
        <NavigationRefresher />
        <PaymentNotifier soundUrl={(settings as Record<string, unknown>).payment_sound_url as string | null} />
        <div className="flex-1 min-w-0">
          <main className="p-8">{children}</main>
        </div>
      </div>
    </ThemeProvider>
  )
}
