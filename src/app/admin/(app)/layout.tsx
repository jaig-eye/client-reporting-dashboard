// Admin Layout — the frame (sidebar, or top bar + drawer on small screens) for every protected
// /admin/* page.

export const dynamic = 'force-dynamic'

import '@/styles/admin.css'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getAdminSession } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { getAgencySettings } from '@/lib/agency-settings'
import AdminShell from '@/components/admin/AdminShell'
import ThemeProvider from '@/components/ThemeProvider'
import type { ThemeMode } from '@/components/ThemeProvider'
import PaymentNotifier from '@/components/admin/PaymentNotifier'
import ThemeScript from '@/components/admin/ThemeScript'

// Agency settings come from the cached reader (tagged 'agency-settings', busted when settings are
// saved): the layout used to query them twice per page, once here and once for the metadata.
type Branding = { agency_name?: string; agency_logo_url?: string | null; favicon_url?: string | null; brand_primary?: string | null; payment_sound_url?: string | null }

export async function generateMetadata(): Promise<Metadata> {
  try {
    const s = (await getAgencySettings()) as unknown as Branding
    return {
      title: s.agency_name ? `${s.agency_name} Admin` : 'Agency Admin',
      ...(s.favicon_url ? { icons: { icon: s.favicon_url } } : {}),
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

  const [settings, sessionUserResult, alertCountResult] = await Promise.all([
    getAgencySettings() as unknown as Promise<Branding>,
    userId
      ? db.from('users').select('name, email, avatar_url, theme, accent_color').eq('id', userId).single()
      : Promise.resolve({ data: null }),
    db.from('admin_alerts')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null)
      .is('dismissed_at', null),
  ])

  const sessionUser      = sessionUserResult.data as Record<string, unknown> | null
  const unreadAlertCount = alertCountResult.count ?? 0

  const brandPrimary  = settings.brand_primary ?? '#2563eb'
  const initialMode   = (sessionUser?.theme as ThemeMode | null) ?? 'light'
  const initialAccent = (sessionUser?.accent_color as string | null) ?? brandPrimary

  return (
    <ThemeProvider initialMode={initialMode} initialAccent={initialAccent}>
      {/* Sets the theme before the first paint, so dark mode no longer flashes light on a reload. */}
      <ThemeScript mode={initialMode} accent={initialAccent} />
      <PaymentNotifier soundUrl={settings.payment_sound_url ?? null} />
      <AdminShell
        agencyName={settings.agency_name ?? 'My Agency'}
        agencyLogoUrl={settings.agency_logo_url ?? undefined}
        userName={(sessionUser?.name as string | undefined) ?? 'Super Admin'}
        userEmail={(sessionUser?.email as string | undefined) ?? 'Master account'}
        userAvatarUrl={(sessionUser?.avatar_url as string | undefined) ?? undefined}
        isSuperAdmin={adminSession.isSuperAdmin === true}
        unreadAlertCount={unreadAlertCount}
      >
        {children}
      </AdminShell>
    </ThemeProvider>
  )
}
