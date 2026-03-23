'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Connector } from '@/lib/types'

// Config fields shown per connector type
const CONFIG_FIELDS: Record<string, { key: string; label: string; placeholder: string; hint: string }[]> = {
  google_ads: [
    {
      key:         'mcc_customer_id',
      label:       'MCC Customer ID',
      placeholder: '1234567890',
      hint:        'Top-level manager account ID (digits only, no dashes).',
    },
  ],
  meta_ads: [
    {
      key:         'business_manager_id',
      label:       'Business Manager ID',
      placeholder: '1234567890',
      hint:        'Found in Meta Business Suite → Settings.',
    },
  ],
}

const REAUTH_HREF: Record<string, string> = {
  google_ads: '/api/auth/google',
  meta_ads:   '/api/auth/meta',
}

export default function EditConnectorForm({ connector }: { connector: Connector }) {
  const router  = useRouter()
  const config  = (connector.config ?? {}) as Record<string, string>
  const fields  = CONFIG_FIELDS[connector.type] ?? []

  const [label,      setLabel]      = useState(connector.label ?? '')
  const [configVals, setConfigVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map(f => [f.key, (config[f.key] as string) ?? '']))
  )
  const [status,     setStatus]     = useState<'idle' | 'saving' | 'deleting' | 'success' | 'error'>('idle')
  const [errorMsg,   setErrorMsg]   = useState('')
  const [showDelete, setShowDelete] = useState(false)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setStatus('saving')
    setErrorMsg('')
    try {
      const newConfig: Record<string, string> = { ...config }
      for (const f of fields) {
        if (configVals[f.key] !== undefined) newConfig[f.key] = configVals[f.key]
      }

      const res = await fetch(`/api/admin/connectors/${connector.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, config: newConfig }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to save')
      }
      setStatus('success')
      setTimeout(() => setStatus('idle'), 3000)
      router.refresh()
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  async function handleDelete() {
    setStatus('deleting')
    try {
      const res = await fetch(`/api/admin/connectors/${connector.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to delete')
      }
      router.push('/admin/connections')
      router.refresh()
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  const reauthHref = REAUTH_HREF[connector.type]

  return (
    <div className="space-y-4">
      {status === 'success' && (
        <div className="rounded-xl px-4 py-3 text-sm"
          style={{ background: 'var(--green-subtle)', border: '1px solid #bbf7d0', color: 'var(--green)' }}>
          Saved successfully.
        </div>
      )}
      {status === 'error' && errorMsg && (
        <div className="rounded-xl px-4 py-3 text-sm"
          style={{ background: 'var(--red-subtle)', border: '1px solid #fecaca', color: 'var(--red)' }}>
          {errorMsg}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
            Label
          </label>
          <input
            className="input"
            placeholder="e.g. Main Agency Account"
            value={label}
            onChange={e => setLabel(e.target.value)}
          />
        </div>

        {fields.map(f => (
          <div key={f.key}>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
              {f.label}
            </label>
            <input
              className="input"
              type="text"
              placeholder={f.placeholder}
              value={configVals[f.key] ?? ''}
              onChange={e => setConfigVals(v => ({ ...v, [f.key]: e.target.value }))}
            />
            <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>{f.hint}</p>
          </div>
        ))}

        <div className="flex items-center gap-3">
          <button type="submit" className="btn btn-primary" disabled={status === 'saving'}>
            {status === 'saving' ? 'Saving…' : 'Save Changes'}
          </button>
          {reauthHref && (
            <a href={reauthHref} className="btn btn-secondary">
              Re-authorize
            </a>
          )}
        </div>
      </form>

      <div className="pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
          Danger Zone
        </h3>
        <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
          Deleting this connector will disconnect all client accounts using it. Metrics data is preserved.
        </p>
        {!showDelete ? (
          <button onClick={() => setShowDelete(true)} className="btn btn-danger">
            Delete Connector
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <button
              onClick={handleDelete}
              className="btn btn-danger"
              disabled={status === 'deleting'}
            >
              {status === 'deleting' ? 'Deleting…' : 'Confirm Delete'}
            </button>
            <button onClick={() => setShowDelete(false)} className="btn btn-secondary">
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
