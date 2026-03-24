'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ConnectorType } from '@/lib/types'

interface Props {
  clientId: string
  connectorId: string
  connectorType: ConnectorType
  discoveredAccounts: { external_id: string; external_name: string | null }[]
}

export default function NewConnectionForm({
  clientId, connectorId, connectorType, discoveredAccounts,
}: Props) {
  const router = useRouter()
  const [externalId,   setExternalId]   = useState(discoveredAccounts[0]?.external_id ?? '')
  const [externalName, setExternalName] = useState(discoveredAccounts[0]?.external_name ?? '')
  const [useManual,    setUseManual]    = useState(discoveredAccounts.length === 0)
  const [status,       setStatus]       = useState<'idle' | 'saving' | 'error'>('idle')
  const [errorMsg,     setErrorMsg]     = useState('')

  // Sync name when selecting from discovered dropdown
  function handleSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const acc = discoveredAccounts.find(a => a.external_id === e.target.value)
    setExternalId(e.target.value)
    setExternalName(acc?.external_name ?? '')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!externalId.trim()) return
    setStatus('saving')
    setErrorMsg('')

    try {
      const res = await fetch('/api/admin/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id:     clientId,
          connector_id:  connectorId,
          external_id:   externalId.trim(),
          external_name: externalName.trim() || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to create connection')
      }
      window.location.href = `/admin/clients/${clientId}?connected=${connectorType}`
      router.refresh()
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {status === 'error' && errorMsg && (
        <div className="rounded-xl px-4 py-3 text-sm"
          style={{ background: 'var(--red-subtle)', border: '1px solid #fecaca', color: 'var(--red)' }}>
          {errorMsg}
        </div>
      )}

      {/* Account selector or manual entry */}
      {discoveredAccounts.length > 0 && !useManual ? (
        <div>
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
            Account
          </label>
          <select className="input" value={externalId} onChange={handleSelect}>
            {discoveredAccounts.map(a => (
              <option key={a.external_id} value={a.external_id}>
                {a.external_name ?? a.external_id} ({a.external_id})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="text-xs mt-1"
            style={{ color: 'var(--blue)' }}
            onClick={() => setUseManual(true)}
          >
            Enter account ID manually instead →
          </button>
        </div>
      ) : (
        <>
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
              Account ID
            </label>
            <input
              className="input"
              placeholder="e.g. 1234567890"
              value={externalId}
              onChange={e => setExternalId(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
              Account Name <span style={{ color: 'var(--text-faint)' }}>(optional)</span>
            </label>
            <input
              className="input"
              placeholder="e.g. Client Brand Campaign Account"
              value={externalName}
              onChange={e => setExternalName(e.target.value)}
            />
          </div>
          {discoveredAccounts.length > 0 && (
            <button
              type="button"
              className="text-xs"
              style={{ color: 'var(--blue)' }}
              onClick={() => setUseManual(false)}
            >
              ← Select from discovered accounts
            </button>
          )}
        </>
      )}

      <div className="flex items-center gap-3 pt-2">
        <button type="submit" className="btn btn-primary" disabled={status === 'saving'}>
          {status === 'saving' ? 'Connecting…' : 'Connect Account'}
        </button>
        <a href={`/admin/clients/${clientId}`} className="btn btn-secondary">Cancel</a>
      </div>
    </form>
  )
}
