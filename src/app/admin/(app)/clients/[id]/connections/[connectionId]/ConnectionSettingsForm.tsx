'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ClientConnection } from '@/lib/types'

export default function ConnectionSettingsForm({
  clientId,
  connection,
}: {
  clientId: string
  connection: ClientConnection
}) {
  const router = useRouter()
  const [externalName, setExternalName] = useState(connection.external_name ?? '')
  const [status,       setStatus]       = useState<'idle' | 'saving' | 'deleting' | 'success' | 'error'>('idle')
  const [errorMsg,     setErrorMsg]     = useState('')
  const [showDelete,   setShowDelete]   = useState(false)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setStatus('saving')
    setErrorMsg('')
    try {
      const res = await fetch(`/api/admin/connections/${connection.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ external_name: externalName || null }),
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

  async function handleDisconnect() {
    setStatus('deleting')
    try {
      const res = await fetch(`/api/admin/connections/${connection.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to disconnect')
      }
      window.location.href = `/admin/clients/${clientId}`
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

      {/* Read-only info */}
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span style={{ color: 'var(--text-muted)' }}>Account ID</span>
          <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
            {connection.external_id}
          </span>
        </div>
        <div className="flex justify-between">
          <span style={{ color: 'var(--text-muted)' }}>Status</span>
          <span className={`badge ${connection.status === 'active' ? 'badge-green' : 'badge-gray'}`}>
            {connection.status}
          </span>
        </div>
        {connection.last_synced_at && (
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-muted)' }}>Last synced</span>
            <span style={{ color: 'var(--text-secondary)' }}>
              {new Date(connection.last_synced_at).toLocaleString('en-US', {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
              })}
            </span>
          </div>
        )}
      </div>

      {/* Editable name */}
      <form onSubmit={handleSave} className="space-y-3" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1rem' }}>
        <div>
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
            Display Name <span style={{ color: 'var(--text-faint)' }}>(optional)</span>
          </label>
          <input
            className="input"
            placeholder="e.g. Brand Campaigns"
            value={externalName}
            onChange={e => setExternalName(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={status === 'saving'}>
          {status === 'saving' ? 'Saving…' : 'Save'}
        </button>
      </form>

      {/* Disconnect */}
      <div className="pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
          Disconnect
        </h3>
        <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
          Removes this account from the client. Metrics data is preserved.
        </p>
        {!showDelete ? (
          <button onClick={() => setShowDelete(true)} className="btn btn-danger">
            Disconnect Account
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <button
              onClick={handleDisconnect}
              className="btn btn-danger"
              disabled={status === 'deleting'}
            >
              {status === 'deleting' ? 'Disconnecting…' : 'Confirm Disconnect'}
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
