'use client'

// Connector setup form.
// Google Ads: enter Developer Token + MCC ID, then OAuth with Google.
// Meta Ads:   click "Connect with Facebook" — uses META_APP_ID from env.

import { useState } from 'react'
import type { ConnectorType } from '@/lib/types'

export default function NewConnectorForm({ type }: { type: ConnectorType }) {
  if (type === 'google_ads') return <GoogleForm />
  if (type === 'meta_ads')   return <MetaForm />
  if (type === 'ghl')        return <GhlForm />
  if (type === 'wordpress')  return <WordPressForm />
  return (
    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
      This connector type is not yet supported.
    </p>
  )
}

// ─── Google Ads ──────────────────────────────────────────────────────────────

function GoogleForm() {
  const [developerToken, setDeveloperToken] = useState('')
  const [mccCustomerId,  setMccCustomerId]  = useState('')

  function handleConnect() {
    const params = new URLSearchParams()
    if (developerToken.trim()) params.set('developer_token', developerToken.trim())
    if (mccCustomerId.trim())  params.set('mcc_customer_id', mccCustomerId.trim().replace(/-/g, ''))
    window.location.href = `/api/auth/google/start?${params}`
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
          Developer Token <span style={{ color: 'var(--red)' }}>*</span>
        </label>
        <input
          className="input"
          type="password"
          placeholder="ABcd1234…"
          value={developerToken}
          onChange={e => setDeveloperToken(e.target.value)}
        />
        <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
          Found in Google Ads → Admin → API Center under your MCC account.
        </p>
      </div>

      <div>
        <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
          MCC Customer ID <span style={{ color: 'var(--red)' }}>*</span>
        </label>
        <input
          className="input"
          type="text"
          placeholder="1234567890"
          value={mccCustomerId}
          onChange={e => setMccCustomerId(e.target.value)}
        />
        <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
          Your top-level manager account ID. Dashes are stripped automatically.
        </p>
      </div>

      <div
        className="rounded-xl px-4 py-3 text-sm"
        style={{ background: 'var(--blue-subtle)', border: '1px solid var(--blue-border)', color: 'var(--blue)' }}
      >
        After entering your credentials above, click the button below to sign in with the
        Google account that has access to your MCC. You&apos;ll only need to do this once — we
        store a refresh token so syncs never expire.
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={handleConnect}
          disabled={!developerToken.trim() || !mccCustomerId.trim()}
          className="btn btn-primary"
        >
          <span style={{ marginRight: '0.375rem' }}>🔵</span>
          Connect with Google Account
        </button>
        <a href="/admin/connections" className="btn btn-secondary">Cancel</a>
      </div>
    </div>
  )
}

// ─── GoHighLevel ──────────────────────────────────────────────────────────────

function GhlForm() {
  const [apiKey,     setApiKey]     = useState('')
  const [locationId, setLocationId] = useState('')
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')
  const [success,    setSuccess]    = useState(false)

  async function handleConnect() {
    if (!apiKey.trim() || !locationId.trim()) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/admin/connectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'ghl',
          label: `GHL — ${locationId.trim()}`,
          auth: { api_key: apiKey.trim() },
          config: { location_id: locationId.trim() },
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to create connector')
      }
      setSuccess(true)
      setTimeout(() => { window.location.href = '/admin/connections' }, 1000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  if (success) {
    return <p className="text-sm" style={{ color: 'var(--green)' }}>GoHighLevel connector created! Redirecting…</p>
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
          Private Integration Key <span style={{ color: 'var(--red)' }}>*</span>
        </label>
        <input
          className="input"
          type="password"
          placeholder="pit-xxxxxxxx-xxxx-xxxx…"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
        />
        <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
          Found in GHL → Settings → Business Profile → Integrations → Private Integrations.
        </p>
      </div>

      <div>
        <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
          Location ID <span style={{ color: 'var(--red)' }}>*</span>
        </label>
        <input
          className="input"
          type="text"
          placeholder="abc123DEF456…"
          value={locationId}
          onChange={e => setLocationId(e.target.value)}
        />
        <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
          Found in GHL → Settings → Business Profile. Unique ID for the sub-account.
        </p>
      </div>

      {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={handleConnect}
          disabled={saving || !apiKey.trim() || !locationId.trim()}
          className="btn btn-primary"
        >
          {saving ? 'Connecting…' : 'Connect GoHighLevel'}
        </button>
        <a href="/admin/connections" className="btn btn-secondary">Cancel</a>
      </div>
    </div>
  )
}

// ─── WordPress ────────────────────────────────────────────────────────────────

function WordPressForm() {
  const [siteUrl,     setSiteUrl]     = useState('')
  const [username,    setUsername]    = useState('')
  const [appPassword, setAppPassword] = useState('')
  const [saving,      setSaving]     = useState(false)
  const [error,       setError]      = useState('')
  const [success,     setSuccess]    = useState(false)

  async function handleConnect() {
    if (!siteUrl.trim() || !username.trim() || !appPassword.trim()) return
    setSaving(true)
    setError('')
    try {
      const cleanUrl = siteUrl.trim().replace(/\/+$/, '')
      const res = await fetch('/api/admin/connectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'wordpress',
          label: `WordPress — ${new URL(cleanUrl).hostname}`,
          auth: { username: username.trim(), app_password: appPassword.trim() },
          config: { site_url: cleanUrl },
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to create connector')
      }
      setSuccess(true)
      setTimeout(() => { window.location.href = '/admin/connections' }, 1000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  if (success) {
    return <p className="text-sm" style={{ color: 'var(--green)' }}>WordPress connector created! Redirecting…</p>
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
          Site URL <span style={{ color: 'var(--red)' }}>*</span>
        </label>
        <input
          className="input"
          type="url"
          placeholder="https://example.com"
          value={siteUrl}
          onChange={e => setSiteUrl(e.target.value)}
        />
      </div>

      <div>
        <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
          WordPress Username <span style={{ color: 'var(--red)' }}>*</span>
        </label>
        <input
          className="input"
          type="text"
          placeholder="admin"
          value={username}
          onChange={e => setUsername(e.target.value)}
        />
      </div>

      <div>
        <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
          Application Password <span style={{ color: 'var(--red)' }}>*</span>
        </label>
        <input
          className="input"
          type="password"
          placeholder="xxxx xxxx xxxx xxxx"
          value={appPassword}
          onChange={e => setAppPassword(e.target.value)}
        />
        <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
          WordPress → Users → Edit Profile → Application Passwords. Generate a new one for this integration.
        </p>
      </div>

      {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={handleConnect}
          disabled={saving || !siteUrl.trim() || !username.trim() || !appPassword.trim()}
          className="btn btn-primary"
        >
          {saving ? 'Connecting…' : 'Connect WordPress Site'}
        </button>
        <a href="/admin/connections" className="btn btn-secondary">Cancel</a>
      </div>
    </div>
  )
}

// ─── Meta Ads ─────────────────────────────────────────────────────────────────

function MetaForm() {
  return (
    <div className="space-y-4">
      <div
        className="rounded-xl px-4 py-3 text-sm"
        style={{ background: 'var(--blue-subtle)', border: '1px solid var(--blue-border)', color: 'var(--blue)' }}
      >
        Click below to sign in with your Facebook account. Make sure you sign in with the account
        that has access to your Business Manager and ad accounts. We&apos;ll request{' '}
        <code>ads_read</code>, <code>ads_management</code>, and <code>business_management</code> permissions.
      </div>

      <div className="flex items-center gap-3">
        <a href="/api/auth/meta/start" className="btn btn-primary">
          <span style={{ marginRight: '0.375rem' }}>🟦</span>
          Connect with Facebook
        </a>
        <a href="/admin/connections" className="btn btn-secondary">Cancel</a>
      </div>
    </div>
  )
}
