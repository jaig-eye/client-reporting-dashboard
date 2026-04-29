'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  clientId: string
  name: string
  slug: string
  discordChannelId?: string | null
  localDominatorUrl?: string | null
  stripeCustomerId?: string | null
  adFuelAlertThreshold?: number | null
}

export default function EditClientInfo({
  clientId, name, slug, discordChannelId, localDominatorUrl, stripeCustomerId, adFuelAlertThreshold,
}: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [values, setValues] = useState({
    name,
    slug,
    discord_channel_id:      discordChannelId ?? '',
    local_dominator_url:     localDominatorUrl ?? '',
    stripe_customer_id:      stripeCustomerId ?? '',
    ad_fuel_alert_threshold: adFuelAlertThreshold != null ? String(adFuelAlertThreshold) : '',
  })
  const [status,  setStatus]  = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  function field<K extends keyof typeof values>(key: K, val: string) {
    setValues(v => ({ ...v, [key]: val }))
    setStatus('idle')
  }

  function resetValues() {
    setValues({
      name,
      slug,
      discord_channel_id:      discordChannelId ?? '',
      local_dominator_url:     localDominatorUrl ?? '',
      stripe_customer_id:      stripeCustomerId ?? '',
      ad_fuel_alert_threshold: adFuelAlertThreshold != null ? String(adFuelAlertThreshold) : '',
    })
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setStatus('saving')
    setErrorMsg('')
    const threshold = values.ad_fuel_alert_threshold !== '' ? parseFloat(values.ad_fuel_alert_threshold) : null
    try {
      const res = await fetch(`/api/admin/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, ad_fuel_alert_threshold: threshold }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      setStatus('success')
      setEditing(false)
      router.refresh()
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  async function handleStripeSync() {
    setSyncing(true)
    setSyncMsg('')
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

  if (!editing) {
    return (
      <div className="space-y-2 text-sm">
        <Row label="Name" value={values.name} />
        <Row label="Slug" value={values.slug} mono />
        {values.discord_channel_id && (
          <Row label="Discord Channel ID" value={values.discord_channel_id} mono />
        )}
        {values.local_dominator_url && (
          <Row label="Local Dominator URL" value={values.local_dominator_url} mono />
        )}
        {values.stripe_customer_id && (
          <Row label="Stripe Customer ID" value={values.stripe_customer_id} mono />
        )}
        {values.ad_fuel_alert_threshold && (
          <Row label="Ad Fuel Alert Threshold" value={`$${values.ad_fuel_alert_threshold}`} />
        )}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <button onClick={() => setEditing(true)} className="btn btn-secondary" style={{ padding: '0.3rem 0.7rem', fontSize: '0.75rem' }}>
            Edit
          </button>
          {values.stripe_customer_id && (
            <button
              type="button"
              onClick={handleStripeSync}
              disabled={syncing}
              className="btn btn-secondary"
              style={{ padding: '0.3rem 0.7rem', fontSize: '0.75rem' }}
            >
              {syncing ? 'Syncing…' : 'Sync Stripe'}
            </button>
          )}
          {syncMsg && <span style={{ fontSize: '0.75rem', color: syncMsg.includes('failed') || syncMsg.includes('Error') ? 'var(--red)' : 'var(--green)' }}>{syncMsg}</span>}
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSave} className="space-y-3">
      {status === 'error' && errorMsg && (
        <p className="text-xs" style={{ color: 'var(--red)' }}>{errorMsg}</p>
      )}
      {(['name', 'slug'] as const).map(k => (
        <div key={k}>
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
            {k.charAt(0).toUpperCase() + k.slice(1)}
          </label>
          <input className="input" value={values[k]} onChange={e => field(k, e.target.value)} required />
        </div>
      ))}
      <div>
        <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
          Discord Channel ID <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>— optional, for low-balance alerts</span>
        </label>
        <input className="input" value={values.discord_channel_id} onChange={e => field('discord_channel_id', e.target.value)} placeholder="e.g. 123456789012345678" />
      </div>
      <div>
        <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
          Ad Fuel Alert Threshold ($) <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>— optional, Discord alert fires below this amount + always at $0</span>
        </label>
        <input type="number" step="1" min="0" className="input" value={values.ad_fuel_alert_threshold} onChange={e => field('ad_fuel_alert_threshold', e.target.value)} placeholder="e.g. 200" />
      </div>
      <div>
        <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
          Stripe Customer ID <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>— auto-logs ad fuel invoices from Stripe</span>
        </label>
        <input className="input" value={values.stripe_customer_id} onChange={e => field('stripe_customer_id', e.target.value)} placeholder="cus_…" />
      </div>
      <div>
        <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
          Local Dominator URL <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>— optional, embeds share link on client dashboard</span>
        </label>
        <input className="input" value={values.local_dominator_url} onChange={e => field('local_dominator_url', e.target.value)} placeholder="https://…" />
      </div>
      <div className="flex items-center gap-2">
        <button type="submit" className="btn btn-primary" disabled={status === 'saving'} style={{ padding: '0.3rem 0.7rem', fontSize: '0.75rem' }}>
          {status === 'saving' ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => { setEditing(false); resetValues() }} style={{ padding: '0.3rem 0.7rem', fontSize: '0.75rem' }}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className={mono ? 'font-mono text-xs' : 'text-sm'} style={{ color: 'var(--text-secondary)' }}>{value}</p>
    </div>
  )
}
