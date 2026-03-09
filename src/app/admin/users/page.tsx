// Users — /admin/users
// Multi-user management. Lists all admin users and provides links to edit profile.
// RBAC roles are defined in the schema (admin, viewer) — full enforcement can be
// added later without schema changes.

import { createAdminClient } from '@/lib/supabase/server'
import Link from 'next/link'
import type { User } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function UsersPage() {
  const db = createAdminClient()
  const { data } = await db
    .from('users')
    .select('id, name, email, role, is_active, avatar_url, last_login_at, created_at')
    .order('created_at')

  const users = (data ?? []) as User[]

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Agency admin accounts. Roles control access level.
          </p>
        </div>
        <Link href="/admin/users/new" className="btn btn-primary">
          + Add User
        </Link>
      </div>

      <div className="card overflow-hidden">
        {users.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm mb-1" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
              No users yet
            </p>
            <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
              The app currently uses environment variable authentication.
              Add users here to enable multi-user login.
            </p>
            <Link href="/admin/users/new" className="btn btn-primary">
              + Add User
            </Link>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last Login</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => {
                const initials = user.name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2)
                return (
                  <tr key={user.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        {user.avatar_url ? (
                          <img src={user.avatar_url} alt={user.name}
                            className="h-8 w-8 rounded-full object-cover flex-shrink-0" />
                        ) : (
                          <div
                            className="h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                            style={{ background: 'var(--blue)' }}
                          >
                            {initials}
                          </div>
                        )}
                        <div>
                          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {user.name}
                          </p>
                          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                            {user.email}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${user.role === 'admin' ? 'badge-blue' : 'badge-gray'}`}>
                        {user.role}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${user.is_active ? 'badge-green' : 'badge-gray'}`}>
                        {user.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {user.last_login_at
                          ? new Date(user.last_login_at).toLocaleDateString('en-US', {
                              month: 'short', day: 'numeric', year: 'numeric'
                            })
                          : 'Never'}
                      </span>
                    </td>
                    <td>
                      <Link
                        href={`/admin/users/${user.id}`}
                        className="btn btn-secondary"
                        style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
