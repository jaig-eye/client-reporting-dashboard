// Users — /admin/users
// Super admin sees all users with Edit + Delete controls, and can add new users.
// Regular admins see the list but can only navigate to their own profile.

import { createAdminClient } from '@/lib/supabase/server'
import { getAdminSession } from '@/lib/auth'
import Link from 'next/link'
import type { User } from '@/lib/types'
import DeleteUserButton from './DeleteUserButton'
import ForceResetButton from './ForceResetButton'

export const dynamic = 'force-dynamic'

export default async function UsersPage() {
  const session = await getAdminSession()
  const db = createAdminClient()

  const BASE = 'id, name, email, role, is_active, avatar_url, last_login_at, created_at'
  // must_reset_password arrives with migration 195. Falling back keeps the page
  // rendering on an environment where the code shipped first, rather than showing
  // an empty user list because one column is missing.
  let rows: unknown[] | null = null
  const withFlag = await db.from('users').select(`${BASE}, must_reset_password`).order('created_at')
  if (withFlag.error) {
    const fallback = await db.from('users').select(BASE).order('created_at')
    rows = fallback.data
  } else {
    rows = withFlag.data
  }

  const users = (rows ?? []) as (User & { must_reset_password?: boolean })[]
  const isSuperAdmin = session?.isSuperAdmin ?? false

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {isSuperAdmin
              ? 'Create and manage admin accounts for your team.'
              : 'Agency admin accounts.'}
          </p>
        </div>
        {isSuperAdmin && (
          <Link href="/admin/users/new" className="btn btn-primary">
            + Add User
          </Link>
        )}
      </div>

      {isSuperAdmin && (
        <div
          className="mb-4 rounded-xl px-4 py-3 text-sm"
          style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: 'var(--blue)' }}
        >
          You are signed in as <strong>Super Admin</strong>. Your account is managed via
          environment configuration and does not appear in this list.
        </div>
      )}

      <div className="card overflow-hidden">
        {users.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm mb-1 font-medium" style={{ color: 'var(--text-primary)' }}>
              No users yet
            </p>
            <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
              Create accounts for your team so they can sign in with email and password.
            </p>
            {isSuperAdmin && (
              <Link href="/admin/users/new" className="btn btn-primary">
                + Add User
              </Link>
            )}
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
                const initials = user.name.split(' ').map((p: string) => p[0]).join('').toUpperCase().slice(0, 2)
                const isMe = session?.userId === user.id

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
                            {isMe && (
                              <span className="ml-1.5 text-xs font-normal" style={{ color: 'var(--text-faint)' }}>
                                (you)
                              </span>
                            )}
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
                      {user.must_reset_password && (
                        <span
                          className="badge badge-gray ml-1.5"
                          title="Cannot sign in until they set a new password"
                        >
                          Reset pending
                        </span>
                      )}
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
                      <div className="flex items-center gap-2 justify-end">
                        {isSuperAdmin ? (
                          <Link
                            href={`/admin/users/${user.id}`}
                            className="btn btn-secondary"
                            style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
                          >
                            Edit
                          </Link>
                        ) : isMe ? (
                          <Link
                            href="/admin/users/me"
                            className="btn btn-secondary"
                            style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
                          >
                            Edit Profile
                          </Link>
                        ) : null}

                        {isSuperAdmin && !isMe && (
                          <ForceResetButton
                            userId={user.id}
                            userName={user.name}
                            alreadyPending={user.must_reset_password === true}
                          />
                        )}

                        {isSuperAdmin && (
                          <DeleteUserButton userId={user.id} userName={user.name} />
                        )}
                      </div>
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
