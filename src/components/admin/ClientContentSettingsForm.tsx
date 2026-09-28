'use client'

import { useState, useEffect } from 'react'
import ResearchLocationPicker, { readLocationValue, type ResearchLocationValue } from './ResearchLocationPicker'
import { SERVICES_HELP, SERVICE_AREAS_HELP, RESEARCH_LOCATION_HELP, RESEARCH_SEEDS_HELP, FOUNDED_YEAR_HELP, PHONE_HELP, CTA_HELP } from '@/lib/content/researchCopy'
import { parseServices, geoPhrase, buildResearchSeeds, locationCandidates } from '@/lib/content/researchSeeds'
import KeywordChipInput from '@/components/admin/KeywordChipInput'
import type { EeatData }       from '@/lib/content/types'

interface SiteOption {
  connectionId: string
  siteUrl:      string
  siteName:     string
  clientId:     string
}

interface BrandDnaForm {
  business_background: string
  services:            string
  target_audience:     string
  geographic_focus:    string
  brand_voice:         string
  phone_number:        string
  cta_list:            string
}

const EMPTY_EEAT: EeatData = {
  founded_year:           '',
  years_in_business:      '',
  licenses:               '',
  insurance:              '',
  awards:                 '',
  review_count:           '',
  owner_details:          '',
  team_experience:        '',
  guarantees:             '',
  brands_used:            '',
  financing_options:      '',
  emergency_availability: false,
  warranties:             '',
  case_studies:           '',
  before_after_proof:     '',
  common_objections:      '',
}

function Label({ children, hint, help }: {
  children: React.ReactNode
  /** A few words, shown inline. */
  hint?: string
  /**
   * The longer explanation, on hover rather than on screen.
   *
   * These forms were mostly prose about the form. Guidance someone needs once, while deciding what
   * to type, does not have to occupy the page for everyone who already knows.
   */
  help?: string
}) {
  return (
    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
      {children}
      {hint && <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}> — {hint}</span>}
      {help && (
        <span
          title={help}
          aria-label={help}
          tabIndex={0}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 13, height: 13, marginLeft: 5, borderRadius: '50%', cursor: 'help',
            border: '1px solid var(--border)', color: 'var(--text-faint)',
            fontSize: '0.5625rem', fontWeight: 700, lineHeight: 1, verticalAlign: 'middle',
          }}
        >?</span>
      )}
    </label>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none"
      style={{ background: checked ? 'var(--blue)' : 'var(--bg-muted)' }}
    >
      <span
        className="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform"
        style={{ transform: checked ? 'translateX(1rem)' : 'translateX(0)' }}
      />
    </button>
  )
}

export default function ClientContentSettingsForm({
  clientId,
  sites: _sites,
  onResearchRun,
}: {
  clientId: string
  sites:    SiteOption[]
  /** After a successful re-run, so whatever shows the candidate pool can refetch. */
  onResearchRun?: () => void
}) {
  const [form,        setForm]        = useState<BrandDnaForm>({ business_background: '', services: '', target_audience: '', geographic_focus: '', brand_voice: '', phone_number: '', cta_list: '' })
  const [eeat,        setEeat]        = useState<EeatData>(EMPTY_EEAT)
  const [saving,      setSaving]      = useState(false)
  const [saved,       setSaved]       = useState(false)
  const [error,       setError]       = useState('')
  const [loading,     setLoading]     = useState(true)
  const [aiLoading,   setAiLoading]   = useState(false)
  const [aiError,     setAiError]     = useState('')
  const [aiSuggested, setAiSuggested] = useState(false)
  const [aiBlocked,     setAiBlocked]     = useState(false)
  const [vertical,      setVertical]      = useState('')
  // Open by default. It feeds every AI prompt and is the difference between expert copy and
  // filler; collapsed, it read as "advanced, skip this" — and left the page half empty.
  const [eeatOpen,      setEeatOpen]      = useState(true)
  const [siteUrlInput,  setSiteUrlInput]  = useState('')
  const [showSiteInput, setShowSiteInput] = useState(false)
  const [siteTextInput, setSiteTextInput] = useState('')
  const [showSiteText,  setShowSiteText]  = useState(false)

  // ── Keyword research seeds ─────────────────────────────────────────────────
  // content_settings.foundational_keywords, kept as one comma-separated string while editing.
  // They belong with the profile: research widens out from these and from Services, so the
  // place to correct them is next to the words they are built on — not the Analytics tab.
  const [seeds, setSeeds]               = useState('')
  const [researchedAt, setResearchedAt] = useState<string | null>(null)
  const [researching, setResearching]   = useState(false)
  const [researchMsg, setResearchMsg]   = useState<string | null>(null)
  const [researchLocation, setResearchLocation] = useState<ResearchLocationValue | null>(null)
  const [confirmRerun, setConfirmRerun] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/admin/content/client-settings?client_id=${clientId}`)
      .then(r => r.json())
      .then((d: Record<string, unknown>) => {
        setForm({
          business_background: String(d.business_background ?? ''),
          services:            String(d.services            ?? ''),
          target_audience:     String(d.target_audience     ?? ''),
          geographic_focus:    String(d.geographic_focus    ?? ''),
          brand_voice:         String(d.brand_voice         ?? ''),
          phone_number:        String(d.phone_number        ?? ''),
          cta_list:            String(d.cta_list            ?? ''),
        })
        setVertical(String(d.vertical ?? ''))
        setSeeds(Array.isArray(d.foundational_keywords) ? d.foundational_keywords.map(String).join(', ') : '')
        setResearchLocation(readLocationValue(d.research_location))
        if (d.eeat_data && typeof d.eeat_data === 'object') {
          setEeat({ ...EMPTY_EEAT, ...(d.eeat_data as Partial<EeatData>) })
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
    // Read-only; never spends.
    fetch(`/api/admin/content/keyword-research?client_id=${clientId}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { researchedAt?: string | null } | null) => setResearchedAt(d?.researchedAt ?? null))
      .catch(() => { /* the date is a nicety */ })
  }, [clientId])

  function setField<K extends keyof BrandDnaForm>(key: K, val: string) {
    setForm(p => ({ ...p, [key]: val }))
  }
  function setEeatField<K extends keyof EeatData>(key: K, val: EeatData[K]) {
    setEeat(p => ({ ...p, [key]: val }))
  }

  async function autoFill(siteUrl?: string, siteText?: string) {
    setAiLoading(true); setAiError(''); setAiSuggested(false); setAiBlocked(false)
    const res = await fetch('/api/admin/content/generate-brand-dna', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        ...(siteUrl  ? { site_url:  siteUrl  } : {}),
        ...(siteText ? { site_text: siteText } : {}),
      }),
    })
    setAiLoading(false)
    if (res.status === 422) {
      const body = await res.json().catch(() => ({} as Record<string, unknown>)) as { error?: string; site_url?: string }
      if (body.error === 'blocked') {
        // Site was detected but is blocking server-side fetches (Cloudflare/bot protection)
        setAiBlocked(true)
        setSiteUrlInput(body.site_url ?? siteUrl ?? '')
        setShowSiteInput(true)
      } else if (body.error === 'site_url_required') {
        // No WP connection found — prompt for manual URL entry
        setAiBlocked(false)
        setShowSiteInput(true)
      } else {
        // Other 422 (e.g. invalid URL) — show as error
        setAiError(body.error || 'Could not analyze site')
      }
      return
    }
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setAiError((d as { error?: string }).error || 'Auto-fill failed')
      return
    }
    const d = await res.json() as {
      business_background: string; services: string
      target_audience: string; geographic_focus: string; brand_voice: string
      years_in_business?: string; review_count?: string; licenses?: string
      insurance?: string; awards?: string; owner_details?: string
      team_experience?: string; guarantees?: string; brands_used?: string
      financing_options?: string; warranties?: string; emergency_availability?: boolean
      case_studies?: string; before_after_proof?: string; common_objections?: string
      cta_list?: string
    }
    setForm(prev => ({
      ...prev,
      business_background: d.business_background || prev.business_background,
      services:            d.services            || prev.services,
      target_audience:     d.target_audience     || prev.target_audience,
      geographic_focus:    d.geographic_focus    || prev.geographic_focus,
      brand_voice:         d.brand_voice         || prev.brand_voice,
      ...(d.cta_list ? { cta_list: d.cta_list } : {}),
    }))
    // Merge any E-E-A-T signals the AI found — only overwrite non-empty values
    const EEAT_KEYS: (keyof EeatData)[] = [
      'founded_year','years_in_business','review_count','licenses','insurance','awards',
      'owner_details','team_experience','guarantees','brands_used','financing_options',
      'warranties','emergency_availability','case_studies','before_after_proof','common_objections',
    ]
    const eeatUpdate: Partial<EeatData> = {}
    for (const k of EEAT_KEYS) {
      const v = (d as Record<string, unknown>)[k]
      if (v !== undefined && v !== null && v !== '') {
        (eeatUpdate as Record<string, unknown>)[k] = v
      }
    }
    if (Object.keys(eeatUpdate).length > 0) {
      setEeat(prev => ({ ...prev, ...eeatUpdate }))
      setEeatOpen(true) // auto-expand so users can see the populated fields
    }
    setAiSuggested(true)
    setShowSiteInput(false)
  }

  // foundational_keywords is no longer editable here, so it is no longer sent. The PUT handler
  // only writes fields present in the body, which leaves whatever an older client had stored
  // intact — research still unions it into the seeds. Removing the field must not wipe the data.

  async function save(): Promise<boolean> {
    setSaving(true); setError(''); setSaved(false)
    const res = await fetch('/api/admin/content/client-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        ...form,
        eeat_data: eeat,
        vertical: vertical || null,
        research_location: researchLocation,
      }),
    })
    setSaving(false)
    if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500); return true }
    const d = await res.json().catch(() => ({})) as { error?: string }
    setError(d.error || 'Failed to save')
    return false
  }

  /**
   * Save the profile (the seeds live in it), clear the researched candidates, look at the
   * market again. Spends a few cents in DataForSEO calls when the client is connected.
   */
  async function rerunResearch() {
    setResearching(true); setResearchMsg(null)
    try {
      if (!(await save())) throw new Error('unsaved')
      const res = await fetch('/api/admin/content/keyword-research', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ client_id: clientId, force: true }),
      })
      const d = await res.json().catch(() => ({})) as {
        discovered?: number; cost?: number; competitors?: string[]
        researchedAt?: string | null; connected?: boolean; error?: string; reason?: string
      }
      if (!res.ok) throw new Error('failed')
      if (d.reason === 'storage failed') throw new Error('unstored')
      setResearchedAt(d.researchedAt ?? new Date().toISOString())
      const ideas = d.discovered ?? 0
      const sites = d.competitors?.length ?? 0
      setResearchMsg(d.connected === false
        ? 'DataForSEO isn’t connected for this client, so this used Google Ads and Ahrefs data only. Connect it on the client’s Integrations tab for search volumes and competing sites.'
        : `Found ${ideas.toLocaleString()} keyword idea${ideas === 1 ? '' : 's'}`
          + (sites ? ` and ${sites} competing site${sites === 1 ? '' : 's'}` : '')
          + (d.cost != null && d.cost > 0 ? ` for $${d.cost.toFixed(2)}` : '')
          + '. They’re on the Analytics tab now.')
      onResearchRun?.()
    } catch (e) {
      // The real reason goes to the console; the operator gets a sentence they can act on.
      console.warn('[brand-dna] research failed:', e)
      const why = e instanceof Error ? e.message : ''
      setResearchMsg(why === 'unsaved'
        ? 'Brand DNA did not save, so nothing was researched. Fix the error above and try again.'
        : why === 'unstored'
        ? 'Research ran but the results couldn’t be saved. Nothing to fix on your side — tell your admin the keyword tables aren’t ready yet.'
        : 'Research didn’t finish. Try again in a minute — if it keeps happening, check the DataForSEO connection on the Integrations page.')
    } finally {
      setResearching(false)
    }
  }

  if (loading) return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: 700 }}>

      {/* ── Business Context ─────────────────────────────────────────────── */}
      <div className="card p-6 space-y-4">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h3 className="section-title" style={{ marginBottom: 2 }}>Business Context</h3>
            <p className="section-desc" style={{ margin: 0 }}>Used to give the AI background on this client&rsquo;s business for content generation.</p>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: '0.8125rem', padding: '0.375rem 0.75rem', whiteSpace: 'nowrap', flexShrink: 0 }}
            onClick={() => autoFill()}
            disabled={aiLoading}
          >
            {aiLoading ? 'Analyzing…' : '✦ Auto-fill with AI'}
          </button>
        </div>

        {/* Site URL input — shown when WP URL not found or site is blocking fetches */}
        {showSiteInput && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {aiBlocked && (
            <p style={{ fontSize: '0.8125rem', color: 'var(--amber, #f59e0b)', margin: 0, lineHeight: 1.4 }}>
              ⚠ Your site is blocking automated access (likely Cloudflare or security rules). Enter your site URL below to try again, or fill in your business info manually.
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="https://yourdomain.com"
              value={siteUrlInput}
              onChange={e => setSiteUrlInput(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-primary"
              style={{ fontSize: '0.8125rem', padding: '0.375rem 0.75rem', whiteSpace: 'nowrap' }}
              onClick={() => autoFill(siteUrlInput)}
              disabled={aiLoading || !siteUrlInput.trim()}
            >
              {aiLoading ? 'Analyzing…' : 'Analyze Site'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '0.8125rem', padding: '0.375rem 0.625rem' }}
              onClick={() => { setShowSiteInput(false); setAiBlocked(false) }}
            >✕</button>
          </div>
          {/* Paste text fallback — shown when site is blocking automated fetches */}
          {aiBlocked && (
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                style={{ fontSize: '0.8125rem', color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                onClick={() => setShowSiteText(s => !s)}
              >
                {showSiteText ? 'Hide' : 'Or paste your website text instead'}
              </button>
              {showSiteText && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <textarea
                    className="input"
                    rows={6}
                    style={{ resize: 'vertical', fontSize: '0.8125rem' }}
                    placeholder="Paste your homepage or about page text here…"
                    value={siteTextInput}
                    onChange={e => setSiteTextInput(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ fontSize: '0.8125rem', alignSelf: 'flex-start' }}
                    onClick={() => autoFill(undefined, siteTextInput)}
                    disabled={aiLoading || !siteTextInput.trim()}
                  >
                    {aiLoading ? 'Analyzing…' : 'Analyze Text'}
                  </button>
                </div>
              )}
            </div>
          )}
          </div>
        )}

        {/* AI suggestion banner */}
        {aiSuggested && (
          <div style={{ background: '#fefce8', border: '1px solid #fde047', borderRadius: 6, padding: '0.625rem 0.875rem', fontSize: '0.8125rem', color: '#854d0e' }}>
            ✦ AI-generated suggestions applied — review each field before saving.
          </div>
        )}
        {aiError && (
          <div style={{ background: 'var(--red-subtle)', border: '1px solid #fecaca', borderRadius: 6, padding: '0.5rem 0.75rem', fontSize: '0.8125rem', color: 'var(--red)' }}>
            {aiError}
          </div>
        )}

        <div>
          <Label hint="What does this business do?">Business Background</Label>
          <textarea className="input" rows={4} style={{ width: '100%' }} value={form.business_background} onChange={e => setField('business_background', e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label help={SERVICES_HELP}>Services Offered</Label>
            <KeywordChipInput value={form.services} onChange={v => setField('services', v)} placeholder="Plumbing, HVAC, Electrical" />
          </div>
          <div>
            <Label>Target Audience</Label>
            <input className="input" style={{ width: '100%' }} value={form.target_audience} onChange={e => setField('target_audience', e.target.value)} />
          </div>
          <div>
            <Label hint="strongest first" help={SERVICE_AREAS_HELP}>Service Areas</Label>
            <KeywordChipInput
              value={form.geographic_focus}
              onChange={v => setField('geographic_focus', v)}
              placeholder="Los Angeles, Orange County…"
            />
          </div>
          <div>
            <Label>Brand Voice</Label>
            <input className="input" style={{ width: '100%' }} value={form.brand_voice} onChange={e => setField('brand_voice', e.target.value)} />
          </div>
        </div>

        <div>
          <Label hint="primary market" help={RESEARCH_LOCATION_HELP}>Research Location</Label>
          <ResearchLocationPicker value={researchLocation} onChange={setResearchLocation} />
          {!researchLocation && (() => {
            // The place name research will look up, not the raw first service area. "Los Angeles
            // and Tri-County area" is one entry meaning one city, and showing it verbatim implied
            // we would search for a phrase that resolves to nothing.
            const first = locationCandidates(form.geographic_focus)[0]
            return (
              <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
                {first
                  ? <>Measuring in <strong style={{ color: 'var(--text-muted)' }}>{first}</strong>, read from your first service area. Set one here to override.</>
                  : 'No local market in your service areas, so demand is measured nationwide.'}
              </p>
            )
          })()}

        </div>

        <div>
          <Label help={RESEARCH_SEEDS_HELP}>What we search for</Label>
          {/* Shown, not asked for. This was a second chip input the operator filled in by hand,
              and every client had it as a verbatim copy of Services Offered — because that is
              what it is. The phrases come from buildResearchSeeds, the same function research
              itself calls, so the preview cannot drift from what actually gets bought. */}
          <SeedPreview
            services={form.services}
            location={researchLocation}
            geographicFocus={form.geographic_focus}
            extra={seeds}
          />
          <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
            {researchedAt ? `Last researched ${new Date(researchedAt).toLocaleDateString()}.` : 'Not researched yet.'}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
            <p className="text-xs" style={{ color: 'var(--text-faint)', margin: 0, flex: 1, minWidth: 220 }}>
              Looking again replaces this client&apos;s keyword ideas. Anything already chosen stays chosen.
            </p>
            {confirmRerun ? (
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '0.8125rem', color: 'var(--text-primary)' }}>
                Replace the current keyword ideas?
                <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8125rem', padding: '0.375rem 0.75rem' }} onClick={() => setConfirmRerun(false)}>Cancel</button>
                <button type="button" className="btn btn-primary" style={{ fontSize: '0.8125rem', padding: '0.375rem 0.75rem' }} onClick={() => { setConfirmRerun(false); void rerunResearch() }}>Yes, look again</button>
              </span>
            ) : (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: '0.8125rem', padding: '0.375rem 0.75rem', whiteSpace: 'nowrap' }}
                onClick={() => { if (researchedAt) setConfirmRerun(true); else void rerunResearch() }}
                disabled={researching || saving || !form.services.trim()}
              >
                {researching ? 'Looking…' : 'Look again'}
              </button>
            )}
          </div>
          {researchMsg && (
            <p className="text-xs mt-1" style={{ color: /didn|did not|couldn/i.test(researchMsg) ? 'var(--red)' : 'var(--text-muted)' }}>{researchMsg}</p>
          )}
        </div>

        <div>
          <Label hint="used when referencing phone in content" help={PHONE_HELP}>Phone Number</Label>
          <input className="input" type="tel" style={{ width: '50%' }} value={form.phone_number} onChange={e => setField('phone_number', e.target.value)} placeholder="(321) 555-5555" />
        </div>

        <div>
          <Label hint="one per line" help={CTA_HELP}>Call-to-Action Options</Label>
          <textarea
            className="input"
            rows={3}
            style={{ width: '100%' }}
            value={form.cta_list}
            onChange={e => setField('cta_list', e.target.value)}
            placeholder={`e.g.\nCall us at (321) 555-5555 for a free quote.\nBook online at https://example.com/book`}
          />
        </div>
      </div>

      {/* ── Trust & Credibility (E-E-A-T) ────────────────────────────────── */}
      <details className="card" style={{ overflow: 'hidden' }} open={eeatOpen} onToggle={e => setEeatOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className="p-6 cursor-pointer font-semibold text-sm flex items-center justify-between" style={{ color: 'var(--text-primary)', listStyle: 'none' }}>
          <span>Trust &amp; Credibility <span className="text-xs font-normal ml-1" style={{ color: 'var(--text-muted)' }}>what makes this business worth believing — a few fields here change the writing noticeably</span></span>
          <span style={{ color: 'var(--text-faint)', fontSize: '0.75rem' }}>{eeatOpen ? '▾' : '▸'}</span>
        </summary>

        <div className="p-6 pt-0 space-y-4" style={{ borderTop: '1px solid var(--border)' }}>
          {/* Regulated vertical — a compliance switch, not a style preference.
              Turning this on bans invented rates/requirements/outcomes in the
              writer prompt AND enables figure detection in the quality gate. */}
          <div>
            <Label>Regulated vertical</Label>
            <select
              className="input"
              style={{ width: '100%' }}
              value={vertical}
              onChange={e => setVertical(e.target.value)}
            >
              <option value="">Not regulated</option>
              <option value="finance">Finance / lending</option>
              <option value="insurance">Insurance</option>
              <option value="medical">Medical / health</option>
              <option value="legal">Legal</option>
            </select>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: 4, lineHeight: 1.5 }}>
              {vertical
                ? 'The writer is forbidden from inventing rates, requirements, eligibility or outcomes, and generated posts are scanned for unsourced figures and approval promises before they can auto-publish.'
                : 'Leave off unless the client operates in a regulated space. When on, the AI may not state any rate, requirement or outcome that was not supplied here.'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 eeat-grid">
            <div>
              <Label help={FOUNDED_YEAR_HELP}>Year Founded</Label>
              <input className="input" type="number" min={1800} max={new Date().getFullYear()} style={{ width: '100%' }} value={eeat.founded_year} onChange={e => setEeatField('founded_year', e.target.value)} placeholder="e.g. 2003" />
            </div>
            <div>
              <Label>Reviews (count &amp; rating)</Label>
              <input className="input" style={{ width: '100%' }} value={eeat.review_count} onChange={e => setEeatField('review_count', e.target.value)} placeholder="e.g. 4.9 stars · 387 reviews" />
            </div>
            <div>
              <Label>Licenses &amp; Certifications</Label>
              <textarea className="input" rows={2} style={{ width: '100%' }} value={eeat.licenses} onChange={e => setEeatField('licenses', e.target.value)} placeholder="e.g. FL State Licensed HVAC #CAC1234" />
            </div>
            <div>
              <Label>Insurance &amp; Bonding</Label>
              <input className="input" style={{ width: '100%' }} value={eeat.insurance} onChange={e => setEeatField('insurance', e.target.value)} placeholder="e.g. Fully insured & bonded" />
            </div>
            <div>
              <Label>Awards &amp; Recognition</Label>
              <textarea className="input" rows={2} style={{ width: '100%' }} value={eeat.awards} onChange={e => setEeatField('awards', e.target.value)} placeholder="e.g. Angie's List Super Service Award 2023" />
            </div>
            <div>
              <Label>Owner / Founder</Label>
              <textarea className="input" rows={2} style={{ width: '100%' }} value={eeat.owner_details} onChange={e => setEeatField('owner_details', e.target.value)} placeholder="e.g. Family-owned by John Smith since 2002" />
            </div>
            <div>
              <Label>Team Experience</Label>
              <textarea className="input" rows={2} style={{ width: '100%' }} value={eeat.team_experience} onChange={e => setEeatField('team_experience', e.target.value)} placeholder="e.g. Average 12 years field experience per tech" />
            </div>
            <div>
              <Label>Service Guarantees</Label>
              <textarea className="input" rows={2} style={{ width: '100%' }} value={eeat.guarantees} onChange={e => setEeatField('guarantees', e.target.value)} placeholder="e.g. 100% satisfaction guarantee, 10-yr workmanship" />
            </div>
            <div>
              <Label>Brands / Products Used</Label>
              <textarea className="input" rows={2} style={{ width: '100%' }} value={eeat.brands_used} onChange={e => setEeatField('brands_used', e.target.value)} placeholder="e.g. Carrier, Trane, Lennox equipment" />
            </div>
            <div>
              <Label>Financing Options</Label>
              <input className="input" style={{ width: '100%' }} value={eeat.financing_options} onChange={e => setEeatField('financing_options', e.target.value)} placeholder="e.g. 12-month 0% financing available" />
            </div>
            <div>
              <Label>Warranties</Label>
              <textarea className="input" rows={2} style={{ width: '100%' }} value={eeat.warranties} onChange={e => setEeatField('warranties', e.target.value)} placeholder="e.g. 5-yr parts, 10-yr labor on new systems" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', paddingTop: '1.25rem' }}>
              <Toggle checked={eeat.emergency_availability} onChange={v => setEeatField('emergency_availability', v)} />
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>24/7 Emergency Service Available</span>
            </div>
          </div>

          <div>
            <Label>Case Studies / Notable Projects</Label>
            <textarea className="input" rows={3} style={{ width: '100%' }} value={eeat.case_studies} onChange={e => setEeatField('case_studies', e.target.value)} placeholder="e.g. Replaced 200+ units in HOA communities, completed commercial projects for..." />
          </div>
          <div>
            <Label>Before / After Proof</Label>
            <textarea className="input" rows={2} style={{ width: '100%' }} value={eeat.before_after_proof} onChange={e => setEeatField('before_after_proof', e.target.value)} placeholder="e.g. Before/after photos of installs available, documented energy savings" />
          </div>
          <div>
            <Label hint="helps AI address real concerns in content">Common Customer Objections</Label>
            <textarea className="input" rows={3} style={{ width: '100%' }} value={eeat.common_objections} onChange={e => setEeatField('common_objections', e.target.value)} placeholder="e.g. Price concerns, timing uncertainty, DIY temptation..." />
          </div>
        </div>
      </details>

      {/* ── Save ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save Brand DNA'}
        </button>
        {saved && <span className="text-xs" style={{ color: 'var(--green)' }}>Saved ✓</span>}
        {error && <span className="text-xs" style={{ color: 'var(--red)' }}>{error}</span>}
      </div>
    </div>
  )
}

/**
 * What research will search for, derived rather than typed.
 *
 * Built by buildResearchSeeds — the function research itself calls — so what is on screen is what
 * gets bought. The geo variants are shown muted: they are the same service with the market pinned
 * on, and letting them read as separate entries made five services look like ten decisions.
 */
function SeedPreview({ services, location, geographicFocus, extra }: {
  services:        string
  location:        ResearchLocationValue | null
  geographicFocus: string
  /** content_settings.foundational_keywords, from older clients. Read-only now. */
  extra:           string
}) {
  const list  = parseServices(services)
  const geo   = geoPhrase(location ? { name: location.name } : null, geographicFocus)
  const older = String(extra ?? '').split(/[,;\n]+/).map(v => v.trim()).filter(Boolean)
  // Anything stored that is not simply one of the services — the rest would read as a duplicate.
  const kept  = older.filter(v => !list.some(s => s.toLowerCase() === v.toLowerCase()))
  const seeds = buildResearchSeeds(list, geo, kept)

  if (seeds.length === 0) {
    return (
      <p className="text-xs" style={{ margin: 0, color: 'var(--text-faint)' }}>
        Add a service above and the searches appear here.
      </p>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {seeds.map(s => {
          const isGeo = !!geo && s.toLowerCase().endsWith(` ${geo.toLowerCase()}`)
          return (
            <span
              key={s}
              style={{
                display: 'inline-flex', alignItems: 'center',
                background: isGeo ? 'transparent' : 'var(--bg-subtle)',
                border: '1px solid var(--border)',
                borderRadius: 999, padding: '2px 9px', fontSize: '0.78rem',
                color: isGeo ? 'var(--text-faint)' : 'var(--text-primary)',
              }}
            >
              {s}
            </span>
          )
        })}
      </div>
      <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
        {seeds.length} search{seeds.length === 1 ? '' : 'es'}
        {geo ? <> — the faded ones are the same service measured in <strong style={{ color: 'var(--text-muted)' }}>{geo}</strong>.</> : '.'}
      </p>
    </div>
  )
}
