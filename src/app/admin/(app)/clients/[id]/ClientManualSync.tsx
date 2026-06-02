'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

type SyncJob = { jobType: 'manual' | 'backfill'; days?: number; label: string; adsOnly?: boolean }

const SYNC_JOBS: SyncJob[] = [
  { jobType: 'manual',   days: 3,   label: 'Sync 3 days'                },
  { jobType: 'manual',   days: 7,   label: 'Sync 7 days'                },
  { jobType: 'manual',   days: 30,  label: 'Sync 30 days'               },
  { jobType: 'manual',   days: 90,  label: 'Sync 90 days'               },
  { jobType: 'backfill',            label: 'Full backfill (2 yrs)'       },
  { jobType: 'backfill', adsOnly: true, label: 'Ads backfill (2 yrs — Google + Meta only)' },
]

type JobStatus = {
  id: string
  source_label: string
  status: 'running' | 'success' | 'error' | string
  records_synced: number
  started_at: string
  completed_at: string | null
  error_message: string | null
  progress_pct: number
  progress_note: string | null
}

export default function ClientManualSync({ clientId }: { clientId: string }) {
  const router = useRouter()
  const [status,      setStatus]      = useState<'idle' | 'syncing' | 'done' | 'error'>('idle')
  const [records,     setRecords]     = useState<number | null>(null)
  const [error,       setError]       = useState('')
  const [activeLabel, setActiveLabel] = useState('')
  const [elapsed,     setElapsed]     = useState(0)
  const [excludeGsc,  setExcludeGsc]  = useState(false)
  const [adsOnly,     setAdsOnly]     = useState(false)
  const [jobStatuses, setJobStatuses] = useState<JobStatus[]>([])
  const sinceRef  = useRef<string | null>(null)
  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null)

  const isSyncing = status === 'syncing'

  // Elapsed timer
  useEffect(() => {
    if (!isSyncing) { setElapsed(0); return }
    const id = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(id)
  }, [isSyncing])

  // Per-source polling
  useEffect(() => {
    if (!isSyncing) {
      if (pollRef.current) clearInterval(pollRef.current)
      return
    }
    pollRef.current = setInterval(async () => {
      if (!sinceRef.current) return
      try {
        const res  = await fetch(`/api/admin/sync/status?clientId=${clientId}&since=${encodeURIComponent(sinceRef.current)}`)
        if (!res.ok) return
        const jobs = await res.json() as JobStatus[]
        if (Array.isArray(jobs)) setJobStatuses(jobs)
      } catch { /* ignore polling errors */ }
    }, 2000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [isSyncing, clientId])

  async function handleSync(job: SyncJob) {
    sinceRef.current  = new Date().toISOString()
    setStatus('syncing')
    setActiveLabel(job.label)
    setError('')
    setRecords(null)
    setJobStatuses([])
    try {
      const body: Record<string, unknown> = { clientId, jobType: job.jobType, excludeGsc, adsOnly: job.adsOnly ?? adsOnly }
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
        throw new Error(
          res.status === 504
            ? 'Sync timed out (>5 min). Data was partially saved. Try a shorter date range.'
            : `Server error (${res.status})`
        )
      }
      if (!res.ok) throw new Error(data.error || 'Sync failed')
      // Final poll to get completed statuses
      if (sinceRef.current) {
        try {
          const finalRes  = await fetch(`/api/admin/sync/status?clientId=${clientId}&since=${encodeURIComponent(sinceRef.current)}`)
          if (finalRes.ok) {
            const finalJobs = await finalRes.json() as JobStatus[]
            if (Array.isArray(finalJobs)) setJobStatuses(finalJobs)
          }
        } catch { /* ignore */ }
      }
      setRecords(data.records ?? 0)
      setStatus('done')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }

  function statusIcon(s: string) {
    if (s === 'success') return <span style={{ color: 'var(--green)' }}>✓</span>
    if (s === 'error')   return <span style={{ color: 'var(--red)' }}>✗</span>
    if (s === 'running') return <span style={{ color: 'var(--blue)' }}>⏳</span>
    return <span style={{ color: 'var(--text-faint)' }}>⬜</span>
  }

  return (
    <div className="space-y-3">
      {/* Sync buttons */}
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

      {/* Options */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          <input
            type="checkbox"
            checked={excludeGsc}
            onChange={e => setExcludeGsc(e.target.checked)}
            disabled={isSyncing}
            style={{ width: 14, height: 14 }}
          />
          Skip Search Console (faster sync)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          <input
            type="checkbox"
            checked={adsOnly}
            onChange={e => setAdsOnly(e.target.checked)}
            disabled={isSyncing}
            style={{ width: 14, height: 14 }}
          />
          Ads only (Google + Meta, skip GHL/GA4/GSC)
        </label>
      </div>

      {/* Progress bar + per-source status */}
      {isSyncing && (
        <div>
          <style>{`
            @keyframes syncSlide {
              0%   { transform: translateX(-150%); }
              100% { transform: translateX(350%); }
            }
          `}</style>

          {jobStatuses.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {jobStatuses.map(j => {
                const pct        = j.progress_pct ?? 0
                const isDeterminate = j.status === 'running' && pct > 0
                const isSuccess  = j.status === 'success'
                const isError    = j.status === 'error'
                const barPct     = isSuccess ? 100 : isError ? pct : pct
                return (
                  <div key={j.id}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', marginBottom: 3 }}>
                      {statusIcon(j.status)}
                      <span style={{ color: 'var(--text-primary)', minWidth: 110 }}>{j.source_label}</span>
                      {isSuccess && <span style={{ color: 'var(--text-muted)' }}>{(j.records_synced ?? 0).toLocaleString()} records</span>}
                      {isError   && j.error_message && <span style={{ color: 'var(--red)' }} title={j.error_message}>error</span>}
                      {j.status === 'running' && isDeterminate && (
                        <span style={{ color: 'var(--text-muted)' }}>{pct}%</span>
                      )}
                      {j.status === 'running' && !isDeterminate && (
                        <span style={{ color: 'var(--text-muted)' }}>starting…</span>
                      )}
                    </div>
                    {/* Progress bar: determinate if pct > 0, indeterminate otherwise */}
                    <div style={{ height: 4, borderRadius: 2, background: 'var(--bg-subtle)', overflow: 'hidden', position: 'relative' }}>
                      {isDeterminate || isSuccess ? (
                        <div style={{
                          height: '100%', borderRadius: 2,
                          width: `${barPct}%`,
                          background: isError ? 'var(--red)' : 'var(--blue)',
                          transition: 'width 0.4s ease',
                        }} />
                      ) : j.status === 'running' ? (
                        <div style={{
                          position: 'absolute', top: 0, left: 0, height: '100%', width: '40%',
                          background: 'var(--blue)', borderRadius: 2,
                          animation: 'syncSlide 1.4s ease-in-out infinite',
                        }} />
                      ) : null}
                    </div>
                    {/* Chunk note for running Meta jobs */}
                    {j.status === 'running' && j.progress_note && (
                      <p style={{ fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: 2 }}>{j.progress_note}</p>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div>
              <div style={{ height: 4, borderRadius: 2, background: 'var(--bg-subtle)', overflow: 'hidden', position: 'relative' }}>
                <div style={{
                  position: 'absolute', top: 0, left: 0, height: '100%', width: '40%',
                  background: 'var(--blue)', borderRadius: 2,
                  animation: 'syncSlide 1.4s ease-in-out infinite',
                }} />
              </div>
              <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
                Syncing <strong>{activeLabel}</strong>… {elapsed}s elapsed. Do not close or refresh.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Final status */}
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
