'use client'

// Sync trigger button for a specific client connection.
// Calls the sync API route and shows loading/success/error state with a progress bar.

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

  const isLoading = status === 'loading'

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: '0.25rem', minWidth: 72 }}>
      <button
        onClick={handleSync}
        disabled={isLoading}
        className="btn btn-secondary"
        style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem', opacity: isLoading ? 0.7 : 1 }}
      >
        {isLoading ? 'Syncing…' : status === 'success' ? 'Synced ✓' : status === 'error' ? 'Error ✗' : 'Sync'}
      </button>
      {isLoading && (
        <div style={{ height: 3, borderRadius: 2, background: 'var(--border)', overflow: 'hidden', position: 'relative' }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, height: '100%', width: '40%',
            background: 'var(--blue)', borderRadius: 2,
            animation: 'syncSlide 1.4s ease-in-out infinite',
          }} />
          <style>{`@keyframes syncSlide { 0% { left: -40%; } 100% { left: 100%; } }`}</style>
        </div>
      )}
    </div>
  )
}
