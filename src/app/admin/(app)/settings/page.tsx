'use client'

// Agency Settings — /admin/settings
// Tabbed: Branding / Benchmarks / Colors / AI / Sync / Notifications

import { useEffect, useState } from 'react'
import MetricLayoutEditor, { LayoutSection } from '@/components/admin/MetricLayoutEditor'
import IntegrationCard from '@/components/admin/IntegrationCard'
import IntegrationModal from '@/components/admin/IntegrationModal'
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
  notify_metric_alerts:           boolean
  metric_alert_threshold:         number
  metric_alert_window_days:       number
  daily_alert_threshold:          number
  daily_alert_metrics:            string[]
  weekly_alert_metrics:           string[]
  overview_columns:               string[]
  metric_layouts:                 MetricLayouts | null
  hidden_connector_types:         string[]
  discord_bot_token:              string
  crm_name:                       string
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
  notify_metric_alerts:           false,
  metric_alert_threshold:         25,
  metric_alert_window_days:       14,
  daily_alert_threshold:          50,
  daily_alert_metrics:            ['spend', 'conversions', 'cpa'],
  weekly_alert_metrics:           ['spend', 'conversions', 'cpa', 'roas', 'ctr'],
  overview_columns:               DEFAULT_OVERVIEW_COLUMNS,
  metric_layouts:                 null,
  hidden_connector_types:         [],
  discord_bot_token:              '',
  crm_name:                       'CRM',
  brand_primary:                  '#2563eb',
  stripe_api_key:                 '',
  stripe_webhook_secret:          '',
  ads_sync_frequency:             'hourly',
  ads_sync_hour_utc:              0,
  master_writing_prompt:          '',
  serp_api_key:                   '',
  serp_api_provider:              'serpapi',
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
  const [uploading,  setUploading]  = useState(false)
  const [testingEmail,   setTestingEmail]   = useState(false)
  const [testEmailMsg,   setTestEmailMsg]   = useState('')
  const [testingSerp,    setTestingSerp]    = useState(false)
  const [testSerpMsg,    setTestSerpMsg]    = useState('')

  // ── Integration modals (AI + Discord) ─────────────────────────────────
  const [aiModalOpen,        setAiModalOpen]        = useState(false)
  const [aiModalProvider,    setAiModalProvider]    = useState('')
  const [aiModalModel,       setAiModalModel]       = useState('')
  const [aiModalKey,         setAiModalKey]         = useState('')
  const [aiJustSaved,        setAiJustSaved]        = useState(false)

  const [imgModalOpen,       setImgModalOpen]       = useState(false)
  const [imgModalKey,        setImgModalKey]        = useState('')
  const [imgJustSaved,       setImgJustSaved]       = useState(false)

  const [discordModalOpen,   setDiscordModalOpen]   = useState(false)
  const [discordModalToken,  setDiscordModalToken]  = useState('')
  const [discordJustSaved,   setDiscordJustSaved]   = useState(false)

  function openAiModal()      { setAiModalProvider(form.ai_provider); setAiModalModel(form.ai_model); setAiModalKey(form.ai_api_key);    setAiModalOpen(true) }
  function openImgModal()     { setImgModalKey(form.openai_api_key);                                                                      setImgModalOpen(true) }
  function openDiscordModal() { setDiscordModalToken(form.discord_bot_token);                                                             setDiscordModalOpen(true) }

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

  async function saveDiscordCredential() {
    const res = await fetch('/api/admin/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discord_bot_token: discordModalToken }),
    })
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Save failed') }
    setForm(f => ({ ...f, discord_bot_token: discordModalToken }))
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

  async function handleTestSerp() {
    if (!form.serp_api_key) return
    setTestingSerp(true)
    setTestSerpMsg('')
    try {
      const res = await fetch('/api/admin/settings/test-serp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: form.serp_api_key }),
        signal: AbortSignal.timeout(10000),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok || data.error) {
        setTestSerpMsg(`Error: ${data.error ?? res.statusText}`)
      } else {
        setTestSerpMsg('Connected ✓')
      }
    } catch {
      setTestSerpMsg('Failed to reach SerpAPI — check key or network')
    } finally {
      setTestingSerp(false)
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

          <div className="card p-6 space-y-4">
            <div>
              <h2 className="section-title">Search API <span className="section-desc" style={{ fontWeight: 400 }}>(competitor research)</span></h2>
              <p className="section-desc">
                Used to find top-ranking competitor pages during topic generation. SerpAPI free plan: 250 searches/month.
                Only the top 3 growth-target keywords per run are researched.
              </p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr auto', gap: 8, alignItems: 'end' }}>
              <FormField label="Provider">
                <select className="input" value={form.serp_api_provider}
                  onChange={e => field('serp_api_provider', e.target.value)}>
                  <option value="serpapi">SerpAPI</option>
                </select>
              </FormField>
              <FormField label="API Key" hint="stored securely, never exposed to clients">
                <input className="input" type="password"
                  value={form.serp_api_key}
                  onChange={e => field('serp_api_key', e.target.value)}
                  placeholder={form.serp_api_key ? '••••••••••' : 'Enter SerpAPI key…'} />
              </FormField>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!form.serp_api_key || testingSerp}
                onClick={handleTestSerp}
                style={{ whiteSpace: 'nowrap', marginBottom: 0 }}
              >
                {testingSerp ? 'Testing…' : 'Test'}
              </button>
            </div>
            {testSerpMsg && (
              <p className="text-xs" style={{ color: testSerpMsg.startsWith('Error') || testSerpMsg.startsWith('Failed') ? 'var(--red)' : 'var(--green)' }}>
                {testSerpMsg}
              </p>
            )}
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
          <div className="card p-6 space-y-5">
            <div>
              <h2 className="section-title">Email Notifications</h2>
              <p className="section-desc">Receive email alerts when content events occur in the system.</p>
            </div>

            <FormField label="Notification Email" hint="receives all content alerts">
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="input"
                  type="email"
                  value={form.notification_email}
                  onChange={e => field('notification_email', e.target.value)}
                  placeholder="you@agency.com"
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

            <div className="space-y-3">
              <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Notify when:</p>
              <Toggle
                label="Topics created for a client"
                hint="Sent when new topic suggestions are generated and ready for review"
                checked={form.notify_topics_created}
                onChange={v => field('notify_topics_created', v)}
              />
              <Toggle
                label="Post uploaded to WordPress"
                hint="Sent when a generated post is uploaded to WordPress as a draft"
                checked={form.notify_post_uploaded}
                onChange={v => field('notify_post_uploaded', v)}
              />
              <Toggle
                label="Topics ready for approval"
                hint="Sent when new scheduled topics are ready for approval"
                checked={form.notify_topic_ready}
                onChange={v => field('notify_topic_ready', v)}
              />
              <Toggle
                label="Post needs approval (within 48h of publish date)"
                hint="Reminder when an approved topic's post hasn't been approved with publish date approaching"
                checked={form.notify_approval_needed}
                onChange={v => field('notify_approval_needed', v)}
              />
              <Toggle
                label="Topics auto-generated for scheduled client"
                hint="Sent when topics are automatically generated 30 days before a client's scheduled publish date"
                checked={form.notify_schedule_generated}
                onChange={v => field('notify_schedule_generated', v)}
              />
              <Toggle
                label="Metric anomaly alerts (email)"
                hint="Daily digest when any client metric changes by more than the threshold vs the prior comparison window"
                checked={form.notify_metric_alerts}
                onChange={v => field('notify_metric_alerts', v)}
              />
              {form.notify_metric_alerts && (
                <div style={{ paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
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

          <div className="card p-6 space-y-4">
            <div>
              <h2 className="section-title">Discord Notifications</h2>
              <p className="section-desc">Bot token used to post Ad Fuel low-balance alerts to per-client Discord channels.</p>
            </div>
            <IntegrationCard
              icon="🤖"
              name="Discord Bot"
              description="Shared bot for all client channels. Each client's Channel ID is configured in their Integrations tab."
              isConnected={!!form.discord_bot_token}
              connectedLabel={form.discord_bot_token ? 'Bot token configured' : undefined}
              onConfigure={openDiscordModal}
              justConnected={discordJustSaved}
            />
            <IntegrationModal
              open={discordModalOpen}
              onClose={() => setDiscordModalOpen(false)}
              onSaved={() => { setDiscordJustSaved(true); setTimeout(() => setDiscordJustSaved(false), 2000) }}
              title="Discord Bot"
              icon="🤖"
              isConnected={!!form.discord_bot_token}
              howTo={
                <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
                  <li>Go to <strong>discord.com/developers/applications</strong> and create a new application.</li>
                  <li>Open the <strong>Bot</strong> section → click <strong>Add Bot</strong>.</li>
                  <li>Under <strong>Token</strong>, click <strong>Reset Token</strong> and copy it.</li>
                  <li>Invite the bot to your server via OAuth2 with the <strong>Send Messages</strong> and <strong>View Channels</strong> permissions.</li>
                  <li>Each client&apos;s Channel ID is set in their Integrations tab (Discord card).</li>
                </ol>
              }
              onSave={saveDiscordCredential}
            >
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Bot Token</label>
                <input className="input" type="password" value={discordModalToken} onChange={e => setDiscordModalToken(e.target.value)}
                  placeholder="Bot token from Discord Developer Portal…" autoComplete="off" style={{ width: '100%' }} />
              </div>
            </IntegrationModal>
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
