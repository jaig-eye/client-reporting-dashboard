'use client'

import { useState } from 'react'
import IntegrationCard  from '@/components/admin/IntegrationCard'
import IntegrationModal from '@/components/admin/IntegrationModal'
import { SECRET_MASK }  from '@/lib/secretMask'

interface Props {
  /** SECRET_MASK when a key is stored, '' when not — NEVER the key itself. This is
   *  a client component, so anything passed here is serialized into the RSC flight
   *  payload embedded in the page HTML and into React state: readable by any
   *  extension, any saved HAR, any screenshot, and anyone who can render the page. */
  initialApiKey:   string
  connectorId?:    string
}

export default function AhrefsAgencyCard({ initialApiKey, connectorId }: Props) {
  const [open,        setOpen]        = useState(false)
  const [apiKey,      setApiKey]      = useState(initialApiKey)
  const [isConnected, setIsConnected] = useState(!!initialApiKey)
  const [justSaved,   setJustSaved]   = useState(false)

  async function handleSave() {
    // The field still holds the mask ⇒ the key was not retyped ⇒ nothing to save.
    // Returning early also avoids the PATCH route's "No fields to update" 400.
    const trimmed = apiKey.trim()
    if (trimmed === SECRET_MASK) { setIsConnected(true); return }

    // Endpoints and body shape must match DataForSeoAgencyCard, which is the working
    // reference. This card previously POSTed to /api/admin/connections/new — a path
    // with no route file, so creating an Ahrefs connector 404'd — and PATCHed
    // `{ auth: … }`, which the connectors route ignores entirely (it reads
    // `auth_patch`, merging into the stored object so OAuth tokens are not clobbered),
    // leaving `update` empty and returning 400 "No fields to update". Saving an
    // Ahrefs key therefore failed in both directions.
    const url  = connectorId ? `/api/admin/connectors/${connectorId}` : '/api/admin/connectors'
    const body = connectorId
      ? { auth_patch: { api_key: trimmed } }
      : { type: 'ahrefs', label: 'Ahrefs', auth: { api_key: trimmed } }

    const res = await fetch(url, {
      method:  connectorId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error((d as { error?: string }).error || 'Save failed')
    }
    setIsConnected(!!trimmed)
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
