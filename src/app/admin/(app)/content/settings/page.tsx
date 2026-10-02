// /admin/content/settings — global content settings, opened from Settings on the main content
// page. Renders ContentSettingsPanel.

import '@/styles/admin/content.css'
import { cookies }             from 'next/headers'
import { redirect }            from 'next/navigation'
import { isAdminAuthed }       from '@/lib/auth'
import { createAdminClient }   from '@/lib/supabase/server'
import PageHeader              from '@/components/ui/PageHeader'
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
      <PageHeader
        back={{ href: '/admin/content', label: 'Content' }}
        title="Content settings"
        description="For every client: how posts are written, and how the team hears about them."
      />
      <GlobalContentSettings clients={allClients} />
    </div>
  )
}
