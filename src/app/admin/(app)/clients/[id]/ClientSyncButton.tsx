'use client'

// Syncs one of a client's connections now. When it finishes the page refreshes in place, so the
// row's "synced …" time updates without a reload.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowsCounterClockwise, Check, WarningCircle } from '@phosphor-icons/react'

interface Props {
  clientId: string
  connectionId: string
}

export default function ClientSyncButton({ clientId, connectionId }: Props) {
  const router = useRouter()
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
      router.refresh()
      setTimeout(() => setStatus('idle'), 3000)
    } catch {
      setStatus('error')
      setTimeout(() => setStatus('idle'), 4000)
    }
  }

  return (
    <button
      type="button"
      onClick={handleSync}
      disabled={status === 'loading'}
      className="btn btn-secondary btn-sm"
      aria-live="polite"
      title={status === 'error' ? 'The sync failed. System & logs has the details.' : 'Pull the latest data for this connection'}
      style={status === 'success' ? { color: 'var(--green-fg)' } : status === 'error' ? { color: 'var(--red-fg)' } : undefined}
    >
      {status === 'loading' ? <><ArrowsCounterClockwise size={13} className="int-spin" aria-hidden />Syncing…</>
       : status === 'success' ? <><Check size={13} weight="bold" aria-hidden />Synced</>
       : status === 'error'   ? <><WarningCircle size={13} weight="bold" aria-hidden />Failed</>
       : <><ArrowsCounterClockwise size={13} aria-hidden />Sync</>}
    </button>
  )
}
