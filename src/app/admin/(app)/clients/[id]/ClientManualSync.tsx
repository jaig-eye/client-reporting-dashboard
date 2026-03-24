'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function ClientManualSync({ clientId }: { clientId: string }) {
  const router = useRouter()
  const [status,  setStatus]  = useState<'idle' | 'syncing' | 'done' | 'error'>('idle')
  const [records, setRecords] = useState<number | null>(null)
  const [error,   setError]   = useState('')

  async function handleSync() {
    setStatus('syncing')
    setError('')
    setRecords(null)
    try {
      const res = await fetch('/api/admin/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, jobType: 'manual', days: 30 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sync failed')
      setRecords(data.records ?? 0)
      setStatus('done')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }

  return (
    <div>
      <button
        onClick={handleSync}
        disabled={status === 'syncing'}
        className="btn btn-primary"
        style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
      >
        {status === 'syncing' ? 'Syncing…' : 'Sync Now (30 days)'}
      </button>
      {status === 'done' && records !== null && (
        <p className="text-xs mt-1" style={{ color: 'var(--green)' }}>
          Done — {records.toLocaleString()} rows synced
        </p>
      )}
      {status === 'error' && (
        <p className="text-xs mt-1" style={{ color: 'var(--red)' }}>{error}</p>
      )}
    </div>
  )
}
