'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const SOURCE_OPTIONS = [
  { value: 'all',                    label: 'All Sources'          },
  { value: 'google_ads',             label: 'Google Ads'           },
  { value: 'meta_ads',               label: 'Meta Ads'             },
  { value: 'google_search_console',  label: 'Search Console'       },
  { value: 'google_analytics_4',     label: 'Google Analytics 4'   },
  { value: 'google_business',        label: 'Google Business'      },
  { value: 'ahrefs',                 label: 'Ahrefs'               },
  { value: 'content',                label: 'Content & Schedule'   },
]

export default function DataPurgeButton({ clientId, clientName }: { clientId: string; clientName: string }) {
  const router = useRouter()

  // Purge state
  const [source,      setSource]      = useState('all')
  const [confirm,     setConfirm]     = useState('')
  const [purgeStatus, setPurgeStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [purgeMsg,    setPurgeMsg]    = useState('')

  // Delete client state
  const [deleteStep,    setDeleteStep]    = useState<'idle' | 'confirm'>('idle')
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError,   setDeleteError]   = useState('')

  const purgeReady = confirm === 'DELETE'

  async function handlePurge() {
    if (!purgeReady) return
    setPurgeStatus('loading')
    setPurgeMsg('')
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/purge?source=${source}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Purge failed')
      setPurgeMsg(`Purged ${(data.totalPurged ?? 0).toLocaleString()} rows.`)
      setPurgeStatus('done')
      setConfirm('')
      router.refresh()
    } catch (e) {
      setPurgeMsg(e instanceof Error ? e.message : String(e))
      setPurgeStatus('error')
    }
  }

  async function handleDelete() {
    setDeleteLoading(true)
    setDeleteError('')
    const res = await fetch(`/api/admin/clients/${clientId}`, { method: 'DELETE' })
    if (res.ok) {
      window.location.href = '/admin/dashboard'
    } else {
      const d = await res.json().catch(() => ({}))
      setDeleteError(d.error || 'Failed to delete client')
      setDeleteLoading(false)
      setDeleteStep('idle')
    }
  }

  return (
    <div className="card p-5" style={{ borderColor: 'var(--red)', borderWidth: 1 }}>
      <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--red)' }}>Danger Zone</h3>

      {/* ── Purge Data ── */}
      <div style={{ marginTop: '1rem' }}>
        <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Purge Synced Data</p>
        <p className="text-xs mb-3" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Permanently delete synced data for a source. Client settings, connections, and configuration are kept.
          This cannot be undone.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>
              Select source to purge
            </label>
            <select
              className="input"
              style={{ fontSize: '0.8125rem', padding: '0.375rem 0.5rem' }}
              value={source}
              onChange={e => { setSource(e.target.value); setConfirm(''); setPurgeStatus('idle'); setPurgeMsg('') }}
              disabled={purgeStatus === 'loading'}
            >
              {SOURCE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>
              Type <strong>DELETE</strong> to confirm
            </label>
            <input
              className="input"
              style={{ fontSize: '0.8125rem', padding: '0.375rem 0.5rem', maxWidth: 200 }}
              placeholder="DELETE"
              value={confirm}
              onChange={e => { setConfirm(e.target.value); setPurgeStatus('idle'); setPurgeMsg('') }}
              disabled={purgeStatus === 'loading'}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button
              className="btn btn-danger"
              style={{ fontSize: '0.8125rem', padding: '0.375rem 0.875rem', opacity: purgeReady ? 1 : 0.45 }}
              onClick={handlePurge}
              disabled={!purgeReady || purgeStatus === 'loading'}
            >
              {purgeStatus === 'loading' ? 'Purging…' : 'Purge Data'}
            </button>
            {purgeStatus === 'done' && (
              <span className="text-xs" style={{ color: 'var(--green)' }}>✓ {purgeMsg}</span>
            )}
            {purgeStatus === 'error' && (
              <span className="text-xs" style={{ color: 'var(--red)' }}>{purgeMsg}</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Divider ── */}
      <div style={{ borderTop: '1px solid var(--border)', margin: '1.25rem 0' }} />

      {/* ── Delete Client ── */}
      <div>
        <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Delete Client</p>
        <p className="text-xs mb-3" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Deleting this client will remove all their data sources and sync history. Metrics data is also removed.
          This cannot be undone.
        </p>

        {deleteStep === 'confirm' ? (
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
            {deleteError && <p className="text-xs mb-2" style={{ color: 'var(--red)' }}>{deleteError}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleDelete}
                disabled={deleteLoading}
                className="btn btn-danger"
                style={{ fontSize: '0.8rem', padding: '0.375rem 0.75rem' }}
              >
                {deleteLoading ? 'Deleting…' : 'Yes, delete everything'}
              </button>
              <button
                onClick={() => setDeleteStep('idle')}
                className="btn btn-secondary"
                style={{ fontSize: '0.8rem', padding: '0.375rem 0.75rem' }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setDeleteStep('confirm')}
            className="btn btn-danger"
            style={{ fontSize: '0.8rem', padding: '0.375rem 0.75rem' }}
          >
            Delete Client
          </button>
        )}
      </div>
    </div>
  )
}
