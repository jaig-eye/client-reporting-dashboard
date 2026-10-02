'use client'

// First-time agency connection for the services that sign in with an account: Google (one sign-in
// for all four services) and Meta. The sign-in runs in a popup; when it finishes, this page goes
// back to Integrations, which shows the result. Key-based services (Ahrefs, DataForSEO, SerpApi,
// Discord, Stripe) connect from their dialogs on the Integrations page, and site connections
// (WordPress, HighLevel, BigCommerce) from each client's Integrations tab.

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CaretRight } from '@phosphor-icons/react'
import type { ConnectorType } from '@/lib/types'
import { useOAuthPopup } from '@/components/admin/integrations/useOAuthPopup'

export default function NewConnectorForm({ type }: { type: ConnectorType | 'google' }) {
  if (type === 'google')   return <GoogleUnifiedForm />
  if (type === 'meta_ads') return <MetaForm />
  return (
    <div className="ui-notice ui-notice--info" style={{ marginBottom: 0 }}>
      <span>
        {type === 'ghl' || type === 'wordpress' || type === 'bigcommerce'
          ? 'Site and CRM connections belong to a client. Open the client, then its Integrations tab.'
          : 'Connect this from its card on the Integrations page.'}
      </span>
      <Link href={type === 'ghl' || type === 'wordpress' || type === 'bigcommerce' ? '/admin/dashboard' : '/admin/connections'} className="btn btn-secondary btn-sm">
        {type === 'ghl' || type === 'wordpress' || type === 'bigcommerce' ? 'Go to clients' : 'Go to Integrations'}
      </Link>
    </div>
  )
}

function PopupStatus({ status, error, provider }: { status: string; error: string | null; provider: string }) {
  if (status === 'waiting') return <p className="ui-row-sub" role="status">Finish signing in to {provider} in the window that opened.</p>
  if (status === 'failed' && error) return <p className="ui-row-sub" role="alert" style={{ color: 'var(--red-fg)' }}>{error}</p>
  return null
}

// ─── Google: all four services in one sign-in ────────────────────────────────

function GoogleUnifiedForm() {
  const router = useRouter()
  const [developerToken, setDeveloperToken] = useState('')
  const [mccCustomerId,  setMccCustomerId]  = useState('')
  const [showAds,        setShowAds]        = useState(false)
  const { start, status, error } = useOAuthPopup({ onDone: ok => { if (ok) router.push('/admin/connections?connected=google') } })

  function handleConnect() {
    const params = new URLSearchParams()
    if (developerToken.trim()) params.set('developer_token', developerToken.trim())
    if (mccCustomerId.trim())  params.set('mcc_customer_id', mccCustomerId.trim().replace(/-/g, ''))
    // No connector_type: the start route connects all four services.
    start(`/api/auth/google/start${params.size ? `?${params}` : ''}`)
  }

  return (
    <div className="ui-stack">
      <div className="nc-list" aria-label="What this connects">
        {[
          ['Google Ads', 'Campaign and keyword performance'],
          ['Google Analytics', 'Traffic and conversions'],
          ['Search Console', 'Organic search queries and pages'],
          ['Business Profile', 'Views, calls and reviews'],
        ].map(([name, what]) => (
          <div key={name} className="nc-item"><strong>{name}</strong><span>{what}</span></div>
        ))}
      </div>
      <p className="ui-row-sub">You sign in once; the connection renews itself, so syncs don’t expire.</p>

      <div className="nc-advanced">
        <button type="button" onClick={() => setShowAds(v => !v)} aria-expanded={showAds}>
          <CaretRight size={12} weight="bold" aria-hidden className="nc-caret" />
          Google Ads details <span>(only if you use Google Ads)</span>
        </button>
        {showAds && (
          <div className="nc-advanced-body">
            <label className="nc-field">
              <span>Developer token</span>
              <input className="input" type="password" placeholder="ABcd1234…" value={developerToken} onChange={e => setDeveloperToken(e.target.value)} autoComplete="off" />
              <small>In Google Ads, under Admin, then API Center, on your manager (MCC) account.</small>
            </label>
            <label className="nc-field">
              <span>Manager account ID</span>
              <input className="input" type="text" inputMode="numeric" placeholder="123-456-7890" value={mccCustomerId} onChange={e => setMccCustomerId(e.target.value)} />
              <small>Your top-level manager account. Dashes are fine.</small>
            </label>
          </div>
        )}
      </div>

      <PopupStatus status={status} error={error} provider="Google" />
      <div className="nc-actions">
        <button type="button" onClick={handleConnect} className="btn btn-primary" disabled={status === 'waiting'}>
          {status === 'waiting' ? 'Waiting for Google…' : 'Sign in with Google'}
        </button>
        <Link href="/admin/connections" className="btn btn-secondary">Cancel</Link>
      </div>
    </div>
  )
}

// ─── Meta Ads ─────────────────────────────────────────────────────────────────

function MetaForm() {
  const router = useRouter()
  const { start, status, error } = useOAuthPopup({ onDone: ok => { if (ok) router.push('/admin/connections?connected=meta') } })
  return (
    <div className="ui-stack">
      <p className="ui-row-sub">
        Sign in with the Facebook account that can see your Business Manager and ad accounts. Meta will ask to allow
        reading and managing ads and business assets.
      </p>
      <PopupStatus status={status} error={error} provider="Meta" />
      <div className="nc-actions">
        <button type="button" onClick={() => start('/api/auth/meta/start')} className="btn btn-primary" disabled={status === 'waiting'}>
          {status === 'waiting' ? 'Waiting for Meta…' : 'Sign in with Facebook'}
        </button>
        <Link href="/admin/connections" className="btn btn-secondary">Cancel</Link>
      </div>
    </div>
  )
}
