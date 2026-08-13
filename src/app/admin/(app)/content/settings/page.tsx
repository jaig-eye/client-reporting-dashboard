// /admin/content/settings — global content settings, opened from the ⚙ Settings
// action on the main content page. Renders the existing ContentSettingsPanel.

import { cookies }             from 'next/headers'
import { redirect }            from 'next/navigation'
import { isAdminAuthed }       from '@/lib/auth'
import { createAdminClient }   from '@/lib/supabase/server'
import GlobalContentSettings   from '../ContentSettingsPanel'

export const dynamic = 'force-dynamic'

export default async function ContentSettingsPage() {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) redirect('/admin/login')

  const db = createAdminClient()
  const { data } = await db.from('clients').select('id, name').order('name')
  const allClients = (data ?? []) as { id: string; name: string }[]

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <a href="/admin/content" style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', textDecoration: 'none' }}>← Back to Content</a>
        <h1 className="page-title" style={{ margin: 0 }}>Content Settings</h1>
      </div>
      <GlobalContentSettings clients={allClients} />
    </div>
  )
}
