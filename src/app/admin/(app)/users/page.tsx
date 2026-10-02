// Users — /admin/users
// Admins and the super admin can add users. Editing, force-resetting and deleting other
// accounts stays with the super admin; everyone else can edit only their own profile.

import '@/styles/admin/users.css'
import { createAdminClient } from '@/lib/supabase/server'
import { getAdminSession } from '@/lib/auth'
import Link from 'next/link'
import { Plus, UsersThree } from '@phosphor-icons/react/dist/ssr'
import type { User } from '@/lib/types'
import PageHeader from '@/components/ui/PageHeader'
import StatusBadge from '@/components/ui/StatusBadge'
import EmptyState from '@/components/ui/EmptyState'
import Avatar from '@/components/ui/Avatar'
import UserRowActions from './UserRowActions'

export const dynamic = 'force-dynamic'

/** "Today", "Yesterday", "Sep 29", or "Apr 25, 2025" for another year. */
function signedIn(iso: string | null | undefined): string {
  if (!iso) return 'Never signed in'
  const d = new Date(iso)
  const now = new Date()
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 864e5)
  if (days <= 0) return 'Signed in today'
  if (days === 1) return 'Signed in yesterday'
  const sameYear = d.getFullYear() === now.getFullYear()
  return `Signed in ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })}`
}

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

  // Adding a team member is open to admins. Changing someone else's account is not: an edit
  // can set that account's password, which would let one admin sign in as another and act
  // under their name in the activity log.
  const canAddUsers = isSuperAdmin || session?.role === 'admin'
  const addButton = canAddUsers && (
    <Link href="/admin/users/new" className="btn btn-primary"><Plus size={15} weight="bold" aria-hidden />Add user</Link>
  )

  return (
    <div>
      <PageHeader
        title="Users"
        description={isSuperAdmin
          ? 'Everyone on your team who can sign in to the admin.'
          : canAddUsers ? 'Everyone on your team who can sign in. You can add people.' : 'Everyone on your team who can sign in.'}
        actions={addButton}
      />

      {isSuperAdmin && (
        <div className="ui-notice ui-notice--info">
          You’re signed in as the super admin. That account is set in the server’s configuration, so it isn’t listed here.
        </div>
      )}

      <div className="card" style={{ padding: users.length ? '0 0 4px' : 0, overflow: 'hidden' }}>
        {users.length === 0 ? (
          <EmptyState icon={<UsersThree size={22} weight="duotone" />} title="No users yet" actions={addButton}>
            Add your team so they can sign in with their email and a password.
          </EmptyState>
        ) : (
          <>
            <div className="us-head" aria-hidden>
              <span>Name</span><span>Role</span><span>Status</span><span>Last signed in</span><span />
            </div>
            <ul className="us-list" aria-label="Users">
              {users.map(user => {
                const isMe = session?.userId === user.id
                return (
                  <li key={user.id} className="us-row">
                    <div className="us-who">
                      <Avatar name={user.name} url={user.avatar_url} size={36} muted={!user.is_active} />
                      <div className="us-who-text">
                        <p className="us-name"><span>{user.name}</span>{isMe && <span className="us-you">You</span>}</p>
                        <p className="us-email" title={user.email}>{user.email}</p>
                      </div>
                    </div>
                    <div className="us-meta">
                      <div className="us-role">
                        <StatusBadge tone={user.role === 'admin' ? 'info' : 'neutral'} dot={false}>
                          {user.role === 'admin' ? 'Admin' : user.role === 'viewer' ? 'Viewer' : user.role}
                        </StatusBadge>
                      </div>
                      <div className="us-status">
                        {user.is_active
                          ? <StatusBadge tone="success">Active</StatusBadge>
                          : <StatusBadge tone="neutral" title="This account can’t sign in">Inactive</StatusBadge>}
                        {user.must_reset_password && (
                          <StatusBadge tone="warning" title="Can’t sign in until they set a new password">Reset pending</StatusBadge>
                        )}
                      </div>
                      <div className="us-seen">{signedIn(user.last_login_at)}</div>
                    </div>
                    <div className="us-act">
                      {isSuperAdmin ? (
                        <UserRowActions userId={user.id} userName={user.name} isMe={isMe} resetPending={user.must_reset_password === true} />
                      ) : isMe ? (
                        <Link href="/admin/users/me" className="btn btn-secondary btn-sm">Edit</Link>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
