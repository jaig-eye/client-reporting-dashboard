// Admin Layout - Sidebar shell for all /admin/* pages

import { createAdminClient } from '@/lib/supabase/server'
import Sidebar from '@/components/admin/Sidebar'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const db = createAdminClient()

  const [settingsResult, userResult] = await Promise.all([
    db.from('agency_settings').select('agency_name, agency_logo_url, app_version').single(),
    db.from('users').select('name, email, avatar_url').eq('role', 'admin').eq('is_active', true)
      .order('created_at', { ascending: true }).limit(1).maybeSingle(),
  ])

  const settings = settingsResult.data ?? { agency_name: 'My Agency', agency_logo_url: null, app_version: '2.0.0' }
  const user = userResult.data ?? { name: 'Admin', email: '', avatar_url: null }

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <Sidebar
        agencyName={settings.agency_name}
        agencyLogoUrl={settings.agency_logo_url ?? undefined}
        appVersion={(settings as Record<string, unknown>).app_version as string ?? '2.0.0'}
        userName={user.name}
        userEmail={user.email}
        userAvatarUrl={user.avatar_url ?? undefined}
      />
      <div className="flex-1 min-w-0">
        <main className="p-8 max-w-5xl">{children}</main>
      </div>
    </div>
  )
}
