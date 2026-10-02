// Edit User — /admin/users/[id]
// Super admin only. Edit name, email, role, active status, and reset password.

import '@/styles/admin/users.css'
import { createAdminClient } from '@/lib/supabase/server'
import { getAdminSession } from '@/lib/auth'
import { notFound, redirect } from 'next/navigation'
import type { User } from '@/lib/types'
import PageHeader from '@/components/ui/PageHeader'
import Avatar from '@/components/ui/Avatar'
import EditUserForm from './EditUserForm'

export const dynamic = 'force-dynamic'

export default async function EditUserPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [session, { id }] = await Promise.all([getAdminSession(), params])

  // Only super admin can access this page
  if (!session?.isSuperAdmin) redirect('/admin/users')

  const db = createAdminClient()
  const { data } = await db
    .from('users')
    .select('id, name, email, username, role, is_active, avatar_url, created_at')
    .eq('id', id)
    .maybeSingle()

  if (!data) notFound()
  const user = data as User

  return (
    <div className="us-page">
      <PageHeader
        back={{ href: '/admin/users', label: 'Users' }}
        leading={<Avatar name={user.name} url={user.avatar_url} size={44} muted={!user.is_active} />}
        title={user.name}
        description={user.email}
      />
      <EditUserForm user={user} />
    </div>
  )
}
