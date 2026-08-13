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
  // Per-client DataForSEO tracking overrides (blank depth = inherit agency default).
  const [depthOverride, setDepthOverride] = useState('')
  const [devices,       setDevices]       = useState<('desktop' | 'mobile')[]>(['desktop', 'mobile'])
  const [devicesTouched, setDevicesTouched] = useState(false)   // false = inherit agency default

  // Domain-based connectors (Ahrefs, DataForSEO): a single root-domain input, no discovery.
  const isDomainConnector = connectorType === 'ahrefs' || connectorType === 'dataforseo'
  const isDfs = connectorType === 'dataforseo'
  function toggleDevice(d: 'desktop' | 'mobile') {
    setDevicesTouched(true)
    setDevices(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])
  }

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

    // Normalize domain for domain-based connectors (Ahrefs, DataForSEO)
    const normalizedId = isDomainConnector
      ? externalId.trim().replace(/^https?:\/\//, '').replace(/\/$/, '')
      : externalId.trim()

    // Per-client DataForSEO tracking config (only the fields set as overrides).
    const config = isDfs
      ? {
          ...(depthOverride.trim() ? { rank_depth: Math.max(10, Math.min(100, Number(depthOverride) || 100)) } : {}),
          // Only override devices when the user actually changed them; otherwise inherit the agency default.
          ...(devicesTouched ? { devices: devices.length ? devices : ['desktop'] } : {}),
        }
      : undefined

    try {
      const res = await fetch('/api/admin/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id:     clientId,
          connector_id:  connectorId,
          external_id:   normalizedId,
          external_name: isDomainConnector ? normalizedId : (externalName.trim() || null),
          ...(config ? { config } : {}),
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

  // Domain-based connectors (Ahrefs, DataForSEO): just a domain input — no discovery
  if (isDomainConnector) {
    return (
      <form onSubmit={handleSubmit} className="space-y-4">
        {status === 'error' && errorMsg && (
          <div className="rounded-xl px-4 py-3 text-sm"
            style={{ background: 'var(--red-subtle)', border: '1px solid #fecaca', color: 'var(--red)' }}>
            {errorMsg}
          </div>
        )}
        <div>
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
            Website Domain <span style={{ color: 'var(--red)' }}>*</span>
          </label>
          <input
            className="input"
            placeholder="example.com"
            value={externalId}
            onChange={e => setExternalId(e.target.value)}
            required
          />
          <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
            {isDfs
              ? 'Enter the root domain (e.g. example.com) to track keyword rankings for this client.'
              : 'Enter the root domain (e.g. example.com). Ahrefs metrics will sync automatically.'}
          </p>
        </div>

        {isDfs && (
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
                Rank depth <span style={{ color: 'var(--text-faint)' }}>— blank = inherit</span>
              </label>
              <input className="input" type="number" min={10} max={100} step={10} style={{ width: 120 }}
                placeholder="inherit" value={depthOverride} onChange={e => setDepthOverride(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Devices</label>
              <div style={{ display: 'flex', gap: 14, paddingTop: 6 }}>
                {(['desktop', 'mobile'] as const).map(d => (
                  <label key={d} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={devices.includes(d)} onChange={() => toggleDevice(d)} />
                    {d.charAt(0).toUpperCase() + d.slice(1)}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button type="submit" className="btn btn-primary" disabled={status === 'saving' || !externalId.trim()}>
            {status === 'saving' ? 'Connecting…' : 'Connect Domain'}
          </button>
          <a href={`/admin/clients/${clientId}`} className="btn btn-secondary">Cancel</a>
        </div>
      </form>
    )
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
