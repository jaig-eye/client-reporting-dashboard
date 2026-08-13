'use client'

import { useState } from 'react'
import IntegrationCard  from '@/components/admin/IntegrationCard'
import IntegrationModal from '@/components/admin/IntegrationModal'
import type { SeoDevice } from '@/lib/connectors/dataforseo'

interface Props {
  connectorId?:   string
  connected?:     boolean               // connector.status === 'active'
  hasCreds?:      boolean               // a login is already stored
  initialDepth?:  number
  initialDevices?: SeoDevice[]
}

const DfsIcon = <span style={{ fontWeight: 800, fontSize: '1rem', color: '#6366f1' }}>D</span>
const ALL_DEVICES: SeoDevice[] = ['desktop', 'mobile']

export default function DataForSeoAgencyCard({
  connectorId: initialConnectorId, connected, hasCreds, initialDepth, initialDevices,
}: Props) {
  const [open,        setOpen]        = useState(false)
  const [connectorId, setConnectorId] = useState<string | undefined>(initialConnectorId)
  const [login,       setLogin]       = useState('')
  const [password,    setPassword]    = useState('')
  const [depth,       setDepth]       = useState(initialDepth ?? 100)
  const [devices,     setDevices]     = useState<SeoDevice[]>(initialDevices?.length ? initialDevices : ['desktop', 'mobile'])
  const [isConnected, setIsConnected] = useState(!!connected)
  const [justSaved,   setJustSaved]   = useState(false)

  function toggleDevice(d: SeoDevice) {
    setDevices(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])
  }

  async function handleSave() {
    const authPatch: Record<string, string> = {}
    if (login.trim())    authPatch.dataforseo_login    = login.trim()
    if (password.trim()) authPatch.dataforseo_password = password.trim()
    const config = {
      rank_depth:    Math.max(10, Math.min(100, Number(depth) || 100)),
      devices:       devices.length ? devices : ['desktop'],
      location_code: 2840,
      language_code: 'en',
    }

    const url  = connectorId ? `/api/admin/connectors/${connectorId}` : '/api/admin/connectors'
    const body = connectorId
      ? { config, ...(Object.keys(authPatch).length ? { auth_patch: authPatch } : {}) }
      : { type: 'dataforseo', label: 'DataForSEO', auth: authPatch, config }

    const res = await fetch(url, {
      method:  connectorId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error((d as { error?: string }).error || 'Save failed')
    }
    const d = await res.json().catch(() => ({})) as { id?: string; status?: string }
    if (d.id && !connectorId) setConnectorId(d.id)     // capture id so the next save updates, not duplicates
    // Trust the server's validated status; a bad login lands as status 'error'.
    if (d.status) setIsConnected(d.status === 'active')
    else setIsConnected(Boolean((login.trim() && password.trim()) || (connectorId && hasCreds)))
  }

  const connectedLabel = isConnected ? 'Credentials verified' : (hasCreds ? 'Credentials set — not verified' : undefined)

  return (
    <>
      <IntegrationCard
        icon={DfsIcon}
        name="DataForSEO"
        description="Keyword rankings, search volume, difficulty, intent, and SERP data. Bring your own DataForSEO key (pay-as-you-go)."
        isConnected={isConnected || !!hasCreds}
        connectedLabel={connectedLabel}
        onConfigure={() => setOpen(true)}
        justConnected={justSaved}
      />
      <IntegrationModal
        open={open}
        onClose={() => setOpen(false)}
        onSaved={() => { setJustSaved(true); setTimeout(() => setJustSaved(false), 2000) }}
        title="DataForSEO"
        icon={DfsIcon}
        isConnected={!!hasCreds}
        howTo={
          <div>
            <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
              <li>Create an account at <strong>dataforseo.com</strong> (min. $50 prepaid top-up; balance rolls over).</li>
              <li>Open <strong>API Access</strong> in the dashboard and copy your <strong>API login</strong> and the auto-generated <strong>API password</strong> (not your account password).</li>
              <li>Paste them below, then attach each client&apos;s domain from their Integrations tab to start rank tracking.</li>
            </ol>
            <p style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: 'var(--text-faint)' }}>
              Cost scales with rank-tracking depth and device coverage — set the defaults below (override per client on their connection).
            </p>
          </div>
        }
        onSave={handleSave}
      >
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>API Login</label>
          <input type="text" className="input" value={login} onChange={e => setLogin(e.target.value)}
            placeholder={hasCreds ? '•••••• (leave blank to keep)' : 'you@example.com'} autoComplete="off" style={{ width: '100%' }} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>API Password</label>
          <input type="password" className="input" value={password} onChange={e => setPassword(e.target.value)}
            placeholder={hasCreds ? '•••••• (leave blank to keep)' : 'DataForSEO API password'} autoComplete="off" style={{ width: '100%' }} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>
            Default rank depth <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>— 20 = page 1–2 (cheapest), 100 = full</span>
          </label>
          <input type="number" min={10} max={100} step={10} className="input" value={depth}
            onChange={e => setDepth(Number(e.target.value))} style={{ width: 120 }} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Default devices</label>
          <div style={{ display: 'flex', gap: 14 }}>
            {ALL_DEVICES.map(d => (
              <label key={d} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={devices.includes(d)} onChange={() => toggleDevice(d)} />
                {d.charAt(0).toUpperCase() + d.slice(1)}
              </label>
            ))}
          </div>
          <p style={{ fontSize: '0.68rem', color: 'var(--text-faint)', margin: '4px 0 0' }}>
            Each device is a separate daily SERP check. Depth and devices are per-client-overridable.
          </p>
        </div>
      </IntegrationModal>
    </>
  )
}
