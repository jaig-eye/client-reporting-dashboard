'use client'

import { useState } from 'react'
import { StripeLogo } from '@/components/ConnectorLogo'
import IntegrationCard from '@/components/admin/IntegrationCard'
import IntegrationModal from '@/components/admin/IntegrationModal'

interface Props {
  initialApiKey:        string
  initialWebhookSecret: string
}

export default function StripeAgencyCard({ initialApiKey, initialWebhookSecret }: Props) {
  const [open,          setOpen]          = useState(false)
  const [apiKey,        setApiKey]        = useState(initialApiKey)
  const [webhookSecret, setWebhookSecret] = useState(initialWebhookSecret)
  const [isConnected,   setIsConnected]   = useState(!!(initialApiKey && initialWebhookSecret))
  const [justSaved,     setJustSaved]     = useState(false)

  async function handleSave() {
    const res = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stripe_api_key: apiKey, stripe_webhook_secret: webhookSecret }),
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || 'Save failed')
    }
    setIsConnected(!!(apiKey && webhookSecret))
  }

  return (
    <>
      <IntegrationCard
        icon={<StripeLogo size={22} />}
        name="Stripe"
        description="Auto-log ad fuel payments from Stripe invoices. Configure each client's Customer ID in their Integrations tab."
        isConnected={isConnected}
        connectedLabel={isConnected ? 'Secret key configured' : undefined}
        onConfigure={() => setOpen(true)}
        justConnected={justSaved}
      />
      <IntegrationModal
        open={open}
        onClose={() => setOpen(false)}
        onSaved={() => { setJustSaved(true); setTimeout(() => setJustSaved(false), 2000) }}
        title="Stripe (Agency)"
        icon={<StripeLogo size={20} />}
        isConnected={isConnected}
        howTo={
          <div>
            <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
              <li>In your <strong>Stripe Dashboard</strong>, go to <strong>Developers → API Keys</strong>. Copy your <strong>Secret key</strong> (<code>sk_live_…</code> for production or <code>sk_test_…</code> for testing).</li>
              <li>To set up the webhook: go to <strong>Developers → Webhooks → Add endpoint</strong>. Enter the endpoint URL below and select the event <code>invoice.payment_succeeded</code>. After saving, copy the <strong>Signing secret</strong> (<code>whsec_…</code>).</li>
            </ol>
            <div style={{ marginTop: '0.625rem', padding: '0.5rem 0.625rem', background: 'var(--bg-subtle)', borderRadius: 6, fontSize: '0.75rem' }}>
              Webhook endpoint: <code style={{ fontFamily: 'monospace' }}>/api/webhooks/stripe</code>
            </div>
          </div>
        }
        onSave={handleSave}
      >
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>
            Secret Key <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>— sk_live_ or sk_test_</span>
          </label>
          <input type="password" className="input" value={apiKey} onChange={e => setApiKey(e.target.value)}
            placeholder="sk_live_…" autoComplete="off" style={{ width: '100%' }} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>
            Webhook Secret <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>— whsec_</span>
          </label>
          <input type="password" className="input" value={webhookSecret} onChange={e => setWebhookSecret(e.target.value)}
            placeholder="whsec_…" autoComplete="off" style={{ width: '100%' }} />
        </div>
      </IntegrationModal>
    </>
  )
}
