'use client'

import { useState } from 'react'
import IntegrationCard  from '@/components/admin/IntegrationCard'
import IntegrationModal from '@/components/admin/IntegrationModal'

interface Props {
  initialApiKey:   string
  connectorId?:    string
}

export default function AhrefsAgencyCard({ initialApiKey, connectorId }: Props) {
  const [open,        setOpen]        = useState(false)
  const [apiKey,      setApiKey]      = useState(initialApiKey)
  const [isConnected, setIsConnected] = useState(!!initialApiKey)
  const [justSaved,   setJustSaved]   = useState(false)

  async function handleSave() {
    const url  = connectorId
      ? `/api/admin/connectors/${connectorId}`
      : '/api/admin/connections/new'
    const body = connectorId
      ? { auth: { api_key: apiKey.trim() } }
      : { type: 'ahrefs', label: 'Ahrefs', auth: { api_key: apiKey.trim() } }

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
        icon={<span style={{ fontWeight: 800, fontSize: '1rem', color: '#f59e0b' }}>A</span>}
        name="Ahrefs"
        description="Track Domain Rating, backlinks, and organic traffic for your clients."
        isConnected={isConnected}
        connectedLabel={isConnected ? 'API key configured' : undefined}
        onConfigure={() => setOpen(true)}
        justConnected={justSaved}
      />
      <IntegrationModal
        open={open}
        onClose={() => setOpen(false)}
        onSaved={() => { setJustSaved(true); setTimeout(() => setJustSaved(false), 2000) }}
        title="Ahrefs"
        icon={<span style={{ fontWeight: 800, fontSize: '1rem', color: '#f59e0b' }}>A</span>}
        isConnected={isConnected}
        howTo={
          <div>
            <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
              <li>Log in to <strong>app.ahrefs.com</strong> → <strong>Settings → API</strong>.</li>
              <li>Generate an <strong>API key</strong> and paste it below.</li>
            </ol>
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
            placeholder="ahrefs_api_…"
            autoComplete="off"
            style={{ width: '100%' }}
          />
        </div>
      </IntegrationModal>
    </>
  )
}
