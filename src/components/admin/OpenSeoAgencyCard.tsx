'use client'

import { useState } from 'react'
import IntegrationCard  from '@/components/admin/IntegrationCard'
import IntegrationModal from '@/components/admin/IntegrationModal'

interface Props {
  initialApiKey: string
  connectorId?:  string
}

const OpenSeoIcon = <span style={{ fontWeight: 800, fontSize: '1rem', color: '#6366f1' }}>O</span>

export default function OpenSeoAgencyCard({ initialApiKey, connectorId }: Props) {
  const [open,        setOpen]        = useState(false)
  const [apiKey,      setApiKey]      = useState(initialApiKey)
  const [isConnected, setIsConnected] = useState(!!initialApiKey)
  const [justSaved,   setJustSaved]   = useState(false)

  async function handleSave() {
    // Update an existing connector, or create a new one. Unlike the older Ahrefs
    // card, both branches hit /api/admin/connectors (the create route special-cases
    // openseo to test the key and set status).
    const url  = connectorId ? `/api/admin/connectors/${connectorId}` : '/api/admin/connectors'
    const body = connectorId
      ? { auth_patch: { api_key: apiKey.trim() } }
      : { type: 'openseo', label: 'OpenSEO', auth: { api_key: apiKey.trim() } }

    const res = await fetch(url, {
      method:  connectorId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error((d as { error?: string }).error || 'Save failed')
    }
    setIsConnected(!!apiKey.trim())
  }

  return (
    <>
      <IntegrationCard
        icon={OpenSeoIcon}
        name="OpenSEO"
        description="Track keyword rankings and pull search volume, difficulty, and SERP data (pay-as-you-go)."
        isConnected={isConnected}
        connectedLabel={isConnected ? 'API key configured' : undefined}
        onConfigure={() => setOpen(true)}
        justConnected={justSaved}
      />
      <IntegrationModal
        open={open}
        onClose={() => setOpen(false)}
        onSaved={() => { setJustSaved(true); setTimeout(() => setJustSaved(false), 2000) }}
        title="OpenSEO"
        icon={OpenSeoIcon}
        isConnected={isConnected}
        howTo={
          <div>
            <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
              <li>Sign in at <strong>openseo.so</strong> → <strong>Settings → API</strong>.</li>
              <li>Generate an <strong>API key</strong> and paste it below.</li>
              <li>Then attach each client&apos;s domain from their <strong>Integrations</strong> tab to start rank tracking.</li>
            </ol>
            <p style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: 'var(--text-faint)' }}>
              Billing is usage-based (keyword searches and rank checks). You control which keywords are tracked per client.
            </p>
          </div>
        }
        onSave={handleSave}
      >
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>
            API Key
          </label>
          <input
            type="password"
            className="input"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="openseo_…"
            autoComplete="off"
            style={{ width: '100%' }}
          />
        </div>
      </IntegrationModal>
    </>
  )
}
