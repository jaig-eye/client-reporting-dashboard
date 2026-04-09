'use client'

import { useState } from 'react'

type ConnType = 'ghl' | 'wordpress'

interface FormState {
  ghl: { apiKey: string; locationId: string }
  wordpress: { siteUrl: string; username: string; appPassword: string }
}

export default function ClientDirectConnections({
  clientId,
  existingTypes,
  singleType,
}: {
  clientId: string
  existingTypes: ConnType[]
  singleType?: ConnType
}) {
  const [form, setForm] = useState<FormState>({
    ghl:       { apiKey: '', locationId: '' },
    wordpress: { siteUrl: '', username: '', appPassword: '' },
  })
  const [saving,  setSaving]  = useState<Partial<Record<ConnType, boolean>>>({})
  const [saved,   setSaved]   = useState<Partial<Record<ConnType, boolean>>>({})
  const [errors,  setErrors]  = useState<Partial<Record<ConnType, string>>>({})

  function setGhl<K extends keyof FormState['ghl']>(key: K, val: string) {
    setForm(f => ({ ...f, ghl: { ...f.ghl, [key]: val } }))
  }
  function setWp<K extends keyof FormState['wordpress']>(key: K, val: string) {
    setForm(f => ({ ...f, wordpress: { ...f.wordpress, [key]: val } }))
  }

  async function handleSubmit(type: ConnType) {
    setSaving(s => ({ ...s, [type]: true }))
    setErrors(e => ({ ...e, [type]: '' }))
    try {
      const body = type === 'ghl'
        ? { type: 'ghl',       apiKey: form.ghl.apiKey, locationId: form.ghl.locationId }
        : { type: 'wordpress', siteUrl: form.wordpress.siteUrl, username: form.wordpress.username, appPassword: form.wordpress.appPassword }
      const res = await fetch(`/api/admin/clients/${clientId}/direct-connections`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to connect')
      setSaved(s => ({ ...s, [type]: true }))
      setTimeout(() => setSaved(s => ({ ...s, [type]: false })), 3000)
      // Clear form
      if (type === 'ghl') setForm(f => ({ ...f, ghl: { apiKey: '', locationId: '' } }))
      else setForm(f => ({ ...f, wordpress: { siteUrl: '', username: '', appPassword: '' } }))
    } catch (err) {
      setErrors(e => ({ ...e, [type]: err instanceof Error ? err.message : 'Something went wrong' }))
    } finally {
      setSaving(s => ({ ...s, [type]: false }))
    }
  }

  const isGhlConnected = existingTypes.includes('ghl')
  const isWpConnected  = existingTypes.includes('wordpress')

  // ── GHL form (rendered inline or as standalone card) ──────────────────────
  const ghlForm = (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>API Key</label>
        <input
          className="input"
          type="password"
          value={form.ghl.apiKey}
          onChange={e => setGhl('apiKey', e.target.value)}
          placeholder="ghl_xxxxxxxxxxxxxxxx"
        />
      </div>
      <div>
        <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Location ID</label>
        <input
          className="input"
          value={form.ghl.locationId}
          onChange={e => setGhl('locationId', e.target.value)}
          placeholder="Location / Sub-account ID"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          className="btn btn-primary"
          style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
          disabled={saving.ghl || !form.ghl.apiKey || !form.ghl.locationId}
          onClick={() => handleSubmit('ghl')}
        >
          {saving.ghl ? 'Connecting…' : 'Connect GHL'}
        </button>
        {saved.ghl  && <span className="text-xs" style={{ color: 'var(--green)' }}>Connected ✓</span>}
        {errors.ghl && <span className="text-xs" style={{ color: 'var(--red)' }}>{errors.ghl}</span>}
      </div>
    </div>
  )

  // ── WordPress form ─────────────────────────────────────────────────────────
  const wpForm = (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Site URL</label>
        <input
          className="input"
          value={form.wordpress.siteUrl}
          onChange={e => setWp('siteUrl', e.target.value)}
          placeholder="https://yourclient.com"
        />
      </div>
      <div>
        <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Username</label>
        <input
          className="input"
          value={form.wordpress.username}
          onChange={e => setWp('username', e.target.value)}
          placeholder="WordPress username"
        />
      </div>
      <div>
        <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Application Password</label>
        <input
          className="input"
          type="password"
          value={form.wordpress.appPassword}
          onChange={e => setWp('appPassword', e.target.value)}
          placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
        />
        <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
          Generate in WordPress → Users → Your Profile → Application Passwords
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          className="btn btn-primary"
          style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
          disabled={saving.wordpress || !form.wordpress.siteUrl || !form.wordpress.username || !form.wordpress.appPassword}
          onClick={() => handleSubmit('wordpress')}
        >
          {saving.wordpress ? 'Connecting…' : 'Connect WordPress'}
        </button>
        {saved.wordpress  && <span className="text-xs" style={{ color: 'var(--green)' }}>Connected ✓</span>}
        {errors.wordpress && <span className="text-xs" style={{ color: 'var(--red)' }}>{errors.wordpress}</span>}
      </div>
    </div>
  )

  // ── Inline mode: render just the form for the requested type ──────────────
  if (singleType === 'ghl') {
    return isGhlConnected
      ? <p className="text-xs" style={{ color: 'var(--text-muted)' }}>GHL is connected. Go to connection settings to update credentials.</p>
      : ghlForm
  }
  if (singleType === 'wordpress') {
    return isWpConnected
      ? <p className="text-xs" style={{ color: 'var(--text-muted)' }}>WordPress is connected. Go to connection settings to update credentials.</p>
      : wpForm
  }

  // ── Standalone card mode (legacy — both types side by side) ───────────────
  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <div style={{ width: 28, height: 28, borderRadius: 6, background: '#fff0e6', border: '1px solid #f97316', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#ea580c' }}>GHL</div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>GoHighLevel</h3>
          {isGhlConnected && <span className="badge badge-green">Connected</span>}
        </div>
        {isGhlConnected
          ? <p className="text-xs" style={{ color: 'var(--text-muted)' }}>GHL is connected. Go to connection settings to update credentials.</p>
          : ghlForm}
      </div>
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <div style={{ width: 28, height: 28, borderRadius: 6, background: '#f0f9ff', border: '1px solid #0ea5e9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#0369a1' }}>WP</div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>WordPress</h3>
          {isWpConnected && <span className="badge badge-green">Connected</span>}
        </div>
        {isWpConnected
          ? <p className="text-xs" style={{ color: 'var(--text-muted)' }}>WordPress is connected. Go to connection settings to update credentials.</p>
          : wpForm}
      </div>
    </div>
  )
}
