'use client'

// Agency Settings — /admin/settings
// Branding, performance benchmarks, default conversion value, and sync schedule.
// Platform connections have moved to /admin/connections.

import { useEffect, useState } from 'react'

interface Settings {
  agency_name:              string
  agency_logo_url:          string
  benchmark_roas:           number
  benchmark_ctr:            number
  benchmark_cpc:            number
  benchmark_conv_rate:      number
  benchmark_cpm:            number
  default_date_range_days:  number
  default_conversion_value: number
  ad_fuel_cut:              number
  cron_enabled:             boolean
}

const DEFAULT: Settings = {
  agency_name:              '',
  agency_logo_url:          '',
  benchmark_roas:           3,
  benchmark_ctr:            0.03,
  benchmark_cpc:            3,
  benchmark_conv_rate:      0.03,
  benchmark_cpm:            15,
  default_date_range_days:  30,
  default_conversion_value: 0,
  ad_fuel_cut:              0.20,
  cron_enabled:             true,
}

export default function AgencySettingsPage() {
  const [form,      setForm]      = useState<Settings>(DEFAULT)
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)
  const [saved,     setSaved]     = useState(false)
  const [error,     setError]     = useState('')
  const [uploading, setUploading] = useState(false)

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('folder', 'logos')
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (data.url) field('agency_logo_url', data.url)
      else throw new Error(data.error || 'Upload failed')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Logo upload failed')
    } finally {
      setUploading(false)
    }
  }

  useEffect(() => {
    fetch('/api/admin/settings')
      .then(r => r.json())
      .then(d => { setForm({ ...DEFAULT, ...d }); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  function field<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSaved(false)
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const res = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    if (data.error) { setError(data.error); setSaving(false) }
    else { setSaved(true); setSaving(false) }
  }

  async function toggleCron(enabled: boolean) {
    setForm(f => ({ ...f, cron_enabled: enabled }))
    await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cron_enabled: enabled }),
    })
  }

  if (loading) {
    return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
  }

  return (
    <div className="max-w-2xl">
      <div className="page-header">
        <h1 className="page-title">Agency Settings</h1>
      </div>

      <form onSubmit={handleSave} className="space-y-5">

        {/* Branding */}
        <div className="card p-6 space-y-4">
          <h2 className="section-title">Branding</h2>
          <FormField label="Agency Name">
            <input
              className="input"
              value={form.agency_name}
              onChange={e => field('agency_name', e.target.value)}
              placeholder="My Agency"
            />
          </FormField>
          <FormField label="Agency Logo" hint="Shown in the admin sidebar and client dashboards">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                {form.agency_logo_url && (
                  <img src={form.agency_logo_url} alt="Agency logo" className="h-10 object-contain rounded" />
                )}
                <label className="btn btn-secondary cursor-pointer" style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}>
                  {uploading ? 'Uploading…' : form.agency_logo_url ? 'Replace Logo' : 'Upload Logo'}
                  <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} disabled={uploading} />
                </label>
                {form.agency_logo_url && (
                  <button type="button" className="btn btn-secondary" style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
                    onClick={() => field('agency_logo_url', '')}>
                    Remove
                  </button>
                )}
              </div>
              <input
                className="input"
                value={form.agency_logo_url}
                onChange={e => field('agency_logo_url', e.target.value)}
                placeholder="Or paste image URL…"
              />
            </div>
          </FormField>
        </div>

        {/* Performance Benchmarks */}
        <div className="card p-6 space-y-4">
          <div>
            <h2 className="section-title">Performance Benchmarks</h2>
            <p className="section-desc">
              Used to calculate the Marketing Efficiency Score on client dashboards.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Target ROAS" hint="e.g. 3.0 = 300%">
              <input type="number" step="0.1" min="0" className="input"
                value={form.benchmark_roas}
                onChange={e => field('benchmark_roas', parseFloat(e.target.value))} />
            </FormField>
            <FormField label="Target CPC ($)">
              <input type="number" step="0.01" min="0" className="input"
                value={form.benchmark_cpc}
                onChange={e => field('benchmark_cpc', parseFloat(e.target.value))} />
            </FormField>
            <FormField label="Target CTR (%)" hint="e.g. 3 = 3%">
              <input type="number" step="0.1" min="0" max="100" className="input"
                value={parseFloat((form.benchmark_ctr * 100).toFixed(4))}
                onChange={e => field('benchmark_ctr', parseFloat(e.target.value) / 100)} />
            </FormField>
            <FormField label="Target Conv. Rate (%)" hint="e.g. 3 = 3%">
              <input type="number" step="0.1" min="0" max="100" className="input"
                value={parseFloat((form.benchmark_conv_rate * 100).toFixed(4))}
                onChange={e => field('benchmark_conv_rate', parseFloat(e.target.value) / 100)} />
            </FormField>
            <FormField label="Target CPM ($)">
              <input type="number" step="0.01" min="0" className="input"
                value={form.benchmark_cpm}
                onChange={e => field('benchmark_cpm', parseFloat(e.target.value))} />
            </FormField>
            <FormField label="Default Date Range (days)">
              <input type="number" step="1" min="1" max="365" className="input"
                value={form.default_date_range_days}
                onChange={e => field('default_date_range_days', parseInt(e.target.value))} />
            </FormField>
          </div>
        </div>

        {/* Conversion Value Defaults */}
        <div className="card p-6 space-y-4">
          <div>
            <h2 className="section-title">Conversion Value Default</h2>
            <p className="section-desc">
              Applied when no client or campaign-level override is set.
              Hierarchy: campaign override → client override → this value.
            </p>
          </div>
          <FormField label="Default Conversion Value ($)" hint="Leave as 0 if not applicable">
            <input type="number" step="0.01" min="0" className="input"
              value={form.default_conversion_value}
              onChange={e => field('default_conversion_value', parseFloat(e.target.value) || 0)} />
          </FormField>
        </div>

        {/* Ad Fuel */}
        <div className="card p-6 space-y-4">
          <div>
            <h2 className="section-title">Ad Fuel</h2>
            <p className="section-desc">
              Agency margin applied to raw platform spend. Ad Fuel Spend = raw spend ÷ (1 − cut).
              Example: $800 raw spend at 20% cut = $1,000 Ad Fuel billed to client.
              Individual clients can override this in their settings.
            </p>
          </div>
          <FormField label="Global Ad Fuel Cut (%)" hint="e.g. 20 = agency keeps 20% of Ad Fuel">
            <input type="number" step="0.1" min="0" max="99" className="input"
              value={parseFloat((form.ad_fuel_cut * 100).toFixed(2))}
              onChange={e => field('ad_fuel_cut', Math.min(0.99, parseFloat(e.target.value) / 100) || 0)} />
          </FormField>
        </div>

        {error && <p className="text-sm" style={{ color: 'var(--red)' }}>{error}</p>}

        <div className="flex items-center gap-3">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
          {saved && (
            <span className="text-sm" style={{ color: 'var(--green)' }}>Saved ✓</span>
          )}
        </div>
      </form>

      {/* Sync Schedule */}
      <div className="card p-6 mt-5">
        <h2 className="section-title mb-1">Sync Schedule</h2>
        <p className="section-desc mb-4">
          Automated daily sync keeps all client dashboards up to date.
        </p>
        <label className="flex items-center gap-3 cursor-pointer mb-3">
          <button
            type="button"
            role="switch"
            aria-checked={form.cron_enabled}
            onClick={() => toggleCron(!form.cron_enabled)}
            className="relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none"
            style={{ background: form.cron_enabled ? 'var(--blue)' : 'var(--bg-muted)' }}
          >
            <span
              className="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform"
              style={{ transform: form.cron_enabled ? 'translateX(1rem)' : 'translateX(0)' }}
            />
          </button>
          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {form.cron_enabled ? 'Enabled' : 'Disabled'}
          </span>
        </label>
        <div className="text-xs space-y-1" style={{ color: 'var(--text-muted)' }}>
          <p>Schedule: <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>0 6 * * *</span> — daily at 6:00 AM UTC</p>
          <p>Re-syncs the last 3 days for all active connections (captures late conversions).</p>
        </div>
      </div>
    </div>
  )
}

function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
        {label}
        {hint && <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}> — {hint}</span>}
      </label>
      {children}
    </div>
  )
}
