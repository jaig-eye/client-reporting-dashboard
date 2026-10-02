'use client'

import Switch from '@/components/ui/Switch'
import { Sk } from '@/components/ui/Skeleton'
import { CheckCircle, Sparkle, X, WarningCircle } from '@phosphor-icons/react'
import { useState, useEffect } from 'react'
import { SERVICES_HELP, SERVICE_AREAS_HELP, FOUNDED_YEAR_HELP, PHONE_HELP, CTA_HELP } from '@/lib/content/researchCopy'
import KeywordChipInput from '@/components/admin/KeywordChipInput'
import MarketLine from '@/components/admin/MarketLine'
import { HelpTip } from '@/components/admin/KeywordUi'
import type { EeatData }       from '@/lib/content/types'

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

function Label({ children, hint, help, htmlFor }: {
  children: React.ReactNode
  /** The control this names. A label without one names nothing for a screen reader. */
  htmlFor?: string
  /** A few words, shown inline. */
  hint?: string
  /**
   * The longer explanation, behind a "?" rather than on screen.
   *
   * These forms were mostly prose about the form. Guidance someone needs once, while deciding what
   * to type, does not have to occupy the page for everyone who already knows. It opens on hover,
   * keyboard focus and tap (HelpTip) — a title attribute, which this used to be, shows on none of
   * the last two. The "?" sits beside the label, not inside it, so its text does not become part
   * of the field's name.
   */
  help?: string
}) {
  const label = (
    <label htmlFor={htmlFor} className={help ? 'ccs-label ccs-label--inline' : 'ccs-label'}>
      {children}
      {hint && <span className="ccs-label-hint">{hint}</span>}
    </label>
  )
  if (!help) return label
  return (
    <div className="mb-1" style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
      {label}
      <HelpTip label={`About “${typeof children === 'string' ? children : 'this field'}”`}>{help}</HelpTip>
    </div>
  )
}

/**
 * Shown in place of a settings form whose settings could not be read.
 *
 * In place of, not above: a form filled from a failed read is a blank form, and its Save would
 * write those blanks over the real values.
 */
export function SettingsLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="card p-5"
      style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderColor: 'var(--red)', background: 'var(--red-subtle)' }}
    >
      <p style={{ margin: 0, flex: '1 1 260px', fontSize: '0.8125rem', lineHeight: 1.5, color: 'var(--text-primary)' }}>
        <strong style={{ fontWeight: 600 }}>Couldn&apos;t load this client&apos;s settings</strong> ({message}).{' '}
        <span style={{ color: 'var(--text-secondary)' }}>Nothing can be saved until they load, so nothing is overwritten with blanks.</span>
      </p>
      <button type="button" className="btn btn-secondary" onClick={onRetry}>Retry</button>
    </div>
  )
}

export default function ClientContentSettingsForm({ clientId }: { clientId: string }) {
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
  const [siteUrlInput,  setSiteUrlInput]  = useState('')
  const [showSiteInput, setShowSiteInput] = useState(false)
  const [siteTextInput, setSiteTextInput] = useState('')
  const [showSiteText,  setShowSiteText]  = useState(false)
  // Set when the settings could not be read. The form is not shown then: filled from an error
  // body it is a blank form, and saving a blank form wipes the client's Brand DNA.
  const [loadError,     setLoadError]     = useState<string | null>(null)
  const [reloadKey,     setReloadKey]     = useState(0)

  useEffect(() => {
    setLoading(true)
    setLoadError(null)
    fetch(`/api/admin/content/client-settings?client_id=${clientId}`)
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({})) as { error?: string }
          throw new Error(body.error ?? `HTTP ${r.status}`)
        }
        return r.json()
      })
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
        if (d.eeat_data && typeof d.eeat_data === 'object') {
          setEeat({ ...EMPTY_EEAT, ...(d.eeat_data as Partial<EeatData>) })
        }
        setLoading(false)
      })
      .catch(e => { setLoadError(e instanceof Error ? e.message : 'Could not load'); setLoading(false) })
  }, [clientId, reloadKey])

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
      // No expanding to do — the section is always open now.
    }
    setAiSuggested(true)
    setShowSiteInput(false)
  }

  // foundational_keywords and research_location are not editable here any more, so neither is
  // sent. The PUT handler only writes fields present in the body, so leaving them out preserves
  // them — and stops a Brand DNA save from writing a stale location back over one just changed in
  // the Keywords tab.

  async function save(): Promise<boolean> {
    // Belt and braces: the form is not rendered after a failed load, but nothing here may write
    // what it never read.
    if (loadError) return false
    setSaving(true); setError(''); setSaved(false)
    const res = await fetch('/api/admin/content/client-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        ...form,
        eeat_data: eeat,
        vertical: vertical || null,
      }),
    })
    setSaving(false)
    if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500); return true }
    const d = await res.json().catch(() => ({})) as { error?: string }
    setError(d.error || 'Failed to save')
    return false
  }


  if (loading) return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }} aria-busy="true" aria-label="Loading brand DNA">
      <Sk w={160} h={15} /><Sk w="60%" h={11} /><Sk h={90} r={8} />
      <span className="ui-grid-2"><Sk h={38} r={8} /><Sk h={38} r={8} /></span>
    </div>
  )
  if (loadError) return <SettingsLoadError message={loadError} onRetry={() => setReloadKey(k => k + 1)} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: 700 }}>

      {/* ── Business Context ─────────────────────────────────────────────── */}
      <div className="card p-6 space-y-4">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h3 className="section-title" style={{ marginBottom: 2 }}>Business context</h3>
            <p className="section-desc" style={{ margin: 0 }}>Used to give the AI background on this client&rsquo;s business for content generation.</p>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
            onClick={() => autoFill()}
            disabled={aiLoading}
          >
            <Sparkle size={14} weight="fill" aria-hidden />{aiLoading ? 'Reading the site…' : 'Fill in with AI'}
          </button>
        </div>

        {/* Site URL input — shown when WP URL not found or site is blocking fetches */}
        {showSiteInput && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {aiBlocked && (
            <div className="ui-notice ui-notice--warning" style={{ margin: 0 }}>
              <span>The site is blocking automated reads, probably Cloudflare or a security rule. Enter its address below to try again, paste its text, or fill the fields in by hand.</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              className="input"
              style={{ flex: 1 }}
              aria-label="Website URL to analyze"
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
              {aiLoading ? 'Reading…' : 'Read the site'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              aria-label="Close"
              onClick={() => { setShowSiteInput(false); setAiBlocked(false) }}
            ><X size={14} weight="bold" aria-hidden /></button>
          </div>
          {/* Paste text fallback — shown when site is blocking automated fetches */}
          {aiBlocked && (
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="cp-inline-link"
                style={{ fontSize: '0.8125rem' }}
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
                    aria-label="Website text to analyze"
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
                    {aiLoading ? 'Reading…' : 'Read this text'}
                  </button>
                </div>
              )}
            </div>
          )}
          </div>
        )}

        {/* AI suggestion banner */}
        {aiSuggested && (
          <div className="ui-notice ui-notice--info" role="status" style={{ margin: 0 }}>
            <span><Sparkle size={13} weight="fill" aria-hidden style={{ display: 'inline-block', verticalAlign: -1, marginRight: 6 }} />Filled in with AI. Check each field before you save.</span>
          </div>
        )}
        {aiError && (
          <div className="ui-notice ui-notice--danger" role="alert" style={{ margin: 0 }}>
            <span><WarningCircle size={14} weight="fill" aria-hidden style={{ display: 'inline-block', verticalAlign: -2, marginRight: 6 }} />{aiError}</span>
          </div>
        )}

        <div>
          <Label htmlFor="bd-business-background" hint="What does this business do?">Business background</Label>
          <textarea id="bd-business-background" className="input" rows={4} style={{ width: '100%' }} value={form.business_background} onChange={e => setField('business_background', e.target.value)} />
        </div>

        <div className="ui-grid-2">
          <div>
            <Label htmlFor="bd-services" help={SERVICES_HELP}>What they sell</Label>
            <KeywordChipInput id="bd-services" value={form.services} onChange={v => setField('services', v)} placeholder="Plumbing, HVAC, Electrical…" />
          </div>
          <div>
            <Label htmlFor="bd-target-audience">Target audience</Label>
            <input id="bd-target-audience" className="input" style={{ width: '100%' }} value={form.target_audience} onChange={e => setField('target_audience', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="bd-service-areas" hint="strongest first" help={SERVICE_AREAS_HELP}>Service areas</Label>
            <KeywordChipInput
              id="bd-service-areas"
              value={form.geographic_focus}
              onChange={v => setField('geographic_focus', v)}
              placeholder="Start typing a city or county…"
              suggestPlaces
            />
            <MarketLine geographicFocus={form.geographic_focus} />
          </div>
          <div>
            <Label htmlFor="bd-brand-voice">Brand voice</Label>
            <input id="bd-brand-voice" className="input" style={{ width: '100%' }} value={form.brand_voice} onChange={e => setField('brand_voice', e.target.value)} />
          </div>
        </div>

        {/* Research Location, the seed preview and "Look again" used to sit here. They are all
            about where and what we search, which happens in the Keywords tab — so they live there
            now, and this screen is only about who the business is. */}

        <div>
          <Label htmlFor="bd-phone" hint="used when referencing phone in content" help={PHONE_HELP}>Phone number</Label>
          <input id="bd-phone" className="input" type="tel" style={{ width: '50%' }} value={form.phone_number} onChange={e => setField('phone_number', e.target.value)} placeholder="(321) 555-5555" />
        </div>

        <div>
          <Label htmlFor="bd-cta" hint="one per line" help={CTA_HELP}>Calls to action</Label>
          <textarea
            id="bd-cta"
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
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="p-6 pb-4">
          <h2 className="section-title" style={{ marginBottom: 0 }}>Trust and credibility</h2>
          <p className="section-desc" style={{ marginTop: '0.125rem' }}>What makes this business worth believing.</p>
        </div>

        <div className="p-6 pt-0 space-y-4">
          {/* Regulated vertical — a compliance switch, not a style preference.
              Turning this on bans invented rates/requirements/outcomes in the
              writer prompt AND enables figure detection in the quality gate. */}
          <div>
            <Label htmlFor="bd-vertical">Regulated vertical</Label>
            <select
              id="bd-vertical"
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

          <div className="ui-grid-2 eeat-grid">
            <div>
              <Label htmlFor="bd-founded-year" help={FOUNDED_YEAR_HELP}>Year founded</Label>
              <input id="bd-founded-year" className="input" type="number" min={1800} max={new Date().getFullYear()} style={{ width: '100%' }} value={eeat.founded_year} onChange={e => setEeatField('founded_year', e.target.value)} placeholder="e.g. 2003" />
            </div>
            <div>
              <Label htmlFor="bd-reviews">Reviews (count and rating)</Label>
              <input id="bd-reviews" className="input" style={{ width: '100%' }} value={eeat.review_count} onChange={e => setEeatField('review_count', e.target.value)} placeholder="e.g. 4.9 stars · 387 reviews" />
            </div>
            <div>
              <Label htmlFor="bd-licenses">Licenses and certifications</Label>
              <textarea id="bd-licenses" className="input" rows={2} style={{ width: '100%' }} value={eeat.licenses} onChange={e => setEeatField('licenses', e.target.value)} placeholder="e.g. FL State Licensed HVAC #CAC1234" />
            </div>
            <div>
              <Label htmlFor="bd-insurance">Insurance and bonding</Label>
              <input id="bd-insurance" className="input" style={{ width: '100%' }} value={eeat.insurance} onChange={e => setEeatField('insurance', e.target.value)} placeholder="e.g. Fully insured & bonded" />
            </div>
            <div>
              <Label htmlFor="bd-awards">Awards and recognition</Label>
              <textarea id="bd-awards" className="input" rows={2} style={{ width: '100%' }} value={eeat.awards} onChange={e => setEeatField('awards', e.target.value)} placeholder="e.g. Angie's List Super Service Award 2023" />
            </div>
            <div>
              <Label htmlFor="bd-owner">Owner or founder</Label>
              <textarea id="bd-owner" className="input" rows={2} style={{ width: '100%' }} value={eeat.owner_details} onChange={e => setEeatField('owner_details', e.target.value)} placeholder="e.g. Family-owned by John Smith since 2002" />
            </div>
            <div>
              <Label htmlFor="bd-team">Team experience</Label>
              <textarea id="bd-team" className="input" rows={2} style={{ width: '100%' }} value={eeat.team_experience} onChange={e => setEeatField('team_experience', e.target.value)} placeholder="e.g. Average 12 years field experience per tech" />
            </div>
            <div>
              <Label htmlFor="bd-guarantees">Service guarantees</Label>
              <textarea id="bd-guarantees" className="input" rows={2} style={{ width: '100%' }} value={eeat.guarantees} onChange={e => setEeatField('guarantees', e.target.value)} placeholder="e.g. 100% satisfaction guarantee, 10-yr workmanship" />
            </div>
            <div>
              <Label htmlFor="bd-brands">Brands and products used</Label>
              <textarea id="bd-brands" className="input" rows={2} style={{ width: '100%' }} value={eeat.brands_used} onChange={e => setEeatField('brands_used', e.target.value)} placeholder="e.g. Carrier, Trane, Lennox equipment" />
            </div>
            <div>
              <Label htmlFor="bd-financing">Financing options</Label>
              <input id="bd-financing" className="input" style={{ width: '100%' }} value={eeat.financing_options} onChange={e => setEeatField('financing_options', e.target.value)} placeholder="e.g. 12-month 0% financing available" />
            </div>
            <div>
              <Label htmlFor="bd-warranties">Warranties</Label>
              <textarea id="bd-warranties" className="input" rows={2} style={{ width: '100%' }} value={eeat.warranties} onChange={e => setEeatField('warranties', e.target.value)} placeholder="e.g. 5-yr parts, 10-yr labor on new systems" />
            </div>
            {/* .eeat-grid makes each cell a column, so this centres vertically and starts on the left. */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '1.25rem' }}>
              <Switch label="24/7 emergency service available" checked={eeat.emergency_availability} onChange={v => setEeatField('emergency_availability', v)} />
            </div>
          </div>

          <div>
            <Label htmlFor="bd-case-studies">Case studies and notable projects</Label>
            <textarea id="bd-case-studies" className="input" rows={3} style={{ width: '100%' }} value={eeat.case_studies} onChange={e => setEeatField('case_studies', e.target.value)} placeholder="e.g. Replaced 200+ units in HOA communities, completed commercial projects for..." />
          </div>
          <div>
            <Label htmlFor="bd-before-after">Before-and-after proof</Label>
            <textarea id="bd-before-after" className="input" rows={2} style={{ width: '100%' }} value={eeat.before_after_proof} onChange={e => setEeatField('before_after_proof', e.target.value)} placeholder="e.g. Before/after photos of installs available, documented energy savings" />
          </div>
          <div>
            <Label htmlFor="bd-objections" hint="helps AI address real concerns in content">Common customer objections</Label>
            <textarea id="bd-objections" className="input" rows={3} style={{ width: '100%' }} value={eeat.common_objections} onChange={e => setEeatField('common_objections', e.target.value)} placeholder="e.g. Price concerns, timing uncertainty, DIY temptation..." />
          </div>
        </div>
      </div>

      {/* ── Save ─────────────────────────────────────────────────────────── */}
      <div className="ui-saverow">
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save brand DNA'}
        </button>
        {saved && <span className="ui-saved" role="status"><CheckCircle size={16} weight="fill" aria-hidden />Saved</span>}
        {error && <span className="ui-savefail" role="alert">{error}</span>}
      </div>
    </div>
  )
}
