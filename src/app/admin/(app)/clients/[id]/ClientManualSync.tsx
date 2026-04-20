'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

type SyncJob = { jobType: 'manual' | 'backfill'; days?: number; label: string }

const SYNC_JOBS: SyncJob[] = [
  { jobType: 'manual',   days: 30,  label: 'Sync 30 days'       },
  { jobType: 'manual',   days: 90,  label: 'Sync 90 days'       },
  { jobType: 'backfill',            label: 'Full backfill (2 yrs)' },
]

export default function ClientManualSync({ clientId }: { clientId: string }) {
  const router = useRouter()
  const [status,      setStatus]      = useState<'idle' | 'syncing' | 'done' | 'error'>('idle')
  const [records,     setRecords]     = useState<number | null>(null)
  const [error,       setError]       = useState('')
  const [activeLabel, setActiveLabel] = useState('')
  const [elapsed,     setElapsed]     = useState(0)

  const isSyncing = status === 'syncing'

  useEffect(() => {
    if (!isSyncing) { setElapsed(0); return }
    const id = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(id)
  }, [isSyncing])

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
      let data: { ok?: boolean; records?: number; error?: string } = {}
      try {
        data = await res.json()
      } catch {
        // Vercel returns a plain-text page on 504 timeout — not valid JSON
        throw new Error(
          res.status === 504
            ? 'Sync timed out (>5 min). Data was partially saved. Try a shorter date range or sync a single connector.'
            : `Server error (${res.status})`
        )
      }
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
    <div className="space-y-2">
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {SYNC_JOBS.map(job => (
          <button
            key={job.label}
            onClick={() => handleSync(job)}
            disabled={isSyncing}
            className="btn btn-primary"
            style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem', opacity: isSyncing ? 0.6 : 1 }}
          >
            {isSyncing && activeLabel === job.label ? 'Syncing…' : job.label}
          </button>
        ))}
      </div>

      {/* Progress bar */}
      {isSyncing && (
        <div>
          {/* Indeterminate bar */}
          <div style={{
            height: 4,
            borderRadius: 2,
            background: 'var(--bg-subtle)',
            overflow: 'hidden',
            position: 'relative',
          }}>
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              height: '100%',
              width: '40%',
              background: 'var(--blue)',
              borderRadius: 2,
              animation: 'syncSlide 1.4s ease-in-out infinite',
            }} />
          </div>
          <style>{`
            @keyframes syncSlide {
              0%   { transform: translateX(-150%); }
              100% { transform: translateX(350%); }
            }
          `}</style>
          <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
            Syncing <strong>{activeLabel}</strong>… {elapsed}s elapsed. Do not close or refresh.
          </p>
        </div>
      )}

      {status === 'done' && records !== null && (
        <p className="text-xs" style={{ color: 'var(--green)' }}>
          ✓ Done — {records.toLocaleString()} rows synced
        </p>
      )}
      {status === 'error' && (
        <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>
      )}
    </div>
  )
}
