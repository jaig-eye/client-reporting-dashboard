'use client'

// A user row's ⋯ menu (super admin): edit, require a password reset, delete. Reset and delete ask
// first, in a dialog that says what will happen, and report a failure there instead of an alert().

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PencilSimple, Key, Trash } from '@phosphor-icons/react'
import ActionMenu from '@/components/ui/ActionMenu'
import { ConfirmDialog } from '@/components/ui/Dialog'

export default function UserRowActions({ userId, userName, isMe, resetPending }: {
  userId: string
  userName: string
  isMe: boolean
  /** must_reset_password is already set, so the reset action resends the code. */
  resetPending: boolean
}) {
  const router = useRouter()
  const [asking, setAsking] = useState<'reset' | 'delete' | null>(null)
  const first = userName.split(' ')[0]

  async function reset() {
    const res = await fetch(`/api/admin/users/${userId}/force-reset`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sendEmail: true }),
    }).catch(() => null)
    const d = await res?.json().catch(() => ({})) as { ok?: boolean; message?: string; error?: string } | undefined
    // A partial success is real: the flag can land while the email fails. That stays open in the
    // dialog with the server's explanation, because the person is now blocked either way.
    router.refresh()
    if (!res) throw new Error('No answer from the server. Check your connection and try again.')
    if (!res.ok || d?.ok !== true) throw new Error(d?.message || d?.error || 'The reset didn’t go through.')
    setAsking(null)
  }

  async function remove() {
    const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' }).catch(() => null)
    if (!res) throw new Error('No answer from the server. Check your connection and try again.')
    if (!res.ok) {
      const d = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(d.error || `${userName} wasn’t deleted.`)
    }
    setAsking(null)
    router.refresh()
  }

  return (
    <>
      <ActionMenu
        label={`Actions for ${userName}`}
        width={240}
        items={[
          { key: 'edit', label: 'Edit', sub: 'Name, email, role and password', icon: <PencilSimple size={16} />, href: `/admin/users/${userId}` },
          ...(!isMe ? [{
            key: 'reset',
            label: resetPending ? 'Resend reset code' : 'Reset password',
            sub: resetPending ? 'Email a fresh code' : 'They choose a new one to sign in',
            icon: <Key size={16} />,
            onSelect: () => setAsking('reset' as const),
          }] : []),
          { key: 'delete', label: 'Delete', icon: <Trash size={16} />, danger: true, separated: true, onSelect: () => setAsking('delete') },
        ]}
      />

      <ConfirmDialog
        open={asking === 'reset'}
        onClose={() => setAsking(null)}
        title={resetPending ? `Send ${first} a new reset code?` : `Reset ${first}’s password?`}
        confirmLabel={resetPending ? 'Send code' : 'Reset password'}
        busyLabel="Sending…"
        onConfirm={reset}
      >
        {resetPending
          ? <p>{userName} still has to set a new password. This emails them a fresh code; the old one stops working.</p>
          : <p>{userName} won’t be able to sign in until they set a new password. We’ll email them a code now.</p>}
      </ConfirmDialog>

      <ConfirmDialog
        open={asking === 'delete'}
        onClose={() => setAsking(null)}
        title={`Delete ${userName}?`}
        confirmLabel="Delete user"
        busyLabel="Deleting…"
        tone="danger"
        onConfirm={remove}
      >
        <p>{isMe ? 'This is your own account. You’ll be signed out and won’t be able to sign back in.' : `${first} won’t be able to sign in again.`} This can’t be undone.</p>
      </ConfirmDialog>
    </>
  )
}
