'use client'

import { useState } from 'react'
import IntegrationCard from '@/components/admin/IntegrationCard'
import IntegrationModal from '@/components/admin/IntegrationModal'

type ConnType = 'ghl' | 'wordpress' | 'bigcommerce'

export default function ClientDirectConnections({
  clientId,
  existingTypes,
  singleType,
}: {
  clientId:      string
  existingTypes: ConnType[]
  singleType?:   ConnType
}) {
  // ── GHL ────────────────────────────────────────────────────────────────
  const [ghlOpen,      setGhlOpen]      = useState(false)
  const [ghlApiKey,    setGhlApiKey]    = useState('')
  const [ghlLocId,     setGhlLocId]     = useState('')
  const [ghlConnected, setGhlConnected] = useState(existingTypes.includes('ghl'))
  const [ghlJustSaved, setGhlJustSaved] = useState(false)

  // ── WordPress ──────────────────────────────────────────────────────────
  const [wpOpen,      setWpOpen]      = useState(false)
  const [wpSiteUrl,   setWpSiteUrl]   = useState('')
  const [wpUsername,  setWpUsername]  = useState('')
  const [wpPassword,  setWpPassword]  = useState('')
  const [wpConnected, setWpConnected] = useState(existingTypes.includes('wordpress'))
  const [wpJustSaved, setWpJustSaved] = useState(false)

  // ── BigCommerce ────────────────────────────────────────────────────────
  const [bcOpen,       setBcOpen]       = useState(false)
  const [bcStoreHash,  setBcStoreHash]  = useState('')
  const [bcToken,      setBcToken]      = useState('')
  const [bcConnected,  setBcConnected]  = useState(existingTypes.includes('bigcommerce'))
  const [bcJustSaved,  setBcJustSaved]  = useState(false)

  async function connect(type: ConnType, body: Record<string, string>) {
    const res = await fetch(`/api/admin/clients/${clientId}/direct-connections`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, ...body }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to connect')
  }

  function flashSaved(set: (v: boolean) => void) {
    set(true); setTimeout(() => set(false), 2000)
  }

  // ── singleType inline mode (used from parent connector card) ───────────
  if (singleType) {
    if (singleType === 'ghl') {
      if (ghlConnected) return <p className="text-xs" style={{ color: 'var(--text-muted)' }}>GHL is connected. Go to connection settings to update credentials.</p>
      return (
        <>
          <IntegrationCard icon="📡" name="GoHighLevel" description="Connect CRM, contacts, calls, and pipeline data." isConnected={false} onConfigure={() => setGhlOpen(true)} justConnected={ghlJustSaved} />
          {ghlOpen && <GhlModal open={ghlOpen} onClose={() => setGhlOpen(false)} apiKey={ghlApiKey} setApiKey={setGhlApiKey} locId={ghlLocId} setLocId={setGhlLocId} onSave={async () => { await connect('ghl', { apiKey: ghlApiKey, locationId: ghlLocId }); setGhlConnected(true) }} onSaved={() => flashSaved(setGhlJustSaved)} />}
        </>
      )
    }
    if (singleType === 'wordpress') {
      if (wpConnected) return <p className="text-xs" style={{ color: 'var(--text-muted)' }}>WordPress is connected. Go to connection settings to update credentials.</p>
      return (
        <>
          <IntegrationCard icon="🟦" name="WordPress" description="Post content directly to the client's WordPress site." isConnected={false} onConfigure={() => setWpOpen(true)} justConnected={wpJustSaved} />
          {wpOpen && <WpModal open={wpOpen} onClose={() => setWpOpen(false)} siteUrl={wpSiteUrl} setSiteUrl={setWpSiteUrl} username={wpUsername} setUsername={setWpUsername} password={wpPassword} setPassword={setWpPassword} onSave={async () => { await connect('wordpress', { siteUrl: wpSiteUrl, username: wpUsername, appPassword: wpPassword }); setWpConnected(true) }} onSaved={() => flashSaved(setWpJustSaved)} />}
        </>
      )
    }
    if (singleType === 'bigcommerce') {
      if (bcConnected) return <p className="text-xs" style={{ color: 'var(--text-muted)' }}>BigCommerce is connected. Go to connection settings to update credentials.</p>
      return (
        <>
          <IntegrationCard icon="🛒" name="BigCommerce" description="Sync store data and publish content to BigCommerce." isConnected={false} onConfigure={() => setBcOpen(true)} justConnected={bcJustSaved} />
          {bcOpen && <BcModal open={bcOpen} onClose={() => setBcOpen(false)} storeHash={bcStoreHash} setStoreHash={setBcStoreHash} token={bcToken} setToken={setBcToken} onSave={async () => { await connect('bigcommerce', { storeHash: bcStoreHash, accessToken: bcToken }); setBcConnected(true) }} onSaved={() => flashSaved(setBcJustSaved)} />}
        </>
      )
    }
  }

  // ── Standalone card mode (all three) ──────────────────────────────────
  return (
    <div className="space-y-3">
      <IntegrationCard
        icon="📡" name="GoHighLevel (CRM)"
        description="CRM contacts, calls, forms, and pipeline opportunities."
        isConnected={ghlConnected}
        onConfigure={() => setGhlOpen(true)}
        justConnected={ghlJustSaved}
      />
      <GhlModal open={ghlOpen} onClose={() => setGhlOpen(false)} apiKey={ghlApiKey} setApiKey={setGhlApiKey} locId={ghlLocId} setLocId={setGhlLocId} isConnected={ghlConnected}
        onSave={async () => { await connect('ghl', { apiKey: ghlApiKey, locationId: ghlLocId }); setGhlConnected(true) }} onSaved={() => flashSaved(setGhlJustSaved)} />

      <IntegrationCard
        icon="🟦" name="WordPress"
        description="Publish blog posts directly to the client's WordPress site."
        isConnected={wpConnected}
        onConfigure={() => setWpOpen(true)}
        justConnected={wpJustSaved}
      />
      <WpModal open={wpOpen} onClose={() => setWpOpen(false)} siteUrl={wpSiteUrl} setSiteUrl={setWpSiteUrl} username={wpUsername} setUsername={setWpUsername} password={wpPassword} setPassword={setWpPassword} isConnected={wpConnected}
        onSave={async () => { await connect('wordpress', { siteUrl: wpSiteUrl, username: wpUsername, appPassword: wpPassword }); setWpConnected(true) }} onSaved={() => flashSaved(setWpJustSaved)} />

      <IntegrationCard
        icon="🛒" name="BigCommerce"
        description="Sync store analytics and publish content to BigCommerce."
        isConnected={bcConnected}
        onConfigure={() => setBcOpen(true)}
        justConnected={bcJustSaved}
      />
      <BcModal open={bcOpen} onClose={() => setBcOpen(false)} storeHash={bcStoreHash} setStoreHash={setBcStoreHash} token={bcToken} setToken={setBcToken} isConnected={bcConnected}
        onSave={async () => { await connect('bigcommerce', { storeHash: bcStoreHash, accessToken: bcToken }); setBcConnected(true) }} onSaved={() => flashSaved(setBcJustSaved)} />
    </div>
  )
}

// ── GHL Modal ───────────────────────────────────────────────────────────────
function GhlModal({ open, onClose, apiKey, setApiKey, locId, setLocId, isConnected, onSave, onSaved }: {
  open: boolean; onClose: () => void; apiKey: string; setApiKey: (v: string) => void
  locId: string; setLocId: (v: string) => void; isConnected?: boolean
  onSave: () => Promise<void>; onSaved?: () => void
}) {
  return (
    <IntegrationModal open={open} onClose={onClose} onSaved={onSaved}
      title="GoHighLevel (CRM)" icon="📡" isConnected={isConnected}
      saveLabel={isConnected ? 'Reconnect' : 'Connect GHL'}
      howTo={
        <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
          <li><strong>Location ID:</strong> In your LaunchLocal / GHL dashboard, the Location ID is in the URL — look for <code>/location/XXXXXXXX</code> and copy that segment.</li>
          <li><strong>API Key:</strong> Inside the sub-account go to <strong>Settings → Integrations → Private Integrations</strong>, create a new key. Required scopes: <em>Contacts, Conversations, Opportunities, Calendars</em>.</li>
          <li>Paste both values below and click Connect.</li>
        </ol>
      }
      onSave={onSave}
    >
      <div>
        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>API Key</label>
        <input className="input" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
          placeholder="ghl_xxxxxxxxxxxxxxxx" style={{ width: '100%' }} />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Location ID</label>
        <input className="input" value={locId} onChange={e => setLocId(e.target.value)}
          placeholder="Location / Sub-account ID" style={{ width: '100%' }} />
      </div>
    </IntegrationModal>
  )
}

// ── WordPress Modal ─────────────────────────────────────────────────────────
function WpModal({ open, onClose, siteUrl, setSiteUrl, username, setUsername, password, setPassword, isConnected, onSave, onSaved }: {
  open: boolean; onClose: () => void; siteUrl: string; setSiteUrl: (v: string) => void
  username: string; setUsername: (v: string) => void; password: string; setPassword: (v: string) => void
  isConnected?: boolean; onSave: () => Promise<void>; onSaved?: () => void
}) {
  return (
    <IntegrationModal open={open} onClose={onClose} onSaved={onSaved}
      title="WordPress" icon="🟦" isConnected={isConnected}
      saveLabel={isConnected ? 'Reconnect' : 'Connect WordPress'}
      howTo={
        <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
          <li>Log into your WordPress admin panel.</li>
          <li>Go to <strong>Users → Your Profile</strong> and scroll to the <strong>Application Passwords</strong> section.</li>
          <li>Enter a name (e.g. "LaunchLocal") and click <strong>Add New Application Password</strong>.</li>
          <li>Copy the generated password (it appears once) — it looks like <code>xxxx xxxx xxxx xxxx</code>.</li>
          <li>Paste your site URL, WordPress username, and application password below.</li>
        </ol>
      }
      onSave={onSave}
    >
      <div>
        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Site URL</label>
        <input className="input" value={siteUrl} onChange={e => setSiteUrl(e.target.value)}
          placeholder="https://yourclient.com" style={{ width: '100%' }} />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Username</label>
        <input className="input" value={username} onChange={e => setUsername(e.target.value)}
          placeholder="WordPress username" style={{ width: '100%' }} />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Application Password</label>
        <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)}
          placeholder="xxxx xxxx xxxx xxxx xxxx xxxx" style={{ width: '100%' }} />
      </div>
    </IntegrationModal>
  )
}

// ── BigCommerce Modal ───────────────────────────────────────────────────────
function BcModal({ open, onClose, storeHash, setStoreHash, token, setToken, isConnected, onSave, onSaved }: {
  open: boolean; onClose: () => void; storeHash: string; setStoreHash: (v: string) => void
  token: string; setToken: (v: string) => void; isConnected?: boolean
  onSave: () => Promise<void>; onSaved?: () => void
}) {
  return (
    <IntegrationModal open={open} onClose={onClose} onSaved={onSaved}
      title="BigCommerce" icon="🛒" isConnected={isConnected}
      saveLabel={isConnected ? 'Reconnect' : 'Connect BigCommerce'}
      howTo={
        <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
          <li><strong>Store Hash:</strong> Find it in your BigCommerce store URL — it looks like <code>store-<strong>abc123</strong>.mybigcommerce.com</code>. Copy the bold portion.</li>
          <li><strong>Access Token:</strong> Go to <strong>BigCommerce Admin → Settings → API Accounts → Create API Account (V2/V3)</strong>. Under <strong>OAuth Scopes</strong>, set <strong>Content → Modify</strong> (required to publish blog posts). Copy the Access Token from the credential sheet — it only shows once.</li>
        </ol>
      }
      onSave={onSave}
    >
      <div>
        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Store Hash</label>
        <input className="input" value={storeHash} onChange={e => setStoreHash(e.target.value)}
          placeholder="abc123xyz" style={{ width: '100%' }} />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>API Access Token</label>
        <input className="input" type="password" value={token} onChange={e => setToken(e.target.value)}
          placeholder="Access token from API Accounts" style={{ width: '100%' }} />
      </div>
    </IntegrationModal>
  )
}
