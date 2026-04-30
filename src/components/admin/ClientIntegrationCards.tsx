'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { DiscordLogo, StripeLogo, LocalDominatorLogo } from '@/components/ConnectorLogo'

interface Props {
  clientId:          string
  discordChannelId:  string | null
  stripeCustomerId:  string | null
  localDominatorUrl: string | null
}

export default function ClientIntegrationCards({
  clientId,
  discordChannelId,
  stripeCustomerId,
  localDominatorUrl,
}: Props) {
  const router = useRouter()

  const [discordId,     setDiscordId]     = useState(discordChannelId ?? '')
  const [discordSaving, setDiscordSaving] = useState(false)
  const [discordMsg,    setDiscordMsg]    = useState('')

  const [stripeId,     setStripeId]     = useState(stripeCustomerId ?? '')
  const [stripeSaving, setStripeSaving] = useState(false)
  const [stripeMsg,    setStripeMsg]    = useState('')
  const [syncing,      setSyncing]      = useState(false)
  const [syncMsg,      setSyncMsg]      = useState('')

  const [ldUrl,     setLdUrl]     = useState(localDominatorUrl ?? '')
  const [ldSaving,  setLdSaving]  = useState(false)
  const [ldMsg,     setLdMsg]     = useState('')

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

  async function saveDiscord(e: React.FormEvent) {
    e.preventDefault()
    setDiscordSaving(true); setDiscordMsg('')
    try {
      await patchClient({ discord_channel_id: discordId || null })
      setDiscordMsg('Saved!')
    } catch (err) {
      setDiscordMsg(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setDiscordSaving(false)
      setTimeout(() => setDiscordMsg(''), 3000)
    }
  }

  async function saveStripe(e: React.FormEvent) {
    e.preventDefault()
    setStripeSaving(true); setStripeMsg('')
    try {
      await patchClient({ stripe_customer_id: stripeId || null })
      setStripeMsg('Saved!')
    } catch (err) {
      setStripeMsg(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setStripeSaving(false)
      setTimeout(() => setStripeMsg(''), 3000)
    }
  }

  async function handleStripeSync() {
    setSyncing(true); setSyncMsg('')
    try {
      const res = await fetch('/api/admin/stripe/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  async function saveLd(e: React.FormEvent) {
    e.preventDefault()
    setLdSaving(true); setLdMsg('')
    try {
      await patchClient({ local_dominator_url: ldUrl || null })
      setLdMsg('Saved!')
    } catch (err) {
      setLdMsg(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setLdSaving(false)
      setTimeout(() => setLdMsg(''), 3000)
    }
  }

  return (
    <div className="space-y-4">

      {/* ── Discord ────────────────────────────────────────────── */}
      <div className="card p-5">
        <div className="flex items-start gap-3 mb-4">
          <div
            className="h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: '#5865F218', border: '1px solid #5865F230' }}
          >
            <DiscordLogo size={22} aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Discord</h3>
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              Low Ad Fuel balance alerts — fires at $0 and below the per-client alert threshold.
            </p>
          </div>
        </div>
        <form onSubmit={saveDiscord} className="space-y-3">
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Channel ID</label>
            <input
              className="input"
              style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}
              value={discordId}
              onChange={e => setDiscordId(e.target.value)}
              placeholder="e.g. 123456789012345678"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={discordSaving}
              style={{ padding: '0.3rem 0.7rem', fontSize: '0.75rem' }}
            >
              {discordSaving ? 'Saving…' : 'Save'}
            </button>
            {discordMsg && (
              <span style={{ fontSize: '0.75rem', color: discordMsg === 'Saved!' ? 'var(--green)' : 'var(--red)' }}>
                {discordMsg}
              </span>
            )}
          </div>
        </form>
      </div>

      {/* ── Stripe ─────────────────────────────────────────────── */}
      <div className="card p-5">
        <div className="flex items-start gap-3 mb-4">
          <div
            className="h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: '#635BFF18', border: '1px solid #635BFF30' }}
          >
            <StripeLogo size={22} aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Stripe</h3>
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              Auto-log ad fuel payments from Stripe invoices when they arrive via webhook.
            </p>
          </div>
        </div>
        <form onSubmit={saveStripe} className="space-y-3">
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Customer ID</label>
            <input
              className="input"
              style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}
              value={stripeId}
              onChange={e => setStripeId(e.target.value)}
              placeholder="cus_…"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={stripeSaving}
              style={{ padding: '0.3rem 0.7rem', fontSize: '0.75rem' }}
            >
              {stripeSaving ? 'Saving…' : 'Save'}
            </button>
            {stripeId && (
              <button
                type="button"
                onClick={handleStripeSync}
                disabled={syncing}
                className="btn btn-secondary"
                style={{ padding: '0.3rem 0.7rem', fontSize: '0.75rem' }}
              >
                {syncing ? 'Syncing…' : 'Sync last 90 days'}
              </button>
            )}
            {stripeMsg && (
              <span style={{ fontSize: '0.75rem', color: stripeMsg === 'Saved!' ? 'var(--green)' : 'var(--red)' }}>
                {stripeMsg}
              </span>
            )}
            {syncMsg && (
              <span style={{ fontSize: '0.75rem', color: syncMsg.includes('failed') || syncMsg.includes('Error') ? 'var(--red)' : 'var(--green)' }}>
                {syncMsg}
              </span>
            )}
          </div>
        </form>
      </div>

      {/* ── Local Dominator ────────────────────────────────────── */}
      <div className="card p-5">
        <div className="flex items-start gap-3 mb-4">
          <div
            className="h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: '#f9731618', border: '1px solid #f9731630' }}
          >
            <LocalDominatorLogo size={22} aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Google Maps Ranking</h3>
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              Embeds the ranking map on the client&apos;s dashboard summary and dedicated Google Maps Ranking tab.
            </p>
          </div>
        </div>
        <form onSubmit={saveLd} className="space-y-3">
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Share URL</label>
            <input
              className="input"
              value={ldUrl}
              onChange={e => setLdUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={ldSaving}
              style={{ padding: '0.3rem 0.7rem', fontSize: '0.75rem' }}
            >
              {ldSaving ? 'Saving…' : 'Save'}
            </button>
            {ldMsg && (
              <span style={{ fontSize: '0.75rem', color: ldMsg === 'Saved!' ? 'var(--green)' : 'var(--red)' }}>
                {ldMsg}
              </span>
            )}
          </div>
        </form>
      </div>

    </div>
  )
}
