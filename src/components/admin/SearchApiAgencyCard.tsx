'use client'

import { useState } from 'react'
import IntegrationCard  from '@/components/admin/IntegrationCard'
import IntegrationModal from '@/components/admin/IntegrationModal'

interface Props {
  initialApiKey:   string
  initialProvider: string
}

const SerpIcon = <span style={{ fontWeight: 800, fontSize: '1rem', color: '#0ea5e9' }}>⌕</span>

export default function SearchApiAgencyCard({ initialApiKey, initialProvider }: Props) {
  const [open,        setOpen]        = useState(false)
  const [apiKey,      setApiKey]      = useState(initialApiKey)
  const [provider,    setProvider]    = useState(initialProvider || 'serpapi')
  const [isConnected, setIsConnected] = useState(!!initialApiKey)
  const [justSaved,   setJustSaved]   = useState(false)
  const [testing,     setTesting]     = useState(false)
  const [testMsg,     setTestMsg]     = useState('')

  async function handleSave() {
    const res = await fetch('/api/admin/settings', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ serp_api_key: apiKey.trim(), serp_api_provider: provider }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error((d as { error?: string }).error || 'Save failed')
    }
    setIsConnected(!!apiKey.trim())
  }

  async function handleTest() {
    if (!apiKey.trim()) return
    setTesting(true); setTestMsg('')
    try {
      const res = await fetch('/api/admin/settings/test-serp', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ api_key: apiKey.trim() }),
        signal:  AbortSignal.timeout(10000),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      setTestMsg(!res.ok || data.error ? `Error: ${data.error ?? res.statusText}` : 'Connected ✓')
    } catch {
      setTestMsg('Failed to reach SerpAPI — check key or network')
    } finally {
      setTesting(false)
    }
  }

  return (
    <>
      <IntegrationCard
        icon={SerpIcon}
        name="Search API"
        description="Competitor research during content generation — finds and analyzes top-ranking pages for each keyword."
        isConnected={isConnected}
        connectedLabel={isConnected ? 'API key configured' : undefined}
        onConfigure={() => setOpen(true)}
        justConnected={justSaved}
      />
      <IntegrationModal
        open={open}
        onClose={() => setOpen(false)}
        onSaved={() => { setJustSaved(true); setTimeout(() => setJustSaved(false), 2000) }}
        title="Search API"
        icon={SerpIcon}
        isConnected={isConnected}
        howTo={
          <div>
            <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
              <li>Create an account at <strong>serpapi.com</strong>.</li>
              <li>Copy your <strong>Private API key</strong> from the dashboard and paste it below.</li>
            </ol>
            <p style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: 'var(--text-faint)' }}>
              Used to research top-ranking competitor pages so generated posts fill content gaps. Free plan: 250 searches/month.
            </p>
          </div>
        }
        onSave={handleSave}
      >
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Provider</label>
          <select className="input" value={provider} onChange={e => setProvider(e.target.value)} style={{ width: '100%' }}>
            <option value="serpapi">SerpAPI</option>
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>API Key</label>
          <input
            type="password"
            className="input"
            value={apiKey}
            onChange={e => { setApiKey(e.target.value); setTestMsg('') }}
            placeholder="SerpAPI private key…"
            autoComplete="off"
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!apiKey.trim() || testing}
            onClick={handleTest}
            style={{ fontSize: '0.8rem' }}
          >
            {testing ? 'Testing…' : 'Test key'}
          </button>
          {testMsg && (
            <span style={{ fontSize: '0.75rem', color: testMsg.startsWith('Error') || testMsg.startsWith('Failed') ? 'var(--red)' : 'var(--green)' }}>
              {testMsg}
            </span>
          )}
        </div>
      </IntegrationModal>
    </>
  )
}
