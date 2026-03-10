'use client'

// Sync trigger button for a specific client connection.
// Calls the sync API route and shows loading/success/error state.

import { useState } from 'react'

interface Props {
  clientId: string
  connectionId: string
}

export default function ClientSyncButton({ clientId, connectionId }: Props) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  async function handleSync() {
    setStatus('loading')
    try {
      const res = await fetch('/api/admin/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, connectionId, jobType: 'manual' }),
      })
      if (!res.ok) throw new Error('Sync failed')
      setStatus('success')
      setTimeout(() => setStatus('idle'), 3000)
    } catch {
      setStatus('error')
      setTimeout(() => setStatus('idle'), 4000)
    }
  }

  return (
    <button
      onClick={handleSync}
      disabled={status === 'loading'}
      className="btn btn-secondary"
      style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
    >
      {status === 'loading' ? 'Syncing…' : status === 'success' ? 'Synced ✓' : status === 'error' ? 'Error ✗' : 'Sync'}
    </button>
  )
}
