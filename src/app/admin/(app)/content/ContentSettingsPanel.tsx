'use client'
// Global content settings: how every post is written (the post structure and the writing
// prompts) and how the team hears about content. Per-client schedule, frequency and
// auto-generate are on each client's Content tab.

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { CheckCircle, WarningCircle } from '@phosphor-icons/react'
import { SHOW_NON_BLOG_CONTENT_TYPES } from '@/lib/content/featureFlags'
import Section from '@/components/ui/Section'
import Field from '@/components/ui/Field'
import { SwitchRow } from '@/components/ui/Switch'
import Dialog from '@/components/ui/Dialog'
import EmptyState from '@/components/ui/EmptyState'
import { Sk, SkCard } from '@/components/ui/Skeleton'

interface GlobalSettings {
  post_structure?: string
}

interface AgencyWritingPrompt {
  master_writing_prompt?: string
  service_area_master_prompt?: string
  service_page_master_prompt?: string
  regular_page_master_prompt?: string
  discord_ops_channel_id?: string | null
  consolidated_email_notifications?: boolean
  monthly_review_schedule?: string
}

const REVIEW_SCHEDULE_OPTIONS: { value: string; label: string }[] = [
  { value: 'first_monday',    label: 'First Monday of the month' },
  { value: 'first_tuesday',   label: 'First Tuesday of the month' },
  { value: 'first_wednesday', label: 'First Wednesday of the month' },
  { value: 'first_thursday',  label: 'First Thursday of the month' },
  { value: 'first_friday',    label: 'First Friday of the month' },
  { value: 'first_weekday',   label: 'First weekday of the month' },
  { value: 'day_1',           label: '1st of the month' },
  { value: 'day_5',           label: '5th of the month' },
  { value: 'day_15',          label: '15th of the month' },
]

const BLOG_VARIABLES = ['[BRAND_NAME]','[BRAND_DESCRIPTION]','[TARGET_AUDIENCE]','[VOICE_NOTES]','[WORD_COUNT]','[PRIMARY_KEYWORD]','[WORKING_TITLE]','[SECONDARY_KEYWORDS]','[SEARCH_INTENT]','[URLS_AND_ANCHORS]','[CTA]']
const SA_VARIABLES   = ['[BRAND_NAME]','[PRIMARY_SERVICE]','[CITY]','[STATE]','[SERVICE_LIST]','[NEARBY_AREAS]','[NEARBY_REGION]','[PHONE]','[PHONE_RAW]','[RESPONSE_TIME]','[COUNTY_OR_REGION]','[CATEGORY_TAGLINE]','[EEAT]','[CLIENT_CONTEXT]']

function nextReviewDate(schedule: string): string {
  const now   = new Date()
  const year  = now.getFullYear()
  const month = now.getMonth()

  function firstDayOfWeek(y: number, m: number, dow: number): Date {
    const d = new Date(y, m, 1)
    while (d.getDay() !== dow) d.setDate(d.getDate() + 1)
    return d
  }

  function firstWeekday(y: number, m: number): Date {
    const d = new Date(y, m, 1)
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
    return d
  }

  const DAY_MAP: Record<string, number> = {
    first_monday: 1, first_tuesday: 2, first_wednesday: 3, first_thursday: 4, first_friday: 5,
  }

  let candidate: Date
  if (schedule in DAY_MAP) {
    candidate = firstDayOfWeek(year, month, DAY_MAP[schedule])
    if (candidate <= now) candidate = firstDayOfWeek(year, month + 1, DAY_MAP[schedule])
  } else if (schedule === 'first_weekday') {
    candidate = firstWeekday(year, month)
    if (candidate <= now) candidate = firstWeekday(year, month + 1)
  } else {
    const dayNum = parseInt(schedule.replace('day_', ''), 10)
    candidate = new Date(year, month, dayNum)
    if (candidate <= now) candidate = new Date(year, month + 1, dayNum)
  }

  return candidate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

type SaveState = { state: 'idle' | 'saving' | 'saved' } | { state: 'error'; message: string }

async function putJson(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
  if (!res) throw new Error('No answer from the server. Check your connection and try again.')
  if (!res.ok) {
    const d = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(d.error || 'It wasn’t saved. Try again.')
  }
}

/** The save button and what happened, beside each other at the foot of a section. */
function SaveRow({ label, status, onSave }: { label: string; status: SaveState; onSave: () => void }) {
  return (
    <div className="ui-saverow">
      <button type="button" className="btn btn-primary" onClick={onSave} disabled={status.state === 'saving'}>
        {status.state === 'saving' ? 'Saving…' : label}
      </button>
      {status.state === 'saved' && <span className="ui-saved" role="status"><CheckCircle size={16} weight="fill" aria-hidden />Saved</span>}
      {status.state === 'error' && <span className="ui-savefail" role="alert"><WarningCircle size={16} weight="fill" aria-hidden />{status.message}</span>}
    </div>
  )
}

/** One prompt: a monospace textarea, the variables it understands, and its own save. */
function PromptSection({ id, title, description, label, hint, initial, placeholder, rows = 18, variables, save }: {
  id: string
  title: string
  description: React.ReactNode
  label: string
  hint?: React.ReactNode
  initial: string
  placeholder: string
  rows?: number
  variables?: string[]
  save: (value: string) => Promise<void>
}) {
  const [value, setValue] = useState(initial)
  const [status, setStatus] = useState<SaveState>({ state: 'idle' })
  useEffect(() => { setValue(initial) }, [initial])

  async function onSave() {
    setStatus({ state: 'saving' })
    try { await save(value); setStatus({ state: 'saved' }) }
    catch (e) { setStatus({ state: 'error', message: e instanceof Error ? e.message : 'It wasn’t saved. Try again.' }) }
  }

  return (
    <Section title={title} description={description}>
      <div className="ui-fields">
        <Field label={label} id={id} hint={hint}>
          <textarea
            id={id}
            className="input cs-prompt"
            rows={rows}
            spellCheck={false}
            aria-describedby={hint ? `${id}-hint` : undefined}
            value={value}
            onChange={e => { setValue(e.target.value); setStatus({ state: 'idle' }) }}
            placeholder={placeholder}
          />
        </Field>
        {variables && (
          <div className="ui-field">
            <span className="ui-field-hint">Filled in automatically:</span>
            <div className="cs-vars">{variables.map(v => <code key={v}>{v}</code>)}</div>
          </div>
        )}
        <SaveRow label="Save" status={status} onSave={onSave} />
      </div>
    </Section>
  )
}

export default function ContentSettingsPanel({
  clients: _clients,
}: {
  clients: { id: string; name: string }[]
}) {
  // Nothing renders until both reads are back: an empty prompt box that could be saved before the
  // real prompt arrived (or after its read failed) would write blank over the agency's prompt.
  const [loaded, setLoaded] = useState<{ global: GlobalSettings; agency: AgencyWritingPrompt } | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  const [opsChannelId,      setOpsChannelId]      = useState('')
  const [consolidatedEmail, setConsolidatedEmail] = useState(true)
  const [reviewSchedule,    setReviewSchedule]    = useState('first_monday')
  const [notif,             setNotif]             = useState<SaveState>({ state: 'idle' })

  const [showPurge,  setShowPurge]  = useState(false)
  const [purgeText,  setPurgeText]  = useState('')
  const [purging,    setPurging]    = useState(false)
  const [purgeError, setPurgeError] = useState('')
  const [purged,     setPurged]     = useState(false)

  const load = useCallback(() => {
    setLoadFailed(false)
    setLoaded(null)
    const get = (url: string) => fetch(url).then(r => { if (!r.ok) throw new Error(); return r.json() })
    Promise.all([get('/api/admin/content/global-settings'), get('/api/admin/settings')])
      .then(([g, a]: [GlobalSettings, AgencyWritingPrompt]) => {
        setOpsChannelId(a.discord_ops_channel_id ?? '')
        setConsolidatedEmail(a.consolidated_email_notifications ?? true)
        setReviewSchedule(a.monthly_review_schedule ?? 'first_monday')
        setLoaded({ global: { post_structure: g.post_structure ?? '' }, agency: a })
      })
      .catch(() => setLoadFailed(true))
  }, [])
  useEffect(load, [load])

  async function saveNotifications() {
    setNotif({ state: 'saving' })
    try {
      await putJson('/api/admin/settings', {
        discord_ops_channel_id:           opsChannelId.trim() || null,
        consolidated_email_notifications: consolidatedEmail,
        monthly_review_schedule:          reviewSchedule,
      })
      setNotif({ state: 'saved' })
    } catch (e) {
      setNotif({ state: 'error', message: e instanceof Error ? e.message : 'It wasn’t saved. Try again.' })
    }
  }

  async function purgeAll() {
    setPurging(true)
    setPurgeError('')
    try {
      const res = await fetch('/api/admin/content/topics/bulk-delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purge_all: true }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Nothing was deleted. Try again.')
      setShowPurge(false)
      setPurged(true)
    } catch (err) {
      setPurgeError(err instanceof Error ? err.message : 'Nothing was deleted. Try again.')
    } finally {
      setPurging(false)
    }
  }

  const saveSetting = (field: keyof AgencyWritingPrompt) => (value: string) => putJson('/api/admin/settings', { [field]: value })

  if (loadFailed) {
    return (
      <div className="card cs">
        <EmptyState
          icon={<WarningCircle size={22} weight="duotone" />}
          tone="red"
          title="Content settings didn’t load"
          actions={<button type="button" className="btn btn-primary" onClick={load}>Try again</button>}
        >
          Nothing here can be changed until they do, so no blank prompt gets saved over the real one.
        </EmptyState>
      </div>
    )
  }

  if (!loaded) {
    return (
      <div className="cs ui-stack" aria-busy="true" aria-label="Loading content settings">
        <SkCard><span className="ui-fields" style={{ marginTop: 16 }}><Sk w="30%" h={11} /><Sk h={130} r={8} /><Sk w={80} h={38} r={8} /></span></SkCard>
        <SkCard><span className="ui-fields" style={{ marginTop: 16 }}><Sk w="24%" h={11} /><Sk h={260} r={8} /></span></SkCard>
      </div>
    )
  }

  const a = loaded.agency

  return (
    <div className="cs ui-stack">
      <PromptSection
        id="cs-structure"
        title="Post structure"
        description={<>The outline every generated post follows, for all clients. Each client’s schedule is on its own Content tab, from <Link href="/admin/dashboard">Clients</Link>.</>}
        label="Default post structure"
        hint="Added to the writing prompt on every generation; a client’s own notes go on top. Priority pages, excluded pages and always-included links from each client’s Brand DNA are passed in as context, so use this to say how to use them."
        initial={loaded.global.post_structure ?? ''}
        rows={7}
        placeholder={`For example:\nH2: Introduction\nH2: Main body (3–4 sections)\nH2: FAQ\nH2: Conclusion and call to action\n\nAlways link to at least 2 priority pages.`}
        save={value => putJson('/api/admin/content/global-settings', { post_structure: value })}
      />

      <PromptSection
        id="cs-master"
        title="Writing prompt"
        description="The instructions the AI writes every blog post from. Leave it blank to use the built-in prompt."
        label="Master writing prompt"
        initial={a.master_writing_prompt ?? ''}
        placeholder="Paste your blog writing prompt here"
        variables={BLOG_VARIABLES}
        save={saveSetting('master_writing_prompt')}
      />

      {/* Non-blog master prompts — hidden while page types are sunset (see featureFlags) */}
      {SHOW_NON_BLOG_CONTENT_TYPES && <>
        <PromptSection
          id="cs-sa"
          title="Service area pages prompt"
          description="Used for service area landing pages, such as “Tree service in Palm Bay, FL”. Leave it blank to use the built-in prompt."
          label="Service area pages prompt"
          initial={a.service_area_master_prompt ?? ''}
          placeholder="Paste your service area page prompt here"
          variables={SA_VARIABLES}
          save={saveSetting('service_area_master_prompt')}
        />
        <PromptSection
          id="cs-sp"
          title="Service pages prompt"
          description="Used for service pages, such as “Residential plumbing”. Leave it blank to use the blog prompt."
          label="Service pages prompt"
          initial={a.service_page_master_prompt ?? ''}
          placeholder="Paste your service page prompt here"
          save={saveSetting('service_page_master_prompt')}
        />
        <PromptSection
          id="cs-rp"
          title="Regular pages prompt"
          description="Used for other pages: About, FAQ and custom content. Leave it blank to use the blog prompt."
          label="Regular pages prompt"
          initial={a.regular_page_master_prompt ?? ''}
          placeholder="Paste your regular page prompt here"
          save={saveSetting('regular_page_master_prompt')}
        />
      </>}

      <Section
        title="Notifications"
        description={<>Where content alerts go and when the monthly review happens. The Discord bot is set up in <Link href="/admin/connections">Integrations</Link>; the team email in <Link href="/admin/settings?tab=notifications">Agency settings</Link>.</>}
      >
        <div className="ui-fields">
          <Field label="Discord channel for content" id="cs-ops" hint="Every content alert (topics generated, posts ready, review reminders, BigCommerce checks) posts here. Leave it blank to send none to Discord.">
            <input id="cs-ops" type="text" inputMode="numeric" className="input cs-mono" spellCheck={false} aria-describedby="cs-ops-hint"
              value={opsChannelId} onChange={e => { setOpsChannelId(e.target.value); setNotif({ state: 'idle' }) }} placeholder="1234567890123456789" />
          </Field>
          <Field label="Monthly review" id="cs-review" hint={<>Next one: <strong>{nextReviewDate(reviewSchedule)}</strong>. Posts are approved 35 days before they publish, so they’re ready for it.</>}>
            <select id="cs-review" className="input" aria-describedby="cs-review-hint"
              value={reviewSchedule} onChange={e => { setReviewSchedule(e.target.value); setNotif({ state: 'idle' }) }}>
              {REVIEW_SCHEDULE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </Field>
          <div>
            <SwitchRow
              title="One email for all clients"
              description="Each run sends a single digest covering every client. When it’s off, each client gets its own email."
              checked={consolidatedEmail}
              onChange={v => { setConsolidatedEmail(v); setNotif({ state: 'idle' }) }}
            />
          </div>
          <SaveRow label="Save" status={notif} onSave={saveNotifications} />
        </div>
      </Section>

      <Section
        title="Delete all content"
        description="Deletes every generated topic and post, for every client. It can’t be undone."
        actions={<button type="button" className="btn btn-danger btn-sm" onClick={() => { setPurgeText(''); setPurgeError(''); setShowPurge(true) }}>Delete everything</button>}
      >
        {purged && <div className="ui-notice ui-notice--success" role="status" style={{ margin: 0 }}>Every topic and post was deleted.</div>}
      </Section>

      <Dialog
        open={showPurge}
        onClose={() => setShowPurge(false)}
        title="Delete every topic and post?"
        role="alertdialog"
        size="sm"
        busy={purging}
        footer={<>
          <button type="button" className="btn btn-secondary" onClick={() => setShowPurge(false)} disabled={purging}>Cancel</button>
          <button type="button" className="btn btn-danger-solid" onClick={purgeAll} disabled={purgeText !== 'PURGE' || purging}>
            {purging ? 'Deleting…' : 'Delete everything'}
          </button>
        </>}
      >
        <div className="ui-fields" style={{ gap: 12 }}>
          <p className="ui-dialog-text">This deletes all topics and posts for every client. It can’t be undone.</p>
          <Field label={<>Type <strong>PURGE</strong> to confirm</>} id="cs-purge">
            <input id="cs-purge" className="input" autoComplete="off" spellCheck={false} value={purgeText} onChange={e => setPurgeText(e.target.value)} />
          </Field>
          {purgeError && <div className="ui-notice ui-notice--danger" role="alert" style={{ margin: 0 }}>{purgeError}</div>}
        </div>
      </Dialog>
    </div>
  )
}
