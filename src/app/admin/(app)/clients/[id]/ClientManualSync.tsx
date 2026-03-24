'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type SyncJob = { jobType: 'manual' | 'backfill'; days?: number; label: string }

const SYNC_JOBS: SyncJob[] = [
  { jobType: 'manual',   days: 30,  label: 'Sync 30 days'  },
  { jobType: 'manual',   days: 90,  label: 'Sync 90 days'  },
  { jobType: 'backfill',            label: 'Full backfill (2 yrs)' },
]

export default function ClientManualSync({ clientId }: { clientId: string }) {
  const router = useRouter()
  const [status,       setStatus]       = useState<'idle' | 'syncing' | 'done' | 'error'>('idle')
  const [records,      setRecords]      = useState<number | null>(null)
  const [error,        setError]        = useState('')
  const [activeLabel,  setActiveLabel]  = useState('')

  async function handleSync(job: SyncJob) {
    setStatus('syncing')
    setActiveLabel(job.label)
    setError('')
    setRecords(null)
    try {
      const body: Record<string, unknown> = { clientId, jobType: job.jobType }
      if (job.days) body.days = job.days
      const res = await fetch('/api/admin/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {SYNC_JOBS.map(job => (
          <button
            key={job.label}
            onClick={() => handleSync(job)}
            disabled={status === 'syncing'}
            className="btn btn-primary"
            style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
          >
            {status === 'syncing' && activeLabel === job.label ? 'Syncing…' : job.label}
          </button>
        ))}
      </div>
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