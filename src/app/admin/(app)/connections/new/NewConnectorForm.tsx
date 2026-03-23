'use client'

// Connector setup form.
// Google Ads and Meta Ads both use OAuth — clicking the button redirects to the
// platform's auth page. After authorization the callback stores the tokens and
// redirects back to the connector detail page.
//
// Meta also supports pasting a long-lived access token directly (useful if you
// already have a System User token from Meta Business Suite).

import { useState } from 'react'
import type { ConnectorType } from '@/lib/types'

export default function NewConnectorForm({ type }: { type: ConnectorType }) {
  // ── Meta manual token state ──────────────────────────────────────────────
  const [showManual,   setShowManual]   = useState(false)
  const [accessToken,  setAccessToken]  = useState('')
  const [businessId,   setBusinessId]   = useState('')
  const [saving,       setSaving]       = useState(false)
  const [errorMsg,     setErrorMsg]     = useState('')

  async function handleMetaManual(e: React.FormEvent) {
    e.preventDefault()
    if (!accessToken.trim()) return
    setSaving(true)
    setErrorMsg('')
    try {
      const res = await fetch('/api/admin/connectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type:   'meta_ads',
          label:  'Meta Ads',
          auth:   { access_token: accessToken.trim() },
          config: businessId.trim() ? { business_manager_id: businessId.trim() } : {},
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to save')
      }
      window.location.href = '/admin/connections'
    } catch (err) {
      setSaving(false)
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  // ── Google Ads ───────────────────────────────────────────────────────────
  if (type === 'google_ads') {
    return (
      <div className="space-y-5">
        <div
          className="rounded-xl p-4 text-sm space-y-1"
          style={{ background: 'var(--blue-subtle)', border: '1px solid var(--blue-border)', color: 'var(--blue)' }}
        >
          <p className="font-medium">Before connecting, make sure these are set in your <code>.env</code>:</p>
          <ul className="list-disc list-inside space-y-0.5 mt-1" style={{ color: 'var(--blue)' }}>
            <li><code>GOOGLE_CLIENT_ID</code> — from Google Cloud Console</li>
            <li><code>GOOGLE_CLIENT_SECRET</code> — from Google Cloud Console</li>
            <li><code>GOOGLE_DEVELOPER_TOKEN</code> — from Google Ads API Center (MCC account)</li>
          </ul>
        </div>

        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Click below to authorize the agency Google account. You&apos;ll be redirected to Google
          to grant access to your Google Ads MCC. After approval, you&apos;ll be sent back here
          to set your MCC Customer ID.
        </p>

        <div className="flex items-center gap-3 pt-1">
          <a href="/api/auth/google" className="btn btn-primary">
            Authorize with Google
          </a>
          <a href="/admin/connections" className="btn btn-secondary">Cancel</a>
        </div>
      </div>
    )
  }

  // ── Meta Ads ─────────────────────────────────────────────────────────────
  if (type === 'meta_ads') {
    return (
      <div className="space-y-5">
        {errorMsg && (
          <div
            className="rounded-xl px-4 py-3 text-sm"
            style={{ background: 'var(--red-subtle)', border: '1px solid #fecaca', color: 'var(--red)' }}
          >
            {errorMsg}
          </div>
        )}

        {!showManual ? (
          <>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Connect via your Meta App to discover all ad accounts under your Business Manager.
              Make sure <code>META_APP_ID</code> and <code>META_APP_SECRET</code> are set in <code>.env</code>.
            </p>
            <div className="flex items-center gap-3 pt-1">
              <a href="/api/auth/meta" className="btn btn-primary">
                Connect with Meta
              </a>
              <a href="/admin/connections" className="btn btn-secondary">Cancel</a>
            </div>
            <button
              type="button"
              className="text-xs"
              style={{ color: 'var(--blue)' }}
              onClick={() => setShowManual(true)}
            >
              Have a System User token? Enter it manually →
            </button>
          </>
        ) : (
          <form onSubmit={handleMetaManual} className="space-y-4">
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
                Access Token
              </label>
              <input
                className="input"
                type="password"
                placeholder="EAABs… or system user token"
                value={accessToken}
                onChange={e => setAccessToken(e.target.value)}
                required
              />
              <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
                Long-lived user token or System User token from Meta Business Suite.
              </p>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
                Business Manager ID <span style={{ color: 'var(--text-faint)' }}>(optional)</span>
              </label>
              <input
                className="input"
                type="text"
                placeholder="1234567890"
                value={businessId}
                onChange={e => setBusinessId(e.target.value)}
              />
              <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
                Found in Meta Business Suite → Settings.
              </p>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save Token'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowManual(false)}>
                Back
              </button>
            </div>
          </form>
        )}
      </div>
    )
  }

  // Fallback for any other connector type
  return (
    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
      This connector type is not yet supported.
    </p>
  )
}
