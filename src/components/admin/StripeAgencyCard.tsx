'use client'

import { useState } from 'react'

interface Props {
  initialApiKey:        string
  initialWebhookSecret: string
}

export default function StripeAgencyCard({ initialApiKey, initialWebhookSecret }: Props) {
  const [apiKey,         setApiKey]         = useState(initialApiKey)
  const [webhookSecret,  setWebhookSecret]  = useState(initialWebhookSecret)
  const [saving,         setSaving]         = useState(false)
  const [msg,            setMsg]            = useState('')

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMsg('')
    const res = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stripe_api_key: apiKey, stripe_webhook_secret: webhookSecret }),
    })
    setSaving(false)
    if (!res.ok) { setMsg('Save failed'); return }
    setMsg('Saved!')
    setTimeout(() => setMsg(''), 2000)
  }

  return (
    <div className="card p-5">
      <div className="flex items-start gap-4 mb-4">
        <div
          className="h-10 w-10 rounded-xl flex items-center justify-center text-white font-bold text-lg flex-shrink-0"
          style={{ background: '#635BFF' }}
        >
          S
        </div>
        <div>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Stripe</h2>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Auto-log ad fuel payments from Stripe invoices. Set each client&apos;s Stripe Customer ID in their Integrations tab.
          </p>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-3">
        <div>
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
            Secret Key <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>— starts with sk_live_ or sk_test_</span>
          </label>
          <input
            type="password"
            className="input"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="sk_live_…"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
            Webhook Secret <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>— starts with whsec_</span>
          </label>
          <input
            type="password"
            className="input"
            value={webhookSecret}
            onChange={e => setWebhookSecret(e.target.value)}
            placeholder="whsec_…"
            autoComplete="off"
          />
        </div>
        <p className="text-xs rounded-lg px-3 py-2" style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
          Webhook endpoint: <code style={{ fontFamily: 'monospace' }}>/api/webhooks/stripe</code> — register in your Stripe dashboard.
          Event: <code style={{ fontFamily: 'monospace' }}>invoice.payment_succeeded</code>
        </p>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saving}
            style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {msg && (
            <span style={{ fontSize: '0.8rem', color: msg === 'Saved!' ? 'var(--green)' : 'var(--red)' }}>
              {msg}
            </span>
          )}
        </div>
      </form>
    </div>
  )
}
