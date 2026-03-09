'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Connector } from '@/lib/types'

export default function EditConnectorForm({ connector }: { connector: Connector }) {
  const router = useRouter()
  const [label,   setLabel]   = useState(connector.label ?? '')
  const [status,  setStatus]  = useState<'idle' | 'saving' | 'deleting' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [showDelete, setShowDelete] = useState(false)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setStatus('saving')
    setErrorMsg('')
    try {
      const res = await fetch(`/api/admin/connectors/${connector.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
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
        <div>
          <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Auth credentials</p>
          <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
            To update credentials, delete this connector and reconnect.
          </p>
        </div>
        <button type="submit" className="btn btn-primary" disabled={status === 'saving'}>
          {status === 'saving' ? 'Saving…' : 'Save Changes'}
        </button>
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
