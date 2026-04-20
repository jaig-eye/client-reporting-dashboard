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
]

export default function DataPurgeButton({ clientId }: { clientId: string }) {
  const router = useRouter()
  const [source,    setSource]    = useState('all')
  const [confirm,   setConfirm]   = useState('')
  const [status,    setStatus]    = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [message,   setMessage]   = useState('')

  const ready = confirm === 'DELETE'

  async function handlePurge() {
    if (!ready) return
    setStatus('loading')
    setMessage('')
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/purge?source=${source}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Purge failed')
      setMessage(`Purged ${(data.totalPurged ?? 0).toLocaleString()} rows.`)
      setStatus('done')
      setConfirm('')
      router.refresh()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }

  return (
    <div className="card p-5" style={{ borderColor: 'var(--red)', borderWidth: 1 }}>
      <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--red)' }}>Danger Zone</h3>
      <p className="text-xs mb-4" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Permanently delete all synced metric data for this client. Client settings, connections,
        and configuration are kept. This cannot be undone.
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
            onChange={e => { setSource(e.target.value); setConfirm(''); setStatus('idle'); setMessage('') }}
            disabled={status === 'loading'}
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
            onChange={e => { setConfirm(e.target.value); setStatus('idle'); setMessage('') }}
            disabled={status === 'loading'}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            className="btn btn-danger"
            style={{ fontSize: '0.8125rem', padding: '0.375rem 0.875rem', opacity: ready ? 1 : 0.45 }}
            onClick={handlePurge}
            disabled={!ready || status === 'loading'}
          >
            {status === 'loading' ? 'Purging…' : 'Purge Data'}
          </button>
          {status === 'done' && (
            <span className="text-xs" style={{ color: 'var(--green)' }}>✓ {message}</span>
          )}
          {status === 'error' && (
            <span className="text-xs" style={{ color: 'var(--red)' }}>{message}</span>
          )}
        </div>
      </div>
    </div>
  )
}
