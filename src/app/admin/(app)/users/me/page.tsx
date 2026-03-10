// My Profile — /admin/users/me
// Regular admins update their name, email, avatar, and password here.
// Super admin is redirected — their account is environment-based and not editable.

import { getAdminSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import ProfileForm from './ProfileForm'

export const dynamic = 'force-dynamic'

export default async function MyProfilePage() {
  const session = await getAdminSession()

  // Super admin account is not stored in the DB — nothing to edit here
  if (!session) redirect('/admin/login')
  if (session.isSuperAdmin) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">My Profile</h1>
        </div>
        <div className="max-w-lg">
          <div className="card p-6">
            <h2 className="section-title mb-2">Super Admin Account</h2>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Your super admin account is managed via the{' '}
              <code
                className="rounded px-1 py-0.5 font-mono text-xs"
                style={{ background: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}
              >
                ADMIN_PASSWORD
              </code>{' '}
              environment variable. Account details are not editable here.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Load current user data to pre-fill form
  const db = createAdminClient()
  const { data: user } = await db
    .from('users')
    .select('id, name, email, avatar_url')
    .eq('id', session.userId!)
    .single()

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Profile</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Update your display name, password, and avatar.
          </p>
        </div>
      </div>

      <div className="max-w-lg">
        <ProfileForm
          userId={session.userId!}
          initialName={user?.name ?? ''}
          initialEmail={user?.email ?? ''}
          initialAvatarUrl={user?.avatar_url ?? ''}
        />
      </div>
    </div>
  )
}
