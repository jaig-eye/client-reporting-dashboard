'use client'

// Agency-level connector setup form.
// Handles Google OAuth (Ads, Analytics, Search Console, Business Profile)
// and Meta OAuth — all require agency-level credentials shared across clients.
//
// GHL and WordPress are client-level direct connections — configure those
// inside the individual client page (Admin → Clients → [Client] → Direct Integrations).

import { useState } from 'react'
import type { ConnectorType } from '@/lib/types'

export default function NewConnectorForm({ type }: { type: ConnectorType }) {
  if (type === 'google_ads')              return <GoogleAdsForm />
  if (type === 'google_analytics')        return <GoogleOAuthForm type="google_analytics"        label="Google Analytics (GA4)" hint="Sign in with the Google account that owns your GA4 properties." />
  if (type === 'google_search_console')   return <GoogleOAuthForm type="google_search_console"   label="Google Search Console"  hint="Sign in with the Google account that has access to your verified sites." />
  if (type === 'google_business_profile') return <GoogleOAuthForm type="google_business_profile" label="Google Business Profile" hint="Sign in with the Google account that manages your GBP locations." />
  if (type === 'meta_ads')                return <MetaForm />
  if (type === 'ahrefs')                  return <AhrefsForm />
  if (type === 'ghl' || type === 'wordpress') {
    return (
      <div
        className="rounded-xl px-4 py-3 text-sm space-y-2"
        style={{ background: 'var(--yellow-subtle, #fefce8)', border: '1px solid var(--yellow-border, #fde68a)', color: 'var(--text-primary)' }}
      >
        <p className="font-medium">Set up this connection at the client level.</p>
        <p style={{ color: 'var(--text-muted)' }}>
          {type === 'ghl' ? 'GoHighLevel' : 'WordPress'} connections are client-specific and must be
          configured inside the individual client page under <strong>Direct Integrations</strong>.
        </p>
        <a href="/admin/clients" className="btn btn-secondary text-sm inline-block mt-1">Go to Clients</a>
      </div>
    )
  }
  return (
    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
      This connector type is not yet supported.
    </p>
  )
}

// ─── Google Ads (requires Developer Token + MCC ID) ─────────────────────────

function GoogleAdsForm() {
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
          Connect with Google Account
        </button>
        <a href="/admin/connections" className="btn btn-secondary">Cancel</a>
      </div>
    </div>
  )
}

// ─── Generic Google OAuth (GA4 / GSC / GBP) ─────────────────────────────────

function GoogleOAuthForm({ type, label, hint }: { type: ConnectorType; label: string; hint: string }) {
  function handleConnect() {
    // Pass the connector type in the OAuth state so the callback can create
    // the right connector record after authorization completes.
    const state = btoa(JSON.stringify({ connector_type: type }))
    window.location.href = `/api/auth/google/start?state_extra=${encodeURIComponent(state)}`
  }

  return (
    <div className="space-y-4">
      <div
        className="rounded-xl px-4 py-3 text-sm"
        style={{ background: 'var(--blue-subtle)', border: '1px solid var(--blue-border)', color: 'var(--blue)' }}
      >
        {hint} You&apos;ll only need to do this once — we store a refresh token so syncs never expire.
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button type="button" onClick={handleConnect} className="btn btn-primary">
          Connect {label} with Google
        </button>
        <a href="/admin/connections" className="btn btn-secondary">Cancel</a>
      </div>
    </div>
  )
}

// ─── Ahrefs (API key) ────────────────────────────────────────────────────────

function AhrefsForm() {
  const [apiKey,  setApiKey]  = useState('')
  const [saving,  setSaving]  = useState(false)
  const [errMsg,  setErrMsg]  = useState('')

  async function handleConnect() {
    if (!apiKey.trim()) return
    setSaving(true)
    setErrMsg('')
    try {
      const res = await fetch('/api/admin/connectors', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ type: 'ahrefs', label: 'Ahrefs', auth: { api_key: apiKey.trim() } }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to save')
      }
      window.location.href = '/admin/connections'
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Something went wrong')
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
          API Key <span style={{ color: 'var(--red)' }}>*</span>
        </label>
        <input
          className="input"
          type="password"
          placeholder="ahrefs_api_…"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
        />
        <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
          Found in Ahrefs → Account Settings → API. Requires a Standard plan or above.
        </p>
      </div>

      {errMsg && (
        <div className="rounded-xl px-4 py-3 text-sm"
          style={{ background: 'var(--red-subtle)', border: '1px solid #fecaca', color: 'var(--red)' }}>
          {errMsg}
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={handleConnect}
          disabled={!apiKey.trim() || saving}
          className="btn btn-primary"
        >
          {saving ? 'Connecting…' : 'Connect Ahrefs'}
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
          Connect with Facebook
        </a>
        <a href="/admin/connections" className="btn btn-secondary">Cancel</a>
      </div>
    </div>
  )
}
