'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function DeleteUserButton({ userId, userName }: { userId: string; userName: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [deleting,   setDeleting]   = useState(false)

  async function handleDelete() {
    setDeleting(true)
    const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' })
    if (res.ok) {
      router.refresh()
    } else {
      const d = await res.json().catch(() => ({}))
      alert(d.error || 'Failed to delete user')
      setDeleting(false)
      setConfirming(false)
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Delete {userName}?</span>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="btn btn-danger"
          style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
        >
          {deleting ? '…' : 'Yes'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="btn btn-secondary"
          style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
        >
          No
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="btn btn-danger"
      style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
    >
      Delete
    </button>
  )
}
