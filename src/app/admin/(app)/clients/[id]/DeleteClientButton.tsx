'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function DeleteClientButton({ clientId, clientName }: { clientId: string; clientName: string }) {
  const router = useRouter()
  const [step,     setStep]     = useState<'idle' | 'confirm'>('idle')
  const [deleting, setDeleting] = useState(false)
  const [error,    setError]    = useState('')

  async function handleDelete() {
    setDeleting(true)
    setError('')
    const res = await fetch(`/api/admin/clients/${clientId}`, { method: 'DELETE' })
    if (res.ok) {
      window.location.href = '/admin/clients'
    } else {
      const d = await res.json().catch(() => ({}))
      setError(d.error || 'Failed to delete client')
      setDeleting(false)
      setStep('idle')
    }
  }

  if (step === 'confirm') {
    return (
      <div
        className="rounded-xl p-4"
        style={{ background: 'var(--red-subtle)', border: '1px solid #fecaca' }}
      >
        <p className="text-sm font-medium mb-1" style={{ color: 'var(--red)' }}>
          Delete {clientName}?
        </p>
        <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
          This will permanently delete the client and all their synced data
          (metrics, connections, sync history). This cannot be undone.
        </p>
        {error && <p className="text-xs mb-2" style={{ color: 'var(--red)' }}>{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="btn btn-danger"
            style={{ fontSize: '0.8rem', padding: '0.375rem 0.75rem' }}
          >
            {deleting ? 'Deleting…' : 'Yes, delete everything'}
          </button>
          <button
            onClick={() => setStep('idle')}
            className="btn btn-secondary"
            style={{ fontSize: '0.8rem', padding: '0.375rem 0.75rem' }}
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      onClick={() => setStep('confirm')}
      className="btn btn-danger"
      style={{ fontSize: '0.8rem', padding: '0.375rem 0.75rem' }}
    >
      Delete Client
    </button>
  )
}
