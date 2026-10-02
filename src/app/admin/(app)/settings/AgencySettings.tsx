'use client'

// Agency settings — /admin/settings. Seven pill tabs that follow ?tab= (replaceState, so switching
// tabs never asks the server for anything), each a column of Sections, and one save bar for the
// fields that wait for Save. Things that save the moment they change say so: uploads, the theme,
// the sync switch, the AI keys (their dialogs) and the notification channels (their own bar).

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle, Clock, ImageSquare, Play, Sparkle, SpeakerHigh, Trash, UploadSimple, WarningCircle } from '@phosphor-icons/react'
import MetricLayoutEditor, { LayoutSection } from '@/components/admin/MetricLayoutEditor'
import IntegrationCard from '@/components/admin/IntegrationCard'
import IntegrationModal from '@/components/admin/IntegrationModal'
import NotificationTypeTable from '@/components/admin/NotificationTypeTable'
import { IntegrationGroup } from '@/components/admin/integrations/IntegrationRow'
import PageHeader from '@/components/ui/PageHeader'
import Section from '@/components/ui/Section'
import Field from '@/components/ui/Field'
import { SwitchRow } from '@/components/ui/Switch'
import { PillTabs } from '@/components/ui/PillTabs'
import EmptyState from '@/components/ui/EmptyState'
import { useTheme } from '@/components/ThemeProvider'
import { IMAGE_MODELS, DEFAULT_IMAGE_MODEL, resolveImageModel } from '@/lib/content/imageModels'
import type { ThemeMode } from '@/components/ThemeProvider'
import type { MetricLayouts } from '@/lib/metric-layouts'
import { SettingsSkeleton } from './SettingsSkeleton'
import { SETTINGS_TABS, type SettingsTab } from './tabs'

const OVERVIEW_COLUMN_KEYS = ['spend', 'roas_cpl', 'conversions', 'ctr', 'clicks', 'impressions', 'sync_status', 'ad_fuel'] as const
const OVERVIEW_COLUMN_LABELS: Record<string, string> = {
  spend:       'Spend',
  roas_cpl:    'ROAS / CPA',
  conversions: 'Conversions',
  ctr:         'CTR',
  clicks:      'Clicks',
  impressions: 'Impressions',
  sync_status: 'Sync status',
  ad_fuel:     'Ad Fuel balance',
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
  image_model:                    string
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

// The defaults are data (the colours a new agency starts with), not styling.
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
  image_model:                    DEFAULT_IMAGE_MODEL,
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

const HIDEABLE_CONNECTORS = [
  { type: 'google_analytics',      label: 'Analytics',      hint: 'Users, sessions and conversions from Google Analytics 4.' },
  { type: 'google_search_console', label: 'Search Console', hint: 'Keyword positions, impressions and click-through rates.'  },
  { type: 'ahrefs',                label: 'Authority',      hint: 'Domain rating, backlinks and keyword rankings from Ahrefs.' },
  { type: 'ghl',                   label: 'CRM',            hint: 'Contacts, calls, forms and opportunities from HighLevel.'   },
]

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** A schedule in words: "Syncs daily at 6:00 UTC". */
function scheduleInWords(frequency: string, hour: number, day: number | null): string {
  switch (frequency) {
    case 'hourly':   return 'Syncs every hour'
    case 'every6h':  return 'Syncs every 6 hours, at 0:00, 6:00, 12:00 and 18:00 UTC'
    case 'every12h': return 'Syncs every 12 hours, at 0:00 and 12:00 UTC'
    case 'daily':    return `Syncs daily at ${hour}:00 UTC`
    case 'weekly':   return `Syncs every ${DAYS[day ?? 1]} at ${hour}:00 UTC`
    default:         return ''
  }
}

export default function AgencySettings({ initialTab }: { initialTab: SettingsTab }) {
  const [activeTab,   setActiveTab]   = useState<SettingsTab>(initialTab)
  // Tabs mount on first visit and then stay mounted, so a half-edited tab keeps its state.
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(() => new Set([initialTab]))
  const [form,       setForm]       = useState<Settings>(DEFAULT)
  const [loading,    setLoading]    = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [saved,      setSaved]      = useState(false)
  const [dirty,      setDirty]      = useState(false)
  const [error,      setError]      = useState('')
  const [uploading,        setUploading]        = useState(false)
  const [faviconUploading, setFaviconUploading] = useState(false)
  const [soundUploading,   setSoundUploading]   = useState(false)
  const [soundTesting,     setSoundTesting]     = useState(false)
  const [testingEmail,   setTestingEmail]   = useState(false)
  const [testEmailMsg,   setTestEmailMsg]   = useState<{ ok: boolean; text: string } | null>(null)

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
  const [imgModalModel,      setImgModalModel]      = useState<string>(DEFAULT_IMAGE_MODEL)
  const [imgJustSaved,       setImgJustSaved]       = useState(false)
  // The server's note when the key saved but the model could not (migration 227 not applied).
  const [imgWarning,         setImgWarning]         = useState('')

  function selectTab(id: string) {
    const tab = id as SettingsTab
    setActiveTab(tab)
    setVisitedTabs(p => new Set(p).add(tab))
    const url = new URL(window.location.href)
    url.searchParams.set('tab', tab)
    window.history.replaceState(window.history.state, '', url)
  }

  function openAiModal()      { setAiModalProvider(form.ai_provider); setAiModalModel(form.ai_model); setAiModalKey(form.ai_api_key);    setAiModalOpen(true) }
  function openImgModal()     { setImgModalKey(form.openai_api_key); setImgModalModel(resolveImageModel(form.image_model));             setImgModalOpen(true) }

  async function saveAiCredential() {
    const res = await fetch('/api/admin/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ai_provider: aiModalProvider, ai_model: aiModalModel, ai_api_key: aiModalKey }),
    })
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Save failed') }
    setForm(f => ({ ...f, ai_provider: aiModalProvider, ai_model: aiModalModel, ai_api_key: aiModalKey }))
  }

  async function saveImgCredential() {
    // The key is always sent. Untouched, it is still the mask, which the route reads as "keep the
    // stored key"; cleared, it is '', which the route reads as "remove it" (lib/secretMask). Leaving
    // a blank key out of the request instead made the key impossible to revoke from here.
    //
    // The model is sent only when it changed, so saving a key never depends on migration 227.
    const patch: Record<string, string> = { openai_api_key: imgModalKey }
    const modelChanged = imgModalModel !== resolveImageModel(form.image_model)
    if (modelChanged) patch.image_model = imgModalModel
    const res = await fetch('/api/admin/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const d = await res.json().catch(() => ({})) as { error?: string; warning?: string }
    if (!res.ok) throw new Error(d.error || 'Save failed')
    // Into the form only once the server has accepted it, so Cancel or a failed save leaves the
    // saved model showing rather than one that was never stored. A warning means the model did not
    // stick, so the form keeps the one that will actually be used.
    setForm(f => ({
      ...f,
      openai_api_key: imgModalKey,
      ...(modelChanged && !d.warning ? { image_model: imgModalModel } : {}),
    }))
    setImgWarning(d.warning ?? '')
  }

  /** Saves one field on its own (uploads, the sync switch), outside the Save bar. */
  async function saveNow(patch: Partial<Settings>, what: string) {
    const res = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => null)
    if (!res?.ok) setError(`The ${what} change wasn’t saved. Try again.`)
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
      setError(err instanceof Error ? `The logo didn’t upload: ${err.message}` : 'The logo didn’t upload.')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  async function handleFaviconUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const allowed = ['image/png', 'image/x-icon', 'image/vnd.microsoft.icon']
    if (!allowed.includes(file.type)) { setError('The favicon has to be a PNG or .ico file.'); return }
    if (file.size > 512 * 1024) { setError('The favicon has to be under 512 KB.'); return }
    setFaviconUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('folder', 'favicons')
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (data.url) {
        setForm(f => ({ ...f, favicon_url: data.url }))
        await saveNow({ favicon_url: data.url }, 'favicon')
      } else {
        throw new Error(data.error || 'Upload failed')
      }
    } catch (err) {
      setError(err instanceof Error ? `The favicon didn’t upload: ${err.message}` : 'The favicon didn’t upload.')
    } finally {
      setFaviconUploading(false)
    }
  }

  async function handleSoundUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const allowed = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/aac']
    if (!allowed.includes(file.type) && !file.name.match(/\.(mp3|wav|ogg|aac|m4a)$/i)) {
      setError('The sound has to be an MP3, WAV, OGG or AAC file.'); return
    }
    if (file.size > 10 * 1024 * 1024) { setError('The sound has to be under 10 MB.'); return }
    setSoundUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('folder', 'sounds')
      const res  = await fetch('/api/upload', { method: 'POST', body: fd })
      const data = await res.json() as { url?: string; error?: string }
      if (data.url) {
        setForm(f => ({ ...f, payment_sound_url: data.url! }))
        await saveNow({ payment_sound_url: data.url }, 'payment sound')
      } else {
        throw new Error(data.error || 'Upload failed')
      }
    } catch (err) {
      setError(err instanceof Error ? `The sound didn’t upload: ${err.message}` : 'The sound didn’t upload.')
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
      setError('The browser blocked the sound. Allow sound for this site, then try again.')
    }
  }

  const load = useCallback(() => {
    setLoading(true)
    setLoadFailed(false)
    fetch('/api/admin/settings')
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(settings => { setForm({ ...DEFAULT, ...settings }); setLoading(false) })
      // A failed load used to fall through to the defaults, so Save would have written them over
      // the real settings. Now there's no form until the real settings arrive.
      .catch(() => { setLoadFailed(true); setLoading(false) })
  }, [])
  useEffect(load, [load])

  function field<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSaved(false)
    setDirty(true)
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
    // image_model belongs to the Image Generation modal, which saves it on its own. Sending it
    // from here as well would make every save on this page depend on migration 227: one unknown
    // column fails the whole PATCH, so saving an agency name would break until the column exists.
    delete saveForm.image_model
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(saveForm),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok || data.error) setError(data.error || 'The settings weren’t saved. Try again.')
      else { setSaved(true); setDirty(false) }
    } catch {
      setError('The settings weren’t saved. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleCron(enabled: boolean) {
    setForm(f => ({ ...f, cron_enabled: enabled }))
    await saveNow({ cron_enabled: enabled }, 'sync')
  }

  async function handleTestEmail() {
    if (!form.notification_email) return
    setTestingEmail(true)
    setTestEmailMsg(null)
    try {
      // Points at the diagnostic endpoint rather than the notification sender:
      // it returns the verbatim SMTP error and the resolved From address, which
      // is what actually tells you why delivery is failing. "authentication
      // failed", "domain not verified" and "connection timeout" all look
      // identical through a generic sender.
      const res = await fetch('/api/admin/settings/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: form.notification_email }),
      })
      const data = await res.json() as { ok?: boolean; error?: string; from?: string }
      setTestEmailMsg(
        data.ok
          ? { ok: true,  text: `Test email sent${data.from ? ` from ${data.from}` : ''}.` }
          : { ok: false, text: `The test email wasn’t sent: ${data.error ?? 'no reason given'}` },
      )
    } catch {
      setTestEmailMsg({ ok: false, text: 'The test email wasn’t sent. Check your connection and try again.' })
    } finally {
      setTestingEmail(false)
    }
  }

  const header = (
    <PageHeader
      title="Agency settings"
      description="How every client dashboard looks, syncs and notifies. Clients can override some of these on their own pages."
    />
  )

  if (loading) return <div className="se-page">{header}<SettingsSkeleton header={false} /></div>

  if (loadFailed) {
    return (
      <div className="se-failed">
        {header}
        <div className="card">
          <EmptyState
            icon={<WarningCircle size={22} weight="duotone" />}
            tone="red"
            title="Settings didn’t load"
            actions={<button type="button" className="btn btn-primary" onClick={load}>Try again</button>}
          >
            Nothing here can be changed until they do, so no defaults get saved over your real settings.
          </EmptyState>
        </div>
      </div>
    )
  }

  function panel(id: SettingsTab, children: React.ReactNode) {
    if (!visitedTabs.has(id)) return null
    return (
      <div
        role="tabpanel"
        id={`se-panel-${id}`}
        aria-labelledby={`se-tab-${id}`}
        hidden={activeTab !== id}
        tabIndex={0}
        className="se-panel ui-stack"
      >
        {children}
      </div>
    )
  }

  return (
    <div className="se-page">
      {header}

      <div className="se-tabs">
        <PillTabs
          items={SETTINGS_TABS.map(t => ({ id: t.id, label: t.label }))}
          activeId={activeTab}
          onSelect={selectTab}
          label="Settings sections"
          idPrefix="se"
        />
      </div>

      <form onSubmit={handleSave}>

        {panel('branding', <>
          <Section title="Branding" description="Your agency’s name and marks, shown in the admin and on every client dashboard.">
            <div className="ui-fields">
              <Field label="Agency name" id="se-agency-name">
                <input id="se-agency-name" className="input" value={form.agency_name}
                  onChange={e => field('agency_name', e.target.value)} placeholder="My Agency" />
              </Field>

              <Field label="Logo" id="se-logo-url" hint="Shown in the admin sidebar and on client dashboards. Upload one, or paste the address of an image.">
                <div className="ui-fields" style={{ gap: 10 }}>
                  <div className="se-upload">
                    {form.agency_logo_url && <img src={form.agency_logo_url} alt="Current logo" className="se-logo" />}
                    <label className="btn btn-secondary btn-sm" style={{ cursor: uploading ? 'default' : 'pointer' }}>
                      <UploadSimple size={14} aria-hidden />
                      {uploading ? 'Uploading…' : form.agency_logo_url ? 'Replace logo' : 'Upload logo'}
                      <input type="file" accept="image/*" className="sr-only" onChange={handleLogoUpload} disabled={uploading} />
                    </label>
                    {form.agency_logo_url && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => field('agency_logo_url', '')}>Remove</button>
                    )}
                  </div>
                  <input id="se-logo-url" className="input" value={form.agency_logo_url} aria-describedby="se-logo-url-hint"
                    onChange={e => field('agency_logo_url', e.target.value)} placeholder="https://…" />
                </div>
              </Field>

              <Field label="Favicon" hint="The icon in the browser tab across the admin. PNG or .ico, up to 512 KB. Uploading saves it straight away.">
                <div className="se-upload">
                  {form.favicon_url && <img src={form.favicon_url} alt="Current favicon" className="se-favicon" />}
                  <label className="btn btn-secondary btn-sm" style={{ cursor: faviconUploading ? 'default' : 'pointer' }}>
                    <UploadSimple size={14} aria-hidden />
                    {faviconUploading ? 'Uploading…' : form.favicon_url ? 'Replace favicon' : 'Upload favicon'}
                    <input type="file" accept=".png,.ico,image/png,image/x-icon" className="sr-only" onChange={handleFaviconUpload} disabled={faviconUploading} />
                  </label>
                  {form.favicon_url && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => field('favicon_url', '')}>Remove</button>
                  )}
                </div>
              </Field>

              <Field label="CRM name" id="se-crm-name" hint="What clients see the CRM called, such as CRM, Pipeline or GoHighLevel.">
                <input id="se-crm-name" className="input" value={form.crm_name} aria-describedby="se-crm-name-hint"
                  onChange={e => field('crm_name', e.target.value)} placeholder="CRM" />
              </Field>
            </div>
          </Section>
        </>)}

        {panel('benchmarks', <>
          <Section title="Performance benchmarks" description="The targets client dashboards measure against for the Marketing Efficiency Score.">
            <div className="ui-grid-2">
              <Field label="Target ROAS" id="se-roas" hint="3 means 300%.">
                <input id="se-roas" type="number" step="0.1" min="0" className="input" aria-describedby="se-roas-hint"
                  value={form.benchmark_roas} onChange={e => field('benchmark_roas', parseFloat(e.target.value))} />
              </Field>
              <Field label="Target CPC ($)" id="se-cpc">
                <input id="se-cpc" type="number" step="0.01" min="0" className="input"
                  value={form.benchmark_cpc} onChange={e => field('benchmark_cpc', parseFloat(e.target.value))} />
              </Field>
              <Field label="Target CTR (%)" id="se-ctr" hint="3 means 3%.">
                <input id="se-ctr" type="number" step="0.1" min="0" max="100" className="input" aria-describedby="se-ctr-hint"
                  value={parseFloat((form.benchmark_ctr * 100).toFixed(4))}
                  onChange={e => field('benchmark_ctr', parseFloat(e.target.value) / 100)} />
              </Field>
              <Field label="Target conversion rate (%)" id="se-cvr" hint="3 means 3%.">
                <input id="se-cvr" type="number" step="0.1" min="0" max="100" className="input" aria-describedby="se-cvr-hint"
                  value={parseFloat((form.benchmark_conv_rate * 100).toFixed(4))}
                  onChange={e => field('benchmark_conv_rate', parseFloat(e.target.value) / 100)} />
              </Field>
              <Field label="Target CPM ($)" id="se-cpm">
                <input id="se-cpm" type="number" step="0.01" min="0" className="input"
                  value={form.benchmark_cpm} onChange={e => field('benchmark_cpm', parseFloat(e.target.value))} />
              </Field>
              <Field label="Default date range (days)" id="se-range">
                <input id="se-range" type="number" step="1" min="1" max="365" className="input"
                  value={form.default_date_range_days} onChange={e => field('default_date_range_days', parseInt(e.target.value))} />
              </Field>
            </div>
          </Section>

          <Section
            title="Ad Fuel"
            description="The agency’s margin on raw ad spend: billed spend is raw spend ÷ (1 − cut), so $800 raw at a 20% cut bills $1,000. Clients can have their own cut."
          >
            <Field label="Ad Fuel cut (%)" id="se-adfuel" hint="20 means the agency keeps 20%.">
              <input id="se-adfuel" type="number" step="0.1" min="0" max="99" className="input" style={{ maxWidth: 160 }} aria-describedby="se-adfuel-hint"
                value={parseFloat((form.ad_fuel_cut * 100).toFixed(2))}
                onChange={e => field('ad_fuel_cut', Math.min(0.99, parseFloat(e.target.value) / 100) || 0)} />
            </Field>
          </Section>

          <Section
            title="Client dashboard tabs"
            description="Hide a tab from every client dashboard. The connection keeps syncing; clients just don’t see the tab."
          >
            {HIDEABLE_CONNECTORS.map(({ type, label, hint }) => (
              <SwitchRow
                key={type}
                title={label}
                description={hint}
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
            <SwitchRow
              title="Blog posts"
              description="Upcoming and recently published posts from the content calendar."
              checked={form.show_blog_posts}
              onChange={v => field('show_blog_posts', v)}
            />
          </Section>
        </>)}

        {panel('colors', <>
          <Section title="Brand color" description="The main color across the admin and client dashboards. Each admin can still choose their own accent below.">
            <Field label="Brand color" id="se-brand">
              <ColorInput id="se-brand" value={form.brand_primary} onChange={v => field('brand_primary', v)} />
            </Field>
          </Section>

          <ThemeControls />

          <Section title="Chart colors" description="The Daily performance chart on every client dashboard.">
            <div className="ui-grid-2">
              <Field label="Spend, this period" id="se-c1">
                <ColorInput id="se-c1" value={form.chart_color_spend} onChange={v => field('chart_color_spend', v)} />
              </Field>
              <Field label="Spend, previous period" id="se-c2">
                <ColorInput id="se-c2" value={form.chart_color_prior_spend} onChange={v => field('chart_color_prior_spend', v)} />
              </Field>
              <Field label="Conversions, this period" id="se-c3">
                <ColorInput id="se-c3" value={form.chart_color_conversions} onChange={v => field('chart_color_conversions', v)} />
              </Field>
              <Field label="Conversions, previous period" id="se-c4">
                <ColorInput id="se-c4" value={form.chart_color_prior_conversions} onChange={v => field('chart_color_prior_conversions', v)} />
              </Field>
            </div>
          </Section>
        </>)}

        {panel('ai', <>
          <IntegrationGroup id="se-ai" title="Content AI" description="The keys and models that write posts and draw featured images. Each saves from its own dialog.">
            <IntegrationCard
              icon={<Sparkle size={20} weight="duotone" />}
              name="Writing"
              description="Provider, model and key for posts and topic suggestions."
              isConnected={!!form.ai_api_key}
              connectedLabel={form.ai_api_key ? `${form.ai_provider} / ${form.ai_model || 'default'}` : undefined}
              onConfigure={openAiModal}
              justConnected={aiJustSaved}
            />
            <IntegrationCard
              icon={<ImageSquare size={20} weight="duotone" />}
              name="Featured images"
              description="An OpenAI key and image model, separate from the writing key."
              isConnected={!!form.openai_api_key}
              connectedLabel={form.openai_api_key ? `Key saved · ${resolveImageModel(form.image_model)}` : undefined}
              onConfigure={openImgModal}
              justConnected={imgJustSaved}
            />
          </IntegrationGroup>
          {imgWarning && <div className="ui-notice ui-notice--warning" role="status" style={{ margin: 0 }}>{imgWarning}</div>}

          <IntegrationModal
            open={aiModalOpen}
            onClose={() => setAiModalOpen(false)}
            onSaved={() => { setAiJustSaved(true); setTimeout(() => setAiJustSaved(false), 2000) }}
            title="Writing AI"
            icon={<Sparkle size={20} weight="duotone" />}
            isConnected={!!form.ai_api_key}
            howTo={
              <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
                <li><strong>OpenAI:</strong> in <strong>platform.openai.com → API keys</strong>, create a secret key (<code>sk-…</code>). Use the model <code>gpt-4o</code> or <code>gpt-4o-mini</code>.</li>
                <li><strong>Anthropic:</strong> in <strong>console.anthropic.com → API keys</strong>, create a key. Use the model <code>claude-sonnet-4-6</code>.</li>
                <li>The master writing prompt is in <Link href="/admin/content?tab=settings">Content → Settings</Link>.</li>
              </ol>
            }
            onSave={saveAiCredential}
          >
            <Field label="Provider" id="se-ai-provider">
              <select id="se-ai-provider" className="input" value={aiModalProvider} onChange={e => setAiModalProvider(e.target.value)}>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic (Claude)</option>
              </select>
            </Field>
            <Field label="Model" id="se-ai-model">
              <input id="se-ai-model" className="input" type="text" value={aiModalModel} onChange={e => setAiModalModel(e.target.value)}
                placeholder={aiModalProvider === 'openai' ? 'gpt-4o' : 'claude-sonnet-4-6'} />
            </Field>
            <Field label="API key" id="se-ai-key" hint="Stored on the server and never shown to clients.">
              <input id="se-ai-key" className="input" type="password" value={aiModalKey} onChange={e => setAiModalKey(e.target.value)}
                placeholder="Paste the key" autoComplete="off" aria-describedby="se-ai-key-hint" />
            </Field>
          </IntegrationModal>

          <IntegrationModal
            open={imgModalOpen}
            onClose={() => setImgModalOpen(false)}
            onSaved={() => { setImgJustSaved(true); setTimeout(() => setImgJustSaved(false), 2000) }}
            title="Featured images (OpenAI)"
            icon={<ImageSquare size={20} weight="duotone" />}
            isConnected={!!form.openai_api_key}
            howTo={
              <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
                <li>In <strong>platform.openai.com → API keys</strong>, create a secret key (<code>sk-…</code>).</li>
                <li>OpenAI may ask the organization to complete <strong>API Organization Verification</strong> before its GPT Image models can be used.</li>
                <li>This key is only used for featured images; it’s separate from the writing key.</li>
              </ol>
            }
            onSave={saveImgCredential}
          >
            <Field
              label="OpenAI API key"
              id="img-openai-key"
              hint={form.openai_api_key ? 'Used only for featured images. Clear the field and save to remove the key.' : 'Used only for featured images.'}
            >
              <input id="img-openai-key" className="input" type="password" value={imgModalKey} onChange={e => setImgModalKey(e.target.value)}
                placeholder="sk-…" autoComplete="off" aria-describedby="img-openai-key-hint" />
            </Field>
            <Field
              label="Model"
              id="img-model"
              hint="Each one is asked for the same 1536×1024 PNG, so switching needs nothing else changed. Cost is recorded from what OpenAI reports and shows on the Usage page."
            >
              <select id="img-model" className="input" value={imgModalModel} onChange={e => setImgModalModel(e.target.value)} aria-describedby="img-model-hint">
                {Object.entries(IMAGE_MODELS).map(([id, m]) => (
                  <option key={id} value={id}>{m.label}{id === DEFAULT_IMAGE_MODEL ? ' (default)' : ''}</option>
                ))}
              </select>
            </Field>
          </IntegrationModal>

          <Section
            title="AI spend"
            description="What writing and images cost, by client, task and model, is on the Usage page."
            actions={<Link href="/admin/usage" className="btn btn-secondary btn-sm">Open usage</Link>}
          />
          <Section
            title="Search API"
            description="The SerpApi key for competitor research lives in Integrations, with your other connections."
            actions={<Link href="/admin/connections" className="btn btn-secondary btn-sm">Open integrations</Link>}
          />
        </>)}

        {panel('sync', <>
          <Section title="Ad data" description="Google Ads and Meta Ads. Hourly keeps Ad Fuel balances close to real time.">
            <div className="ui-grid-2">
              <Field label="How often" id="se-ads-freq">
                <select id="se-ads-freq" className="input" value={form.ads_sync_frequency} onChange={e => field('ads_sync_frequency', e.target.value)}>
                  <option value="hourly">Hourly</option>
                  <option value="every2h">Every 2 hours</option>
                  <option value="every6h">Every 6 hours</option>
                  <option value="every12h">Every 12 hours</option>
                  <option value="daily">Daily</option>
                </select>
              </Field>
              {form.ads_sync_frequency !== 'hourly' && (
                <Field label="Hour (UTC)" id="se-ads-hour" hint="0 to 23.">
                  <input id="se-ads-hour" type="number" min={0} max={23} className="input" aria-describedby="se-ads-hour-hint"
                    value={form.ads_sync_hour_utc} onChange={e => field('ads_sync_hour_utc', parseInt(e.target.value))} />
                </Field>
              )}
            </div>
          </Section>

          <Section title="Everything else" description="Analytics, Search Console, HighLevel, Ahrefs and the rest. The job checks every hour and runs when this schedule says so.">
            <SwitchRow
              title="Sync on a schedule"
              description="Saves straight away. When it’s off, nothing syncs on its own; you can still sync a client by hand."
              checked={form.cron_enabled}
              onChange={toggleCron}
            />
            <div className="ui-setting" style={{ display: 'block' }}>
              <div className="ui-fields">
                <div className="ui-grid-2">
                  <Field label="How often" id="se-sync-freq">
                    <select id="se-sync-freq" className="input" value={form.sync_frequency} onChange={e => field('sync_frequency', e.target.value)}>
                      <option value="hourly">Hourly</option>
                      <option value="every6h">Every 6 hours</option>
                      <option value="every12h">Every 12 hours</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                    </select>
                  </Field>
                  {form.sync_frequency === 'weekly' && (
                    <Field label="Day" id="se-sync-day">
                      <select id="se-sync-day" className="input" value={form.sync_day_of_week ?? 1} onChange={e => field('sync_day_of_week', parseInt(e.target.value))}>
                        {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                      </select>
                    </Field>
                  )}
                  {form.sync_frequency !== 'hourly' && (
                    <Field label="Hour (UTC)" id="se-sync-hour" hint="0 to 23.">
                      <input id="se-sync-hour" type="number" min={0} max={23} className="input" aria-describedby="se-sync-hour-hint"
                        value={form.sync_hour_utc} onChange={e => field('sync_hour_utc', parseInt(e.target.value))} />
                    </Field>
                  )}
                </div>
                <p className="se-says"><Clock size={15} aria-hidden />{scheduleInWords(form.sync_frequency, form.sync_hour_utc, form.sync_day_of_week)}. Each run re-syncs the last 3 days, to catch late conversions.</p>
              </div>
            </div>
          </Section>
        </>)}

        {panel('notifications', <>
          <Section
            title="Where notifications go"
            description="Discord messages use the bot and channels set up in Integrations."
            actions={<Link href="/admin/connections" className="btn btn-secondary btn-sm">Open integrations</Link>}
          >
            <Field label="Team email" id="se-team-email" hint="Gets every notification switched on in the Team email column below.">
              <div className="se-upload">
                <input id="se-team-email" className="input" type="email" value={form.notification_email} aria-describedby="se-team-email-hint"
                  onChange={e => field('notification_email', e.target.value)} placeholder="team@agency.com" style={{ flex: '1 1 220px' }} />
                <button type="button" className="btn btn-secondary" disabled={!form.notification_email || testingEmail} onClick={handleTestEmail}>
                  {testingEmail ? 'Sending…' : 'Send test email'}
                </button>
              </div>
            </Field>
            {testEmailMsg && (
              <div className={`ui-notice ui-notice--${testEmailMsg.ok ? 'success' : 'danger'}`} role="status" style={{ margin: '12px 0 0' }}>
                {testEmailMsg.text}
              </div>
            )}
          </Section>

          <Section title="Notification channels" description="Choose which events go to each channel.">
            <NotificationTypeTable />
          </Section>

          <Section title="Metric alerts" description="Emailed to the team when a client’s ad metrics move further than you’d expect.">
            <SwitchRow
              title="Email metric alerts"
              description="A daily digest of changes past the thresholds below, compared with the previous window."
              checked={form.notify_metric_alerts}
              onChange={v => field('notify_metric_alerts', v)}
            >
              {form.notify_metric_alerts && (
                <div className="ui-grid-2">
                  <div className="ui-fields" style={{ gap: 12 }}>
                    <Field label="Day over day" id="se-daily-th" hint="The change between yesterday and the day before that raises an alert.">
                      <span className="ui-affix">
                        <input id="se-daily-th" type="number" className="input" min={5} max={100} step={5} aria-describedby="se-daily-th-hint"
                          value={form.daily_alert_threshold} onChange={e => field('daily_alert_threshold', Number(e.target.value))} />
                        %
                      </span>
                    </Field>
                    <MetricChecks
                      legend="Watch daily"
                      options={{ spend: 'Spend', conversions: 'Conversions', cpa: 'CPA' }}
                      value={form.daily_alert_metrics ?? ['spend', 'conversions', 'cpa']}
                      onChange={v => field('daily_alert_metrics', v)}
                    />
                  </div>
                  <div className="ui-fields" style={{ gap: 12 }}>
                    <Field label="Over 7 days" id="se-weekly-th" hint="The change across a 7-day window that raises an alert. Sent at most once a week.">
                      <span className="ui-affix">
                        <input id="se-weekly-th" type="number" className="input" min={5} max={100} step={5} aria-describedby="se-weekly-th-hint"
                          value={form.metric_alert_threshold} onChange={e => field('metric_alert_threshold', Number(e.target.value))} />
                        %
                      </span>
                    </Field>
                    <MetricChecks
                      legend="Watch weekly"
                      options={{ spend: 'Spend', conversions: 'Conversions', cpa: 'CPA', roas: 'ROAS', ctr: 'CTR' }}
                      value={form.weekly_alert_metrics ?? ['spend', 'conversions', 'cpa', 'roas', 'ctr']}
                      onChange={v => field('weekly_alert_metrics', v)}
                    />
                  </div>
                </div>
              )}
            </SwitchRow>
          </Section>

          <Section title="Client check-ins" description="When a client counts as due a call or email.">
            <Field label="Contact window" id="se-contact" hint="Days without a logged contact before a client shows as due a check-in. Any client can override this on their Overview tab.">
              <span className="ui-affix">
                <input
                  id="se-contact"
                  type="number"
                  min={1}
                  max={365}
                  className="input"
                  aria-describedby="se-contact-hint"
                  value={form.contact_stale_days}
                  // Number('') is 0, so a plain Number(e.target.value) turns
                  // "select the digits and hit backspace" into a saved threshold
                  // of zero — which marks every client overdue forever. `min` is
                  // only a browser hint on an input that is never submitted.
                  onChange={e => {
                    const n = Number(e.target.value)
                    field('contact_stale_days', e.target.value === '' || !Number.isFinite(n) ? 1 : Math.min(365, Math.max(1, Math.trunc(n))))
                  }}
                />
                days
              </span>
            </Field>
          </Section>

          <Section title="Content quality" description="A guard on what publishes without anyone looking.">
            <SwitchRow
              title="Hold flagged posts back from auto-publish"
              description="When a post fails a critical quality check (invented figures, promises of approval, keyword stuffing, or the same structure as the rest of the site), the scheduled push skips it and raises an alert. Publishing by hand is never blocked. Unattended publishing is what Google’s spam update targeted, so leaving this on is the safer default."
              checked={form.quality_gate_blocks_autopush}
              onChange={v => field('quality_gate_blocks_autopush', v)}
            />
          </Section>

          <Section title="Payment sound" description="Plays in the admin when a Stripe payment comes in, while the admin is open in a browser.">
            <Field label="Sound" hint="MP3, WAV, OGG or AAC, up to 10 MB. Uploading or removing it saves straight away.">
              <div className="se-upload">
                <label className="btn btn-secondary btn-sm" style={{ cursor: soundUploading ? 'default' : 'pointer' }}>
                  <UploadSimple size={14} aria-hidden />
                  {soundUploading ? 'Uploading…' : form.payment_sound_url ? 'Replace sound' : 'Upload sound'}
                  <input
                    type="file"
                    accept="audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/aac,.mp3,.wav,.ogg,.aac,.m4a"
                    className="sr-only"
                    onChange={handleSoundUpload}
                    disabled={soundUploading}
                  />
                </label>
                {form.payment_sound_url && (
                  <>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={handleTestSound} disabled={soundTesting}>
                      {soundTesting ? <SpeakerHigh size={14} aria-hidden /> : <Play size={14} aria-hidden />}
                      {soundTesting ? 'Playing…' : 'Play'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={async () => {
                        setForm(f => ({ ...f, payment_sound_url: '' }))
                        await saveNow({ payment_sound_url: '' }, 'payment sound')
                      }}
                    >
                      <Trash size={14} aria-hidden />
                      Remove
                    </button>
                    <span className="se-file" title={form.payment_sound_url}>{form.payment_sound_url.split('/').pop()}</span>
                  </>
                )}
              </div>
            </Field>
          </Section>
        </>)}

        {panel('layouts', <>
          <Section
            title="Dashboard layouts"
            description="Which metrics show as KPI cards, top metrics and table columns for each campaign type. They apply to every client unless the client has its own."
          >
            <MetricLayoutEditor value={form.metric_layouts} onChange={v => field('metric_layouts', v)} />
          </Section>
          <Section
            title="Clients table"
            description="Which metric columns the Clients page shows, in order. Client, sources and actions always show."
          >
            <LayoutSection
              title="Columns"
              description="Add, remove and reorder the metric columns."
              items={Array.isArray(form.overview_columns) ? form.overview_columns : DEFAULT_OVERVIEW_COLUMNS}
              allKeys={OVERVIEW_COLUMN_KEYS}
              labels={OVERVIEW_COLUMN_LABELS}
              onChange={cols => field('overview_columns', cols)}
            />
          </Section>
        </>)}

        {/* The AI tab has nothing that waits for Save (each key saves from its dialog), so the bar
            only shows there when another tab has changes waiting or there's a result to read. */}
        {(activeTab !== 'ai' || dirty || saving || saved || error) && (
        <div className={`se-savebar${dirty || saving || saved || error ? ' se-savebar--live' : ''}`}>
          <span
            className={`se-savestate${error ? ' se-savestate--error' : saved ? ' se-savestate--ok' : dirty ? ' se-savestate--dirty' : ''}`}
            role="status"
            aria-live="polite"
          >
            {error ? <><WarningCircle size={16} weight="fill" aria-hidden />{error}</>
              : saved ? <><CheckCircle size={16} weight="fill" aria-hidden />Saved</>
              : dirty ? 'Unsaved changes'
              : 'No unsaved changes'}
          </span>
          <button type="submit" className="btn btn-primary" disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
        )}
      </form>
    </div>
  )
}

// ─── Per-user theme ───────────────────────────────────────────────────────────

// Preset accents. These are values a person picks (stored on their profile), not styling.
const ACCENT_PRESETS = [
  { label: 'Blue',    value: '#2563eb' },
  { label: 'Purple',  value: '#7c3aed' },
  { label: 'Emerald', value: '#059669' },
  { label: 'Rose',    value: '#e11d48' },
  { label: 'Amber',   value: '#d97706' },
  { label: 'Slate',   value: '#475569' },
]

const MODES: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark',  label: 'Dark'  },
  { value: 'auto',  label: 'Auto'  },
]

function ThemeControls() {
  const theme = useTheme()
  if (!theme) return null
  const { mode, accentColor, setMode, setAccent } = theme

  return (
    <Section title="Your theme" description="Only changes what you see, and saves straight away. Each admin can set their own.">
      <div className="ui-fields">
        <div className="ui-field">
          <span className="ui-field-label" id="se-mode-label">Color mode</span>
          <div className="ui-tabs" style={{ alignSelf: 'flex-start' }}>
            <div className="ui-tabs-track" role="radiogroup" aria-labelledby="se-mode-label">
              {MODES.map(({ value, label }) => (
                <button key={value} type="button" role="radio" aria-checked={mode === value} className="ui-tab" onClick={() => setMode(value)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="ui-field-hint">Auto follows your device’s setting.</p>
        </div>

        <div className="ui-field">
          <span className="ui-field-label" id="se-accent-label">Accent color</span>
          <div className="se-swatches" role="radiogroup" aria-labelledby="se-accent-label">
            {ACCENT_PRESETS.map(preset => (
              <button
                key={preset.value}
                type="button"
                role="radio"
                aria-checked={accentColor === preset.value}
                aria-label={preset.label}
                title={preset.label}
                className="se-swatch"
                style={{ '--sw': preset.value } as React.CSSProperties}
                onClick={() => setAccent(preset.value)}
              />
            ))}
            <input
              type="color"
              className="se-swatch-custom"
              value={accentColor || '#2563eb'}
              onChange={e => setAccent(e.target.value)}
              aria-label="Custom accent color"
              title="Custom color"
            />
            <span className="se-swatch-value">{accentColor}</span>
          </div>
        </div>
      </div>
    </Section>
  )
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function ColorInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="se-color">
      <input type="color" value={value || '#000000'} onChange={e => onChange(e.target.value)} aria-label="Pick a color" />
      <input id={id} type="text" className="input" value={value} onChange={e => onChange(e.target.value)} placeholder="#000000" spellCheck={false} />
    </div>
  )
}

function MetricChecks({ legend, options, value, onChange }: {
  legend: string
  options: Record<string, string>
  value: string[]
  onChange: (next: string[]) => void
}) {
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      <legend className="ui-field-hint" style={{ padding: 0, marginBottom: 4 }}>{legend}</legend>
      <div className="se-checks">
        {Object.entries(options).map(([m, label]) => (
          <label key={m} className="se-check">
            <input
              type="checkbox"
              checked={value.includes(m)}
              onChange={e => onChange(e.target.checked ? [...value, m] : value.filter(x => x !== m))}
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
