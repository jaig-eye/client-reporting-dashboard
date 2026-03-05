'use client'

import { useEffect, useState } from 'react'
import AgencyBackfill from './AgencyBackfill'

interface Settings {
  agency_name: string
  agency_logo_url: string
  benchmark_roas: number
  benchmark_ctr: number
  benchmark_cpc: number
  benchmark_conv_rate: number
  benchmark_cpm: number
  default_date_range_days: number
  meta_connected: boolean
  meta_token_expires_at: string | null
  cron_enabled: boolean
}

const DEFAULT: Settings = {
  agency_name: '',
  agency_logo_url: '',
  benchmark_roas: 3,
  benchmark_ctr: 0.03,
  benchmark_cpc: 3,
  benchmark_conv_rate: 0.03,
  benchmark_cpm: 15,
  default_date_range_days: 30,
  meta_connected: false,
  meta_token_expires_at: null,
  cron_enabled: true,
}

const glassSection: React.CSSProperties = {
  background: 'rgba(255,255,255,0.025)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: '1rem',
}

export default function SettingsPage() {
  const [form, setForm]       = useState<Settings>(DEFAULT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState('')

  const [syncing, setSyncing]   = useState(false)
  const [syncMsg, setSyncMsg]   = useState('')
  const [syncErr, setSyncErr]   = useState('')

  useEffect(() => {
    fetch('/api/admin/settings')
      .then(r => r.json())
      .then(d => { setForm({ ...DEFAULT, ...d }); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  function set(key: keyof Pick<Settings, 'agency_name' | 'agency_logo_url' | 'benchmark_roas' | 'benchmark_ctr' | 'benchmark_cpc' | 'benchmark_conv_rate' | 'benchmark_cpm' | 'default_date_range_days'>, value: string | number) {
    setSaved(false)
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const body = {
      agency_name:             form.agency_name,
      agency_logo_url:         form.agency_logo_url,
      benchmark_roas:          form.benchmark_roas,
      benchmark_ctr:           form.benchmark_ctr,
      benchmark_cpc:           form.benchmark_cpc,
      benchmark_conv_rate:     form.benchmark_conv_rate,
      benchmark_cpm:           form.benchmark_cpm,
      default_date_range_days: form.default_date_range_days,
    }
    const res = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (data.error) { setError(data.error); setSaving(false) }
    else { setSaved(true); setSaving(false) }
  }

  async function handleMetaSync() {
    setSyncing(true)
    setSyncMsg('')
    setSyncErr('')
    const res = await fetch('/api/admin/accounts/sync/meta', { method: 'POST' })
    const data = await res.json()
    setSyncing(false)
    if (data.error) setSyncErr(data.error)
    else setSyncMsg(`Synced ${data.synced} Meta account${data.synced !== 1 ? 's' : ''}`)
  }

  async function toggleCron(enabled: boolean) {
    setForm(f => ({ ...f, cron_enabled: enabled }))
    setSaved(false)
    await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cron_enabled: enabled }),
    })
  }

  if (loading) {
    return <div className="text-slate-500 text-sm">Loading settings…</div>
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-lg font-semibold text-white mb-6">Agency Settings</h1>

      <form onSubmit={handleSave} className="space-y-4">

        {/* Branding */}
        <section style={glassSection} className="p-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-200 mb-1">Branding</h2>

          <Field label="Agency Name" hint="Shown in the admin header">
            <input
              value={form.agency_name}
              onChange={e => set('agency_name', e.target.value)}
              placeholder="My Agency"
              className={inputCls}
            />
          </Field>

          <Field label="Logo URL" hint="Link to your logo image (displayed in admin header)">
            <input
              value={form.agency_logo_url}
              onChange={e => set('agency_logo_url', e.target.value)}
              placeholder="https://your-agency.com/logo.png"
              className={inputCls}
            />
          </Field>
        </section>

        {/* Platform Connections */}
        <section style={glassSection} className="p-6 space-y-5">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">Platform Connections</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Connect once at the agency level. Accounts are then mapped to individual clients.
            </p>
          </div>

          {/* Meta */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-400 flex-shrink-0" />
              <span className="text-sm font-medium text-slate-300">Meta Ads</span>
            </div>

            <div className="flex items-center gap-3">
              {form.meta_connected ? (
                <span className="text-xs text-emerald-400">
                  Connected
                  {form.meta_token_expires_at && (
                    <> — expires {new Date(form.meta_token_expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</>
                  )}
                </span>
              ) : (
                <span className="text-xs text-slate-500">Not connected</span>
              )}
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <a
                href="/api/auth/meta?mode=agency"
                className="text-sm bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {form.meta_connected ? 'Reconnect Meta' : 'Connect Meta'}
              </a>
              {form.meta_connected && (
                <button
                  type="button"
                  onClick={handleMetaSync}
                  disabled={syncing}
                  className="text-sm text-slate-400 hover:text-slate-300 font-medium px-4 py-2 rounded-lg disabled:opacity-40 transition-colors"
                  style={{ border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  {syncing ? 'Syncing…' : 'Sync Accounts'}
                </button>
              )}
              {syncMsg && <span className="text-emerald-400 text-sm">{syncMsg}</span>}
              {syncErr && <span className="text-red-400 text-sm">{syncErr}</span>}
            </div>
            <p className="text-xs text-slate-600">
              Authenticates as your Business Manager admin. After connecting, click Sync
              Accounts to import all managed ad accounts into the mapping pool.
              Tokens last ~55 days — reconnect when prompted.
            </p>
          </div>

          {/* Google */}
          <div className="space-y-2 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
              <span className="text-sm font-medium text-slate-300">Google Ads</span>
            </div>
            <p className="text-xs text-slate-500">
              Google accounts are auto-registered when your MCC script runs — no token
              needed here. After the first script run, accounts appear in the client
              mapping dropdown automatically.
            </p>
          </div>
        </section>

        {/* Benchmarks */}
        <section style={glassSection} className="p-6 space-y-4">
          <div className="mb-1">
            <h2 className="text-sm font-semibold text-slate-200">Performance Benchmarks</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Used to calculate the Marketing Efficiency Score on client dashboards.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Target ROAS" hint="e.g. 3.0 = 300%">
              <input type="number" step="0.1" min="0"
                value={form.benchmark_roas}
                onChange={e => set('benchmark_roas', parseFloat(e.target.value))}
                className={inputCls}
              />
            </Field>

            <Field label="Target CPC ($)" hint="e.g. 3.00">
              <input type="number" step="0.01" min="0"
                value={form.benchmark_cpc}
                onChange={e => set('benchmark_cpc', parseFloat(e.target.value))}
                className={inputCls}
              />
            </Field>

            <Field label="Target CTR (%)" hint="e.g. 3 = 3%">
              <input type="number" step="0.1" min="0" max="100"
                value={parseFloat((form.benchmark_ctr * 100).toFixed(4))}
                onChange={e => set('benchmark_ctr', parseFloat(e.target.value) / 100)}
                className={inputCls}
              />
            </Field>

            <Field label="Target Conv. Rate (%)" hint="e.g. 3 = 3%">
              <input type="number" step="0.1" min="0" max="100"
                value={parseFloat((form.benchmark_conv_rate * 100).toFixed(4))}
                onChange={e => set('benchmark_conv_rate', parseFloat(e.target.value) / 100)}
                className={inputCls}
              />
            </Field>

            <Field label="Target CPM ($)" hint="e.g. 15.00">
              <input type="number" step="0.01" min="0"
                value={form.benchmark_cpm}
                onChange={e => set('benchmark_cpm', parseFloat(e.target.value))}
                className={inputCls}
              />
            </Field>

            <Field label="Default Date Range (days)" hint="e.g. 30">
              <input type="number" step="1" min="1" max="365"
                value={form.default_date_range_days}
                onChange={e => set('default_date_range_days', parseInt(e.target.value))}
                className={inputCls}
              />
            </Field>
          </div>
        </section>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-5 py-2.5 rounded-lg disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
          {saved && <span className="text-emerald-400 text-sm">Saved</span>}
        </div>
      </form>

      {/* Historical Data Backfill */}
      <section style={glassSection} className="mt-4 p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Historical Data Backfill</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Pulls up to {730} days of history for accounts that have no data yet.
            Accounts that already have data are skipped automatically — no duplicates.
            Runs in 30-day batches to avoid timeouts.
          </p>
        </div>
        <AgencyBackfill />
      </section>

      {/* Sync Schedule */}
      <section style={glassSection} className="mt-4 p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Sync Schedule</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Automated daily sync keeps all client dashboards up to date.
          </p>
        </div>

        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <button
              type="button"
              role="switch"
              aria-checked={form.cron_enabled}
              onClick={() => toggleCron(!form.cron_enabled)}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                form.cron_enabled ? 'bg-blue-600' : 'bg-white/[0.06]'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  form.cron_enabled ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
            <span className="text-sm text-slate-300">
              {form.cron_enabled ? 'Enabled' : 'Disabled'}
            </span>
          </label>

          <div className="text-xs text-slate-500 space-y-1">
            <p>Schedule: <span className="text-slate-400 font-mono">0 6 * * *</span> — daily at 6:00 AM UTC</p>
            <p>Syncs the last 3 days for all clients (catches late-arriving conversions).</p>
            <p className="text-slate-600">
              Schedule is defined in <span className="font-mono">vercel.json</span>. Toggle above pauses execution
              without removing the schedule.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}

const inputCls =
  'w-full bg-black/40 border border-white/10 text-slate-200 placeholder-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 transition-colors'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-400 mb-1">
        {label}
        {hint && <span className="text-slate-600 font-normal ml-1">— {hint}</span>}
      </label>
      {children}
    </div>
  )
}
