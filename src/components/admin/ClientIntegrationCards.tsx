'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { DiscordLogo, StripeLogo, LocalDominatorLogo } from '@/components/ConnectorLogo'
import IntegrationCard from '@/components/admin/IntegrationCard'
import IntegrationModal from '@/components/admin/IntegrationModal'

interface Props {
  clientId:          string
  discordChannelId:  string | null
  stripeCustomerId:  string | null
  localDominatorUrl: string | null
}

export default function ClientIntegrationCards({
  clientId, discordChannelId, stripeCustomerId, localDominatorUrl,
}: Props) {
  const router = useRouter()

  // ── Discord ────────────────────────────────────────────────────────────
  const [discordOpen,     setDiscordOpen]     = useState(false)
  const [discordField,    setDiscordField]    = useState(discordChannelId ?? '')
  const [discordConnected, setDiscordConnected] = useState(!!discordChannelId)
  const [discordLabel,    setDiscordLabel]    = useState(discordChannelId ? truncate(discordChannelId, 18) : '')
  const [discordJustSaved, setDiscordJustSaved] = useState(false)

  // ── Stripe ─────────────────────────────────────────────────────────────
  const [stripeOpen,     setStripeOpen]     = useState(false)
  const [stripeField,    setStripeField]    = useState(stripeCustomerId ?? '')
  const [stripeConnected, setStripeConnected] = useState(!!stripeCustomerId)
  const [stripeLabel,    setStripeLabel]    = useState(stripeCustomerId ? truncate(stripeCustomerId, 18) : '')
  const [stripeJustSaved, setStripeJustSaved] = useState(false)
  const [syncing,   setSyncing]   = useState(false)
  const [syncMsg,   setSyncMsg]   = useState('')

  // ── Local Dominator ────────────────────────────────────────────────────
  const [ldOpen,      setLdOpen]      = useState(false)
  const [ldField,     setLdField]     = useState(localDominatorUrl ?? '')
  const [ldConnected, setLdConnected] = useState(!!localDominatorUrl)
  const [ldLabel,     setLdLabel]     = useState(localDominatorUrl ? truncate(localDominatorUrl, 30) : '')
  const [ldJustSaved, setLdJustSaved] = useState(false)

  function truncate(s: string, n: number) {
    return s.length > n ? s.slice(0, n) + '…' : s
  }

  async function patchClient(body: Record<string, unknown>) {
    const res = await fetch(`/api/admin/clients/${clientId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || 'Save failed')
    }
    router.refresh()
  }

  async function handleStripeSync() {
    setSyncing(true); setSyncMsg('')
    try {
      const res = await fetch('/api/admin/stripe/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sync failed')
      setSyncMsg(`Synced — ${data.inserted} new entr${data.inserted === 1 ? 'y' : 'ies'} added`)
    } catch (err) {
      setSyncMsg(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-3">

      {/* ── Discord ────────────────────────────────────────────── */}
      <IntegrationCard
        icon={<DiscordLogo size={22} />}
        name="Discord"
        description="Low Ad Fuel balance alerts — fires at $0 and below the per-client alert threshold."
        isConnected={discordConnected}
        connectedLabel={discordLabel ? `ch: ${discordLabel}` : undefined}
        onConfigure={() => { setDiscordField(discordChannelId ?? ''); setDiscordOpen(true) }}
        justConnected={discordJustSaved}
      />
      <IntegrationModal
        open={discordOpen}
        onClose={() => setDiscordOpen(false)}
        onSaved={() => { setDiscordJustSaved(true); setTimeout(() => setDiscordJustSaved(false), 2000) }}
        title="Discord Alert Channel"
        icon={<DiscordLogo size={20} />}
        isConnected={discordConnected}
        canDelete={discordConnected}
        onDelete={async () => {
          await patchClient({ discord_channel_id: null })
          setDiscordConnected(false); setDiscordLabel(''); setDiscordField('')
        }}
        howTo={
          <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
            <li>In Discord, open <strong>User Settings → Advanced</strong> and enable <strong>Developer Mode</strong>.</li>
            <li>Navigate to the channel you want alerts sent to.</li>
            <li>Right-click the channel name → <strong>Copy Channel ID</strong>.</li>
            <li>Paste the numeric ID below.</li>
          </ol>
        }
        onSave={async () => {
          await patchClient({ discord_channel_id: discordField || null })
          setDiscordConnected(!!discordField)
          setDiscordLabel(discordField ? truncate(discordField, 18) : '')
        }}
      >
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Channel ID</label>
          <input
            className="input" style={{ fontFamily: 'monospace', fontSize: '0.8125rem', width: '100%' }}
            value={discordField}
            onChange={e => setDiscordField(e.target.value)}
            placeholder="e.g. 123456789012345678"
          />
        </div>
      </IntegrationModal>

      {/* ── Stripe ─────────────────────────────────────────────── */}
      <IntegrationCard
        icon={<StripeLogo size={22} />}
        name="Stripe"
        description="Auto-log ad fuel payments from Stripe invoices when they arrive via webhook."
        isConnected={stripeConnected}
        connectedLabel={stripeLabel || undefined}
        onConfigure={() => { setStripeField(stripeCustomerId ?? ''); setStripeOpen(true) }}
        justConnected={stripeJustSaved}
      />
      <IntegrationModal
        open={stripeOpen}
        onClose={() => setStripeOpen(false)}
        onSaved={() => { setStripeJustSaved(true); setTimeout(() => setStripeJustSaved(false), 2000) }}
        title="Stripe Customer"
        icon={<StripeLogo size={20} />}
        isConnected={stripeConnected}
        canDelete={stripeConnected}
        onDelete={async () => {
          await patchClient({ stripe_customer_id: null })
          setStripeConnected(false); setStripeLabel(''); setStripeField('')
        }}
        howTo={
          <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
            <li>Open your <strong>Stripe Dashboard</strong>.</li>
            <li>Go to <strong>Customers</strong> and search for the client by name or email.</li>
            <li>Open their customer record — the Customer ID (<code>cus_…</code>) appears in the URL and at the top of the page.</li>
            <li>Copy and paste it below.</li>
          </ol>
        }
        onSave={async () => {
          await patchClient({ stripe_customer_id: stripeField || null })
          setStripeConnected(!!stripeField)
          setStripeLabel(stripeField ? truncate(stripeField, 18) : '')
        }}
      >
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Customer ID</label>
          <input
            className="input" style={{ fontFamily: 'monospace', fontSize: '0.8125rem', width: '100%' }}
            value={stripeField}
            onChange={e => setStripeField(e.target.value)}
            placeholder="cus_…"
          />
        </div>
        {stripeConnected && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingTop: '0.25rem' }}>
            <button
              type="button" onClick={handleStripeSync} disabled={syncing}
              className="btn btn-secondary" style={{ fontSize: '0.775rem', padding: '0.3rem 0.7rem' }}
            >
              {syncing ? 'Syncing…' : '↻ Sync Payments'}
            </button>
            {syncMsg && (
              <span style={{ fontSize: '0.75rem', color: syncMsg.includes('failed') || syncMsg.includes('Error') ? 'var(--red)' : 'var(--green)' }}>
                {syncMsg}
              </span>
            )}
          </div>
        )}
      </IntegrationModal>

      {/* ── Local Dominator ────────────────────────────────────── */}
      <IntegrationCard
        icon={<LocalDominatorLogo size={22} />}
        name="Google Maps Ranking"
        description="Embeds the ranking map on the client's dashboard summary and dedicated Google Maps Ranking tab."
        isConnected={ldConnected}
        connectedLabel={ldLabel || undefined}
        onConfigure={() => { setLdField(localDominatorUrl ?? ''); setLdOpen(true) }}
        justConnected={ldJustSaved}
      />
      <IntegrationModal
        open={ldOpen}
        onClose={() => setLdOpen(false)}
        onSaved={() => { setLdJustSaved(true); setTimeout(() => setLdJustSaved(false), 2000) }}
        title="Google Maps Ranking (Local Dominator)"
        icon={<LocalDominatorLogo size={20} />}
        isConnected={ldConnected}
        canDelete={ldConnected}
        onDelete={async () => {
          await patchClient({ local_dominator_url: null })
          setLdConnected(false); setLdLabel(''); setLdField('')
        }}
        howTo={
          <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
            <li>Open <strong>Local Dominator</strong> and navigate to this client&apos;s ranking map.</li>
            <li>Click <strong>Share</strong> or the embed/share icon.</li>
            <li>Copy the full share URL (starts with <code>https://</code>).</li>
            <li>Paste it below — the map will appear on the client&apos;s dashboard.</li>
          </ol>
        }
        onSave={async () => {
          await patchClient({ local_dominator_url: ldField || null })
          setLdConnected(!!ldField)
          setLdLabel(ldField ? truncate(ldField, 30) : '')
        }}
      >
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Share URL</label>
          <input
            className="input" style={{ fontSize: '0.8125rem', width: '100%' }}
            value={ldField}
            onChange={e => setLdField(e.target.value)}
            placeholder="https://…"
          />
        </div>
      </IntegrationModal>

    </div>
  )
}
