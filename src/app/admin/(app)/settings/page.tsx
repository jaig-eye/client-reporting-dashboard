'use client'

// Agency Settings — /admin/settings
// Tabbed: Branding / Benchmarks / Colors / AI / Sync / Notifications

import { useEffect, useState } from 'react'
import Link from 'next/link'
import MetricLayoutEditor, { LayoutSection } from '@/components/admin/MetricLayoutEditor'
import IntegrationCard from '@/components/admin/IntegrationCard'
import IntegrationModal from '@/components/admin/IntegrationModal'
import NotificationTypeTable from '@/components/admin/NotificationTypeTable'
import { useTheme } from '@/components/ThemeProvider'
import type { ThemeMode } from '@/components/ThemeProvider'
import type { MetricLayouts } from '@/lib/metric-layouts'

const OVERVIEW_COLUMN_KEYS = ['spend', 'roas_cpl', 'conversions', 'ctr', 'clicks', 'impressions', 'sync_status', 'ad_fuel'] as const
const OVERVIEW_COLUMN_LABELS: Record<string, string> = {
  spend:       'Spend',
  roas_cpl:    'ROAS / CPA',
  conversions: 'Conversions',
  ctr:         'CTR',
  clicks:      'Clicks',
  impressions: 'Impressions',
  sync_status: 'Sync Status',
  ad_fuel:     'Ad Fuel Balance',
}
const DEFAULT_OVERVIEW_COLUMNS = ['spend', 'roas_cpl', 'conversions', 'ctr', 'sync_status']

interface Settings {
  agency_name:                    string
  agency_logo_url:                string
  favicon_url:                    string
  benchmark_roas:                 number
  benchmark_ctr:                  number
  benchmark_cpc:                  number
  benchmark_conv_rate:            number
  benchmark_cpm:                  number
  default_date_range_days:        number
  ad_fuel_cut:                    number
  cron_enabled:                   boolean
  sync_frequency:                 string
  sync_hour_utc:                  number
  sync_day_of_week:               number | null
  chart_color_spend:              string
  chart_color_prior_spend:        string
  chart_color_conversions:        string
  chart_color_prior_conversions:  string
  ai_provider:                    string
  ai_model:                       string
  ai_api_key:                     string
  openai_api_key:                 string
  notification_email:             string
  notify_topics_created:          boolean
  notify_post_generated:          boolean
  notify_post_uploaded:           boolean
  notify_topic_ready:             boolean
  notify_approval_needed:         boolean
  notify_schedule_generated:      boolean
  notify_sa_generated:            boolean
  notify_metric_alerts:           boolean
  notify_connector_errors:        boolean
  metric_alert_threshold:         number
  metric_alert_window_days:       number
  contact_stale_days:             number
  quality_gate_blocks_autopush:   boolean
  daily_alert_threshold:          number
  daily_alert_metrics:            string[]
  weekly_alert_metrics:           string[]
  overview_columns:               string[]
  metric_layouts:                 MetricLayouts | null
  hidden_connector_types:         string[]
  show_blog_posts:                boolean
  discord_bot_token:              string
  discord_ops_channel_id:         string
  crm_name:                       string
  payment_sound_url:              string
  brand_primary:                  string
  stripe_api_key:                 string
  stripe_webhook_secret:          string
  ads_sync_frequency:             string
  ads_sync_hour_utc:              number
  master_writing_prompt:          string
  serp_api_key:                   string
  serp_api_provider:              string
}

const DEFAULT: Settings = {
  agency_name:                    '',
  agency_logo_url:                '',
  favicon_url:                    '',
  benchmark_roas:                 3,
  benchmark_ctr:                  0.03,
  benchmark_cpc:                  3,
  benchmark_conv_rate:            0.03,
  benchmark_cpm:                  15,
  default_date_range_days:        30,
  ad_fuel_cut:                    0.20,
  cron_enabled:                   true,
  sync_frequency:                 'daily',
  sync_hour_utc:                  6,
  sync_day_of_week:               null,
  chart_color_spend:              '#93c5fd',
  chart_color_prior_spend:        '#94a3b8',
  chart_color_conversions:        '#059669',
  chart_color_prior_conversions:  '#34d399',
  ai_provider:                    'anthropic',
  ai_model:                       'claude-sonnet-4-6',
  ai_api_key:                     '',
  openai_api_key:                 '',
  notification_email:             '',
  notify_topics_created:          true,
  notify_post_generated:          true,
  notify_post_uploaded:           true,
  notify_topic_ready:             true,
  notify_approval_needed:         true,
  notify_schedule_generated:      true,
  notify_sa_generated:            true,
  notify_metric_alerts:           false,
  notify_connector_errors:        false,
  metric_alert_threshold:         25,
  metric_alert_window_days:       14,
  contact_stale_days:             14,
  quality_gate_blocks_autopush:   true,
  daily_alert_threshold:          50,
  daily_alert_metrics:            ['spend', 'conversions', 'cpa'],
  weekly_alert_metrics:           ['spend', 'conversions', 'cpa', 'roas', 'ctr'],
  overview_columns:               DEFAULT_OVERVIEW_COLUMNS,
  metric_layouts:                 null,
  hidden_connector_types:         [],
  show_blog_posts:                false,
  discord_bot_token:              '',
  discord_ops_channel_id:         '',
  crm_name:                       'CRM',
  brand_primary:                  '#2563eb',
  stripe_api_key:                 '',
  stripe_webhook_secret:          '',
  ads_sync_frequency:             'hourly',
  ads_sync_hour_utc:              0,
  master_writing_prompt:          '',
  serp_api_key:                   '',
  serp_api_provider:              'serpapi',
  payment_sound_url:              '',
}

const TABS = [
  { id: 'branding',      label: 'Branding'      },
  { id: 'benchmarks',    label: 'Benchmarks'    },
  { id: 'colors',        label: 'Colors'        },
  { id: 'ai',            label: 'AI'            },
  { id: 'sync',          label: 'Sync'          },
  { id: 'notifications', label: 'Notifications' },
  { id: 'layouts',       label: 'Layouts'       },
]

const HIDEABLE_CONNECTORS = [
  { type: 'google_analytics',      label: 'GA4 Analytics',        hint: 'Users, sessions, conversions — Google Analytics 4 tab'         },
  { type: 'google_search_console', label: 'Search Console (GSC)',  hint: 'Keyword positions, impressions, click-through rates'           },
  { type: 'ahrefs',                label: 'Ahrefs Authority',      hint: 'Domain rating, backlinks, and keyword rankings'                },
  { type: 'ghl',                   label: 'CRM (LaunchLocal)',     hint: 'Contacts, calls, forms, opportunities — GoHighLevel CRM tab'   },
]

export default function AgencySettingsPage() {
  const [activeTab,  setActiveTab]  = useState('branding')
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(() => new Set(['branding']))
  const [form,       setForm]       = useState<Settings>(DEFAULT)
  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [saved,      setSaved]      = useState(false)
  const [error,      setError]      = useState('')
  const [uploading,        setUploading]        = useState(false)
  const [faviconUploading, setFaviconUploading] = useState(false)
  const [soundUploading,   setSoundUploading]   = useState(false)
  const [soundTesting,     setSoundTesting]     = useState(false)
  const [testingEmail,   setTestingEmail]   = useState(false)
  const [testEmailMsg,   setTestEmailMsg]   = useState('')

  // ── Integration modals (AI) ───────────────────────────────────────────
  // Note: Search API (SerpAPI) and Discord are configured on the Integrations
  // page (/admin/connections) — not here.
  const [aiModalOpen,        setAiModalOpen]        = useState(false)
  const [aiModalProvider,    setAiModalProvider]    = useState('')
  const [aiModalModel,       setAiModalModel]       = useState('')
  const [aiModalKey,         setAiModalKey]         = useState('')
  const [aiJustSaved,        setAiJustSaved]        = useState(false)

  const [imgModalOpen,       setImgModalOpen]       = useState(false)
  const [imgModalKey,        setImgModalKey]        = useState('')
  const [imgJustSaved,       setImgJustSaved]       = useState(false)

  function openAiModal()      { setAiModalProvider(form.ai_provider); setAiModalModel(form.ai_model); setAiModalKey(form.ai_api_key);    setAiModalOpen(true) }
  function openImgModal()     { setImgModalKey(form.openai_api_key);                                                                      setImgModalOpen(true) }

  async function saveAiCredential() {
    const res = await fetch('/api/admin/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ai_provider: aiModalProvider, ai_model: aiModalModel, ai_api_key: aiModalKey }),
    })
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Save failed') }
    setForm(f => ({ ...f, ai_provider: aiModalProvider, ai_model: aiModalModel, ai_api_key: aiModalKey }))
  }

  async function saveImgCredential() {
    const res = await fetch('/api/admin/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ openai_api_key: imgModalKey }),
    })
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Save failed') }
    setForm(f => ({ ...f, openai_api_key: imgModalKey }))
  }

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

  async function handleFaviconUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const allowed = ['image/png', 'image/x-icon', 'image/vnd.microsoft.icon']
    if (!allowed.includes(file.type)) { setError('Favicon must be a PNG or .ico file'); return }
    if (file.size > 512 * 1024) { setError('Favicon must be under 512 KB'); return }
    setFaviconUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('folder', 'favicons')
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (data.url) {
        field('favicon_url', data.url)
        // Save immediately
        await fetch('/api/admin/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ favicon_url: data.url }),
        })
      } else {
        throw new Error(data.error || 'Upload failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Favicon upload failed')
    } finally {
      setFaviconUploading(false)
    }
  }

  async function handleSoundUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const allowed = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/aac']
    if (!allowed.includes(file.type) && !file.name.match(/\.(mp3|wav|ogg|aac|m4a)$/i)) {
      setError('Sound must be an MP3, WAV, OGG, or AAC file'); return
    }
    if (file.size > 10 * 1024 * 1024) { setError('Sound file must be under 10 MB'); return }
    setSoundUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('folder', 'sounds')
      const res  = await fetch('/api/upload', { method: 'POST', body: fd })
      const data = await res.json() as { url?: string; error?: string }
      if (data.url) {
        field('payment_sound_url', data.url)
        // Auto-save immediately like favicon
        await fetch('/api/admin/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payment_sound_url: data.url }),
        })
      } else {
        throw new Error(data.error || 'Upload failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sound upload failed')
    } finally {
      setSoundUploading(false)
    }
  }

  async function handleTestSound() {
    if (!form.payment_sound_url) return
    setSoundTesting(true)
    try {
      const audio = new Audio(form.payment_sound_url)
      audio.volume = 0.7
      await audio.play()
      setTimeout(() => setSoundTesting(false), 2000)
    } catch {
      setSoundTesting(false)
      setError('Could not play sound — check browser autoplay settings')
    }
  }

  useEffect(() => {
    fetch('/api/admin/settings')
      .then(r => r.json())
      .then(settings => { setForm({ ...DEFAULT, ...settings }); setLoading(false) })
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
    // SerpAPI + Discord credentials are now edited on the Integrations page. Strip
    // them from this whole-form save so a stale copy here can never overwrite a value
    // set there.
    const saveForm = { ...form } as Record<string, unknown>
    delete saveForm.serp_api_key
    delete saveForm.serp_api_provider
    delete saveForm.discord_bot_token
    delete saveForm.discord_ops_channel_id
    const res = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(saveForm),
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

  async function handleTestEmail() {
    if (!form.notification_email) return
    setTestingEmail(true)
    setTestEmailMsg('')
    try {
      const res = await fetch('/api/admin/content/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'test', email: form.notification_email }),
      })
      const data = await res.json()
      setTestEmailMsg(data.error ? `Error: ${data.error}` : 'Test email sent!')
    } catch {
      setTestEmailMsg('Failed to send test email')
    } finally {
      setTestingEmail(false)
    }
  }

  if (loading) {
    return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
  }

  return (
    <div className="max-w-2xl">
      <div className="page-header">
        <h1 className="page-title">Agency Settings</h1>
      </div>

      {/* Tab nav */}
      <style>{`.settings-tabs::-webkit-scrollbar { display: none; }`}</style>
      <div className="settings-tabs" style={{
        display: 'flex', gap: 2, marginBottom: '1.5rem',
        borderBottom: '1px solid var(--border-subtle)',
        overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none',
      }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => { setActiveTab(tab.id); setVisitedTabs(p => new Set(p).add(tab.id)) }}
            style={{
              padding: '0.5rem 1rem', border: 'none', background: 'transparent',
              fontSize: '0.8125rem', fontWeight: activeTab === tab.id ? 600 : 400,
              color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: activeTab === tab.id ? '2px solid var(--accent, var(--blue))' : '2px solid transparent',
              cursor: 'pointer', whiteSpace: 'nowrap', marginBottom: -1,
              transition: 'color 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSave} className="space-y-5">

        {/* ─── Branding ──────────────────────────────────────────── */}
        {visitedTabs.has('branding') && <div style={{ display: activeTab === 'branding' ? 'block' : 'none' }}>
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
            <FormField label="Browser Favicon" hint="PNG or .ico file shown as the browser tab icon across the admin platform. Max 512 KB.">
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  {form.favicon_url && (
                    <img src={form.favicon_url} alt="Favicon preview" style={{ width: 32, height: 32, objectFit: 'contain', borderRadius: 4, border: '1px solid var(--border)' }} />
                  )}
                  <label className="btn btn-secondary cursor-pointer" style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}>
                    {faviconUploading ? 'Uploading…' : form.favicon_url ? 'Replace Favicon' : 'Upload Favicon'}
                    <input type="file" accept=".png,.ico,image/png,image/x-icon" className="hidden" onChange={handleFaviconUpload} disabled={faviconUploading} />
                  </label>
                  {form.favicon_url && (
                    <button type="button" className="btn btn-secondary" style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
                      onClick={() => field('favicon_url', '')}>
                      Remove
                    </button>
                  )}
                </div>
                <p className="text-xs" style={{ color: 'var(--text-faint)' }}>PNG is recommended — supported by all modern browsers. ICO files also accepted.</p>
              </div>
            </FormField>
            <FormField label="CRM Integration Name" hint="White-label name shown to clients (e.g. 'CRM', 'Pipeline', 'GoHighLevel')">
              <input
                className="input"
                value={form.crm_name}
                onChange={e => field('crm_name', e.target.value)}
                placeholder="CRM"
              />
            </FormField>
          </div>
        </div>}

        {/* ─── Benchmarks ────────────────────────────────────────── */}
        {visitedTabs.has('benchmarks') && <div style={{ display: activeTab === 'benchmarks' ? 'block' : 'none' }}>
          <div className="space-y-5">
            <div className="card p-6 space-y-4">
              <div>
                <h2 className="section-title">Performance Benchmarks</h2>
                <p className="section-desc">Used to calculate the Marketing Efficiency Score on client dashboards.</p>
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

            <div className="card p-6 space-y-4">
              <div>
                <h2 className="section-title">Ad Fuel</h2>
                <p className="section-desc">
                  Agency margin applied to raw platform spend. Ad Fuel Spend = raw spend ÷ (1 − cut).
                  Example: $800 raw at 20% cut = $1,000 billed to client.
                  Individual clients can override this.
                </p>
              </div>
              <FormField label="Global Ad Fuel Cut (%)" hint="e.g. 20 = agency keeps 20%">
                <input type="number" step="0.1" min="0" max="99" className="input"
                  value={parseFloat((form.ad_fuel_cut * 100).toFixed(2))}
                  onChange={e => field('ad_fuel_cut', Math.min(0.99, parseFloat(e.target.value) / 100) || 0)} />
              </FormField>
            </div>

            <div className="card p-6 space-y-5">
              <div>
                <h2 className="section-title">Client Dashboard Visibility</h2>
                <p className="section-desc">
                  Hide specific data tabs from all client dashboards globally. Connections remain active and data still syncs — tabs are just not shown to clients.
                </p>
              </div>
              <div className="space-y-3">
                {HIDEABLE_CONNECTORS.map(({ type, label, hint }) => (
                  <Toggle
                    key={type}
                    label={`Show ${label}`}
                    hint={hint}
                    checked={!form.hidden_connector_types.includes(type)}
                    onChange={visible => {
                      const current = form.hidden_connector_types
                      field(
                        'hidden_connector_types',
                        visible
                          ? current.filter(t => t !== type)
                          : [...current.filter(t => t !== type), type]
                      )
                    }}
                  />
                ))}
                <Toggle
                  label="Show Blog Posts"
                  hint="Content calendar blog posts — upcoming and recently published posts tab on client dashboards"
                  checked={form.show_blog_posts}
                  onChange={v => field('show_blog_posts', v)}
                />
              </div>
            </div>
          </div>
        </div>}

        {/* ─── Colors ────────────────────────────────────────────── */}
        {visitedTabs.has('colors') && <div style={{ display: activeTab === 'colors' ? 'block' : 'none' }}>
          <div className="space-y-5">
            {/* Agency brand color */}
            <div className="card p-6 space-y-4">
              <div>
                <h2 className="section-title">Agency Brand Color</h2>
                <p className="section-desc">Primary color used across the admin interface and client dashboards. Individual users can override with their own accent.</p>
              </div>
              <FormField label="Brand Color">
                <ColorInput value={form.brand_primary} onChange={v => field('brand_primary', v)} />
              </FormField>
            </div>

            {/* Per-user theme preferences */}
            <ThemeControls />

            {/* Chart colors */}
            <div className="card p-6 space-y-4">
              <div>
                <h2 className="section-title">Chart Colors</h2>
                <p className="section-desc">Customize colors used in the Daily Performance chart on all client dashboards.</p>
              </div>
              <div className="grid grid-cols-1 gap-4">
                <FormField label="Spend (current period)">
                  <ColorInput value={form.chart_color_spend} onChange={v => field('chart_color_spend', v)} />
                </FormField>
                <FormField label="Spend (prior period)">
                  <ColorInput value={form.chart_color_prior_spend} onChange={v => field('chart_color_prior_spend', v)} />
                </FormField>
                <FormField label="Conversions (current period)">
                  <ColorInput value={form.chart_color_conversions} onChange={v => field('chart_color_conversions', v)} />
                </FormField>
                <FormField label="Conversions (prior period)">
                  <ColorInput value={form.chart_color_prior_conversions} onChange={v => field('chart_color_prior_conversions', v)} />
                </FormField>
              </div>
            </div>
          </div>
        </div>}

        {/* ─── AI ────────────────────────────────────────────────── */}
        {visitedTabs.has('ai') && <div style={{ display: activeTab === 'ai' ? 'block' : 'none' }}>
          <div className="space-y-5">
          <IntegrationCard
            icon="🤖"
            name="AI Configuration"
            description="Provider, model, and API key used for content generation and topic suggestions."
            isConnected={!!form.ai_api_key}
            connectedLabel={form.ai_api_key ? `${form.ai_provider} / ${form.ai_model || 'default'}` : undefined}
            onConfigure={openAiModal}
            justConnected={aiJustSaved}
          />
          <IntegrationModal
            open={aiModalOpen}
            onClose={() => setAiModalOpen(false)}
            onSaved={() => { setAiJustSaved(true); setTimeout(() => setAiJustSaved(false), 2000) }}
            title="AI Configuration"
            icon="🤖"
            isConnected={!!form.ai_api_key}
            howTo={
              <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
                <li><strong>OpenAI:</strong> Go to <strong>platform.openai.com → API Keys</strong> and create a new secret key (<code>sk-…</code>). Set model to <code>gpt-4o</code> or <code>gpt-4o-mini</code>.</li>
                <li><strong>Anthropic:</strong> Go to <strong>console.anthropic.com → API Keys</strong> and create a key. Set model to <code>claude-sonnet-4-6</code>.</li>
                <li>The master writing prompt is managed in <a href="/admin/content?tab=settings" style={{ color: 'var(--blue)' }}>Content → Settings</a>.</li>
              </ol>
            }
            onSave={saveAiCredential}
          >
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Provider</label>
              <select className="input" value={aiModalProvider} onChange={e => setAiModalProvider(e.target.value)} style={{ width: '100%' }}>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic (Claude)</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Model</label>
              <input className="input" type="text" value={aiModalModel} onChange={e => setAiModalModel(e.target.value)}
                placeholder={aiModalProvider === 'openai' ? 'gpt-4o' : 'claude-sonnet-4-6'} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>
                API Key <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>— stored securely, never exposed to clients</span>
              </label>
              <input className="input" type="password" value={aiModalKey} onChange={e => setAiModalKey(e.target.value)}
                placeholder="Enter API key…" autoComplete="off" style={{ width: '100%' }} />
            </div>
          </IntegrationModal>

          <IntegrationCard
            icon="🖼️"
            name="Image Generation"
            description="OpenAI API key for DALL-E 3 featured image generation — separate from the content AI key above."
            isConnected={!!form.openai_api_key}
            connectedLabel={form.openai_api_key ? 'Key configured' : undefined}
            onConfigure={openImgModal}
            justConnected={imgJustSaved}
          />
          <IntegrationModal
            open={imgModalOpen}
            onClose={() => setImgModalOpen(false)}
            onSaved={() => { setImgJustSaved(true); setTimeout(() => setImgJustSaved(false), 2000) }}
            title="Image Generation (DALL-E 3)"
            icon="🖼️"
            isConnected={!!form.openai_api_key}
            howTo={
              <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
                <li>Go to <strong>platform.openai.com → API Keys</strong> and create a new secret key (<code>sk-…</code>).</li>
                <li>Ensure the key has access to the <strong>Images</strong> model family (DALL-E 3).</li>
                <li>This key is used exclusively for generating featured images — it&apos;s separate from your content AI key.</li>
              </ol>
            }
            onSave={saveImgCredential}
          >
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>
                OpenAI API Key <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>— used for DALL-E 3 image generation only</span>
              </label>
              <input className="input" type="password" value={imgModalKey} onChange={e => setImgModalKey(e.target.value)}
                placeholder="sk-…" autoComplete="off" style={{ width: '100%' }} />
            </div>
          </IntegrationModal>

          <div className="card p-6" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <h2 className="section-title">Search API <span className="section-desc" style={{ fontWeight: 400 }}>(competitor research)</span></h2>
              <p className="section-desc" style={{ margin: 0 }}>
                Moved to <strong>Integrations</strong>. Manage the SerpAPI key alongside your other connections.
              </p>
            </div>
            <Link href="/admin/connections" className="btn btn-secondary" style={{ whiteSpace: 'nowrap' }}>
              Open Integrations
            </Link>
          </div>
          </div>
        </div>}

        {/* ─── Sync ──────────────────────────────────────────────── */}
        {visitedTabs.has('sync') && <div style={{ display: activeTab === 'sync' ? 'block' : 'none' }}>
          <div className="space-y-5">
          <div className="card p-6 space-y-5">
            <div>
              <h2 className="section-title mb-1">Ad Data Sync</h2>
              <p className="section-desc">Google Ads + Meta Ads — synced on this schedule (default: hourly for near-real-time ad fuel tracking).</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Frequency">
                <select className="input" value={form.ads_sync_frequency} onChange={e => field('ads_sync_frequency', e.target.value)}>
                  <option value="hourly">Hourly</option>
                  <option value="every2h">Every 2 hours</option>
                  <option value="every6h">Every 6 hours</option>
                  <option value="every12h">Every 12 hours</option>
                  <option value="daily">Daily</option>
                </select>
              </FormField>
              {form.ads_sync_frequency !== 'hourly' && (
                <FormField label="Hour (UTC)" hint="0–23">
                  <input type="number" min={0} max={23} className="input"
                    value={form.ads_sync_hour_utc}
                    onChange={e => field('ads_sync_hour_utc', parseInt(e.target.value))} />
                </FormField>
              )}
            </div>
          </div>

          <div className="card p-6 space-y-5">
            <div>
              <h2 className="section-title mb-1">All Other Data Sync</h2>
              <p className="section-desc">GA4, Search Console, GHL, Ahrefs, etc. The cron runs hourly but only syncs when your schedule says to.</p>
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
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
                {form.cron_enabled ? 'Sync enabled' : 'Sync disabled'}
              </span>
            </label>

            <div className="grid grid-cols-2 gap-4">
              <FormField label="Frequency">
                <select className="input" value={form.sync_frequency} onChange={e => field('sync_frequency', e.target.value)}>
                  <option value="hourly">Hourly</option>
                  <option value="every6h">Every 6 hours</option>
                  <option value="every12h">Every 12 hours</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </FormField>

              {form.sync_frequency !== 'hourly' && (
                <FormField label="Hour (UTC)" hint="0–23">
                  <input
                    type="number" min={0} max={23} className="input"
                    value={form.sync_hour_utc}
                    onChange={e => field('sync_hour_utc', parseInt(e.target.value))}
                  />
                </FormField>
              )}

              {form.sync_frequency === 'weekly' && (
                <FormField label="Day of Week">
                  <select className="input" value={form.sync_day_of_week ?? 1} onChange={e => field('sync_day_of_week', parseInt(e.target.value))}>
                    {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d, i) => (
                      <option key={i} value={i}>{d}</option>
                    ))}
                  </select>
                </FormField>
              )}
            </div>

            {/* Human-readable preview */}
            <p className="text-xs rounded-lg px-3 py-2" style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
              {form.sync_frequency === 'hourly'  && 'Syncs every hour'}
              {form.sync_frequency === 'every6h' && `Syncs every 6 hours (at 0, 6, 12, 18 UTC)`}
              {form.sync_frequency === 'every12h'&& `Syncs every 12 hours (at 0 and 12 UTC)`}
              {form.sync_frequency === 'daily'   && `Syncs daily at ${form.sync_hour_utc}:00 UTC`}
              {form.sync_frequency === 'weekly'  && `Syncs every ${ ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][form.sync_day_of_week ?? 1] } at ${form.sync_hour_utc}:00 UTC`}
            </p>

            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              Re-syncs the last 3 days for all active connections (captures late conversions).
            </p>
          </div>
          </div>
        </div>}

        {/* ─── Notifications ─────────────────────────────────────── */}
        {visitedTabs.has('notifications') && <div style={{ display: activeTab === 'notifications' ? 'block' : 'none' }}>
          <div className="space-y-5">

          {/* Discord bot config now lives on the Integrations page */}
          <div className="card p-6" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <h2 className="section-title">Discord Bot</h2>
              <p className="section-desc" style={{ margin: 0 }}>
                The shared bot token and agency ops channel moved to <strong>Integrations</strong>. The notification toggles below still control what gets sent.
              </p>
            </div>
            <Link href="/admin/connections" className="btn btn-secondary" style={{ whiteSpace: 'nowrap' }}>
              Open Integrations
            </Link>
          </div>

          {/* Notification type table */}
          <div className="card p-6">
            <div style={{ marginBottom: 16 }}>
              <h2 className="section-title">Notification Types</h2>
              <p className="section-desc">Control which events send to Agency Discord, Global Emails, the Account Manager, or the Client Discord channel.</p>
            </div>
            <FormField label="Global Email Address" hint="receives all Global Emails notifications">
              <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                <input
                  className="input"
                  type="email"
                  value={form.notification_email}
                  onChange={e => field('notification_email', e.target.value)}
                  placeholder="team@agency.com"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={!form.notification_email || testingEmail}
                  onClick={handleTestEmail}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {testingEmail ? 'Sending…' : 'Send Test'}
                </button>
              </div>
              {testEmailMsg && (
                <p className="text-xs mt-1" style={{ color: testEmailMsg.startsWith('Error') ? 'var(--red)' : 'var(--green)' }}>
                  {testEmailMsg}
                </p>
              )}
            </FormField>
            <NotificationTypeTable />

            {/* Client contact window — agency default, overridable per client */}
            <div style={{ marginTop: 16, borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden' }}>
              <div style={{
                padding: '0.625rem 1rem',
                background: 'var(--bg-subtle)',
                borderBottom: '1px solid var(--border)',
              }}>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
                  Client Comms
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 12, padding: '0.75rem 1rem' }}>
                <div>
                  <div style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                    Contact window
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 1, maxWidth: 480 }}>
                    Days without a logged contact before a client shows as due a check-in. Any client can override this on their Overview tab.
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={form.contact_stale_days}
                    // Number('') is 0, so a plain Number(e.target.value) turns
                    // "select the digits and hit backspace" into a saved threshold
                    // of zero — which marks every client overdue forever. `min` is
                    // only a browser hint on an input that is never submitted.
                    onChange={e => {
                      const n = Number(e.target.value)
                      field('contact_stale_days', e.target.value === '' || !Number.isFinite(n) ? 1 : Math.min(365, Math.max(1, Math.trunc(n))))
                    }}
                    className="input"
                    style={{ width: 80, fontSize: '0.8125rem' }}
                  />
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>days</span>
                </div>
              </div>
            </div>

            {/* Content quality gate — an operational guard, grouped here because
                this tab already owns thresholds and holds. */}
            <div style={{ marginTop: 16, borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden' }}>
              <div style={{
                padding: '0.625rem 1rem',
                background: 'var(--bg-subtle)',
                borderBottom: '1px solid var(--border)',
              }}>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
                  Content Quality
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 12, padding: '0.75rem 1rem' }}>
                <div>
                  <div style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                    Hold flagged posts back from auto-publish
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 1, maxWidth: 520, lineHeight: 1.5 }}>
                    When a generated post trips a critical quality check (invented figures, approval promises, keyword stuffing, or the same structure as the rest of the site), the scheduled push skips it and raises an alert instead. Publishing by hand is never blocked. Unattended publishing is the pattern Google&rsquo;s spam update targeted, so leaving this on is the safer default.
                  </div>
                </div>
                <div style={{ width: 72, display: 'flex', justifyContent: 'center' }}>
                  <button
                    role="switch"
                    aria-checked={form.quality_gate_blocks_autopush}
                    onClick={() => field('quality_gate_blocks_autopush', !form.quality_gate_blocks_autopush)}
                    style={{
                      width: 36, height: 20, borderRadius: 999,
                      background: form.quality_gate_blocks_autopush ? '#2563eb' : 'var(--bg-subtle)',
                      border: `1px solid ${form.quality_gate_blocks_autopush ? '#2563eb' : 'var(--border)'}`,
                      cursor: 'pointer', position: 'relative',
                      transition: 'background 0.15s, border-color 0.15s',
                      padding: 0, flexShrink: 0,
                    }}
                  >
                    <span style={{
                      position: 'absolute', top: 1, left: form.quality_gate_blocks_autopush ? 17 : 1,
                      width: 16, height: 16, borderRadius: '50%', background: '#fff',
                      transition: 'left 0.15s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                    }} />
                  </button>
                </div>
              </div>
            </div>

            {/* Metric Alert Thresholds — styled to match NotificationTypeTable groups */}
            <div style={{ marginTop: 16, borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden' }}>
              {/* Group header */}
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center',
                padding: '0.625rem 1rem',
                background: 'var(--bg-subtle)',
                borderBottom: '1px solid var(--border)',
              }}>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
                  Metric Alerts
                </span>
                <div style={{ width: 72, display: 'flex', justifyContent: 'center' }}>
                  <span style={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#2563eb' }}>
                    EMAILS
                  </span>
                </div>
              </div>

              {/* Toggle row */}
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center',
                padding: '0.625rem 1rem',
                borderBottom: form.notify_metric_alerts ? '1px solid var(--border)' : 'none',
              }}>
                <div>
                  <div style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)' }}>Metric anomaly alerts</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 1, maxWidth: 480 }}>
                    Daily digest when any client metric changes beyond threshold vs the prior comparison window
                  </div>
                </div>
                <div style={{ width: 72, display: 'flex', justifyContent: 'center' }}>
                  <button
                    role="switch"
                    aria-checked={form.notify_metric_alerts}
                    onClick={() => field('notify_metric_alerts', !form.notify_metric_alerts)}
                    style={{
                      width: 36, height: 20, borderRadius: 999,
                      background: form.notify_metric_alerts ? '#2563eb' : 'var(--bg-subtle)',
                      border: `1px solid ${form.notify_metric_alerts ? '#2563eb' : 'var(--border)'}`,
                      cursor: 'pointer', position: 'relative',
                      transition: 'background 0.15s, border-color 0.15s',
                      padding: 0, flexShrink: 0,
                    }}
                  >
                    <span style={{
                      position: 'absolute', top: 2, left: form.notify_metric_alerts ? 18 : 2,
                      width: 14, height: 14, borderRadius: '50%',
                      background: 'white', transition: 'left 0.15s',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                    }} />
                  </button>
                </div>
              </div>

              {/* Threshold config */}
              {form.notify_metric_alerts && (
                <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* Day-over-day */}
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                      Day-over-day threshold (%)
                      <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}> — minimum % change between yesterday and the day before to trigger a red alert</span>
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <input
                        type="number"
                        className="input"
                        style={{ maxWidth: 100 }}
                        value={form.daily_alert_threshold}
                        min={5} max={100} step={5}
                        onChange={e => field('daily_alert_threshold', Number(e.target.value))}
                      />
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>%</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>Track these metrics daily:</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                      {(['spend', 'conversions', 'cpa'] as const).map(m => {
                        const labels: Record<string, string> = { spend: 'Spend', conversions: 'Conversions', cpa: 'CPA' }
                        const checked = (form.daily_alert_metrics ?? ['spend', 'conversions', 'cpa']).includes(m)
                        return (
                          <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.8125rem', cursor: 'pointer' }}>
                            <input type="checkbox" checked={checked} onChange={e => {
                              const cur = form.daily_alert_metrics ?? ['spend', 'conversions', 'cpa']
                              field('daily_alert_metrics', e.target.checked ? [...cur, m] : cur.filter((x: string) => x !== m))
                            }} />
                            {labels[m]}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                  {/* 7-day */}
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                      7-day comparison threshold (%)
                      <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}> — minimum % change in a 7-day window to generate a notable-change alert (sent at most once per 7 days)</span>
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <input
                        type="number"
                        className="input"
                        style={{ maxWidth: 100 }}
                        value={form.metric_alert_threshold}
                        min={5} max={100} step={5}
                        onChange={e => field('metric_alert_threshold', Number(e.target.value))}
                      />
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>%</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>Track these metrics weekly:</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                      {(['spend', 'conversions', 'cpa', 'roas', 'ctr'] as const).map(m => {
                        const labels: Record<string, string> = { spend: 'Spend', conversions: 'Conversions', cpa: 'CPA', roas: 'ROAS', ctr: 'CTR' }
                        const checked = (form.weekly_alert_metrics ?? ['spend', 'conversions', 'cpa', 'roas', 'ctr']).includes(m)
                        return (
                          <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.8125rem', cursor: 'pointer' }}>
                            <input type="checkbox" checked={checked} onChange={e => {
                              const cur = form.weekly_alert_metrics ?? ['spend', 'conversions', 'cpa', 'roas', 'ctr']
                              field('weekly_alert_metrics', e.target.checked ? [...cur, m] : cur.filter((x: string) => x !== m))
                            }} />
                            {labels[m]}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Payment Sound ───────────────────────────────────────── */}
          <div className="card p-6 space-y-4">
            <div>
              <h2 className="section-title">Payment Sound</h2>
              <p className="section-desc">
                Upload an MP3 or WAV that plays in the browser whenever a Stripe payment is successfully processed. Requires the admin dashboard to be open.
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <label className="btn btn-secondary" style={{ cursor: 'pointer', position: 'relative' }}>
                {soundUploading ? 'Uploading…' : form.payment_sound_url ? 'Replace Sound' : 'Upload Sound'}
                <input
                  type="file"
                  accept="audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/aac,.mp3,.wav,.ogg,.aac,.m4a"
                  className="hidden"
                  onChange={handleSoundUpload}
                  disabled={soundUploading}
                />
              </label>

              {form.payment_sound_url && (
                <>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleTestSound}
                    disabled={soundTesting}
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    {soundTesting ? '🔊 Playing…' : '▶ Test Sound'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ color: 'var(--red)' }}
                    onClick={async () => {
                      field('payment_sound_url', '')
                      await fetch('/api/admin/settings', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ payment_sound_url: '' }),
                      })
                    }}
                  >
                    Remove
                  </button>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>
                    {form.payment_sound_url.split('/').pop()}
                  </span>
                </>
              )}
            </div>
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              MP3, WAV, OGG, or AAC · max 10 MB · sounds play automatically in the admin browser when a payment is received
            </p>
          </div>

          </div>
        </div>}

        {/* ─── Layouts ───────────────────────────────────────────── */}
        {visitedTabs.has('layouts') && <div style={{ display: activeTab === 'layouts' ? 'block' : 'none' }}>
          <div className="card p-6 space-y-4">
            <div>
              <h2 className="section-title">Dashboard Layouts</h2>
              <p className="section-desc">
                Configure which metrics appear as KPI cards, top metrics, and table columns for each campaign type.
                These apply to all clients unless overridden in client settings.
              </p>
            </div>
            <MetricLayoutEditor
              value={form.metric_layouts}
              onChange={v => field('metric_layouts', v)}
            />
          </div>
          <div className="card p-6 space-y-4" style={{ marginTop: '1rem' }}>
            <div>
              <h2 className="section-title">Client Overview Layout</h2>
              <p className="section-desc">Choose which metric columns appear in the Clients table on the admin dashboard. Client, Sources, and Actions are always shown. Drag columns into your preferred order.</p>
            </div>
            <LayoutSection
              title="Visible Columns"
              description="Add, remove, and reorder the metric columns shown in the clients overview table"
              items={Array.isArray(form.overview_columns) ? form.overview_columns : DEFAULT_OVERVIEW_COLUMNS}
              allKeys={OVERVIEW_COLUMN_KEYS}
              labels={OVERVIEW_COLUMN_LABELS}
              onChange={cols => field('overview_columns', cols)}
            />
          </div>
        </div>}

        {/* ─── Sticky save bar ───────────────────────────────────── */}
        <div style={{
          position: 'sticky', bottom: 0,
          background: 'var(--bg-surface)',
          borderTop: '1px solid var(--border)',
          padding: '12px 0', zIndex: 10,
          display: 'flex', alignItems: 'center', gap: '0.75rem',
        }}>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
          {saved  && <span className="text-sm" style={{ color: 'var(--green)' }}>Saved ✓</span>}
          {error  && <span className="text-sm" style={{ color: 'var(--red)' }}>{error}</span>}
        </div>
      </form>
    </div>
  )
}

// ─── Per-user theme controls ──────────────────────────────────────────────────

const ACCENT_PRESETS = [
  { label: 'Blue',    value: '#2563eb' },
  { label: 'Purple',  value: '#7c3aed' },
  { label: 'Emerald', value: '#059669' },
  { label: 'Rose',    value: '#e11d48' },
  { label: 'Amber',   value: '#d97706' },
  { label: 'Slate',   value: '#475569' },
]

function ThemeControls() {
  const theme = useTheme()
  if (!theme) return null
  const { mode, accentColor, setMode, setAccent } = theme

  const modeLabels: { value: ThemeMode; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'dark',  label: 'Dark'  },
    { value: 'auto',  label: 'Auto'  },
  ]

  return (
    <div className="card p-6 space-y-5">
      <div>
        <h2 className="section-title">Your Theme Preferences</h2>
        <p className="section-desc">Personal settings — only affect your own view. Each admin can set their own.</p>
      </div>

      {/* Mode toggle */}
      <div>
        <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--text-muted)' }}>
          Color mode
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          {modeLabels.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              style={{
                padding: '0.375rem 1rem',
                borderRadius: '0.5rem',
                fontSize: '0.8125rem',
                fontWeight: mode === value ? 600 : 400,
                border: mode === value ? '2px solid var(--accent)' : '1px solid var(--border)',
                background: mode === value ? 'var(--accent-subtle)' : 'var(--bg-surface)',
                color: mode === value ? 'var(--accent)' : 'var(--text-muted)',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Accent color */}
      <div>
        <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--text-muted)' }}>
          Accent color
        </label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {ACCENT_PRESETS.map(preset => (
            <button
              key={preset.value}
              type="button"
              title={preset.label}
              onClick={() => setAccent(preset.value)}
              style={{
                width: 28, height: 28, borderRadius: '50%',
                background: preset.value,
                border: accentColor === preset.value ? '3px solid var(--text-primary)' : '2px solid transparent',
                boxShadow: accentColor === preset.value ? '0 0 0 2px var(--bg-surface), 0 0 0 4px var(--text-primary)' : '0 1px 3px rgba(0,0,0,0.2)',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            />
          ))}
          <input
            type="color"
            value={accentColor || '#2563eb'}
            onChange={e => setAccent(e.target.value)}
            title="Custom color"
            style={{
              width: 28, height: 28, borderRadius: '50%',
              padding: 2, border: '1px solid var(--border)',
              cursor: 'pointer', background: 'var(--bg-surface)',
            }}
          />
          <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)', fontFamily: 'monospace' }}>
            {accentColor}
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── helpers ──────────────────────────────────────────────────────────────────

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

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value || '#000000'}
        onChange={e => onChange(e.target.value)}
        style={{ width: '2.5rem', height: '2.25rem', padding: '0.15rem', border: '1px solid var(--border)', borderRadius: '0.375rem', cursor: 'pointer', background: 'var(--bg-surface)' }}
      />
      <input
        type="text"
        className="input"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="#000000"
        style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}
      />
      <div
        style={{ width: '2rem', height: '2rem', borderRadius: '0.375rem', border: '1px solid var(--border)', background: value, flexShrink: 0 }}
        title="Preview"
      />
    </div>
  )
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="relative inline-flex flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none"
        style={{ background: checked ? 'var(--blue)' : 'var(--bg-muted)', height: 20, width: 36, marginTop: 1 }}
      >
        <span
          className="inline-block rounded-full bg-white shadow transition-transform"
          style={{ height: 16, width: 16, transform: checked ? 'translateX(1rem)' : 'translateX(0)' }}
        />
      </button>
      <div>
        <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.3 }}>{label}</p>
        {hint && <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>{hint}</p>}
      </div>
    </div>
  )
}
