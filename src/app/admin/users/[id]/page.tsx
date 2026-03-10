// Edit User — /admin/users/[id]
// Super admin only. Edit name, email, role, active status, and reset password.

import { createAdminClient } from '@/lib/supabase/server'
import { getAdminSession } from '@/lib/auth'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import type { User } from '@/lib/types'
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
    .select('id, name, email, role, is_active, avatar_url, created_at')
    .eq('id', id)
    .single()

  if (!data) notFound()
  const user = data as User

  return (
    <div className="max-w-md">
      <div className="flex items-center gap-2 mb-6 text-sm">
        <Link href="/admin/users" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
          Users
        </Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{user.name}</span>
      </div>

      <EditUserForm user={user} />
    </div>
  )
}
