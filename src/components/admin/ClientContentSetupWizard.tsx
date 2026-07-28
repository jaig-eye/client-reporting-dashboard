'use client'

import { useState, useEffect, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface BrandDna {
  business_background: string
  services: string
  target_audience: string
  geographic_focus: string
  brand_voice: string
  years_in_business: string
  phone_number: string
  owner_details: string
  licenses: string
  guarantees: string
  review_count: string
  emergency_availability: boolean
}

interface SitemapPage {
  url: string
  title: string | null
  isPriority: boolean
  isExcluded: boolean
}

interface Schedule {
  frequency: string
  dayOfWeek: number
  publishTime: string
  autoGenerate: boolean
}

interface KeywordResult {
  keyword: string
  relatedSearches: string[]
}

interface ResearchData {
  keywords: KeywordResult[]
  competitors: string[]
  hasSerpApi: boolean
  seeds: string[]
}

interface Props {
  clientId:   string
  clientName: string
  onComplete: () => void
}

const TOTAL_STEPS = 8

const FREQ_OPTIONS = [
  { id: 'daily',    label: 'Daily',       sub: '1 post/day' },
  { id: 'weekly',   label: 'Weekly',      sub: '1 post/week' },
  { id: 'biweekly', label: 'Bi-Weekly',   sub: 'Every 2 weeks' },
  { id: 'monthly',  label: 'Monthly',     sub: 'Once a month' },
]

const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

// ─── Wizard ───────────────────────────────────────────────────────────────────

export default function ClientContentSetupWizard({ clientId, clientName, onComplete }: Props) {
  const [step, setStep] = useState(1)

  // Step 1 state
  const [hasGsc, setHasGsc] = useState<boolean | null>(null)
  const [wpUrl,  setWpUrl]  = useState('')

  // Step 2 state
  const [analyzeUrl,    setAnalyzeUrl]    = useState('')
  const [analyzing,     setAnalyzing]     = useState(false)
  const [analyzeMsg,    setAnalyzeMsg]    = useState('')
  const [brand,         setBrand]         = useState<BrandDna>({
    business_background: '', services: '', target_audience: '',
    geographic_focus: '', brand_voice: '', years_in_business: '',
    phone_number: '', owner_details: '', licenses: '',
    guarantees: '', review_count: '', emergency_availability: false,
  })
  const [brandLoaded, setBrandLoaded] = useState(false)

  // Step 3 state — same brand object (e-e-a-t fields are in brand)

  // Step 4 state
  const [sitemapUrl,    setSitemapUrl]    = useState('')
  const [fetchingPages, setFetchingPages] = useState(false)
  const [sitemapMsg,    setSitemapMsg]    = useState('')
  const [pages,         setPages]         = useState<SitemapPage[]>([])

  // Step 5 state
  const [schedule, setSchedule] = useState<Schedule>({
    frequency: 'weekly', dayOfWeek: 1, publishTime: '09:00',
    autoGenerate: true,
  })

  // Step 6 state — additional content types
  const [enableServicePages,    setEnableServicePages]    = useState(false)
  const [spGuidelinesWiz,       setSpGuidelinesWiz]       = useState('')
  const [enableRegularPages,    setEnableRegularPages]    = useState(false)
  const [rpGuidelinesWiz,       setRpGuidelinesWiz]       = useState('')

  // Step 7 state
  const [research,       setResearch]       = useState<ResearchData | null>(null)
  const [researchDone,   setResearchDone]   = useState(false)

  // Saving state
  const [saving, setSaving]   = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  // ── Load initial data on mount ─────────────────────────────────────────────
  useEffect(() => {
    async function loadInit() {
      try {
        // Check for GSC connection
        const res = await fetch(`/api/admin/clients/${clientId}/connections`)
        if (res.ok) {
          const conns = await res.json() as Array<{ type: string }>
          setHasGsc(conns.some(c => c.type === 'google_search_console'))
        } else {
          setHasGsc(false)
        }
      } catch {
        setHasGsc(false)
      }

      // Try to pre-fill WordPress URL for sitemap and analyze steps
      try {
        const res = await fetch(`/api/admin/clients/${clientId}/connections`)
        if (res.ok) {
          const conns = await res.json() as Array<{ type: string; config?: { site_url?: string } }>
          const wp = conns.find(c => c.type === 'wordpress')
          if (wp?.config?.site_url) {
            setAnalyzeUrl(wp.config.site_url)
            setSitemapUrl(wp.config.site_url + '/sitemap.xml')
            setWpUrl(wp.config.site_url)
          }
        }
      } catch { /* ignore */ }

      // Pre-populate Step 6 from existing client settings (re-run support)
      try {
        const res = await fetch(`/api/admin/content/client-settings?client_id=${clientId}`)
        if (res.ok) {
          const cs = await res.json() as {
            generate_service_pages?: boolean
            generate_regular_pages?: boolean
            service_page_topic_guidelines?: string | null
            regular_page_topic_guidelines?: string | null
          }
          if (cs.generate_service_pages) setEnableServicePages(true)
          if (cs.generate_regular_pages) setEnableRegularPages(true)
          if (cs.service_page_topic_guidelines) setSpGuidelinesWiz(cs.service_page_topic_guidelines)
          if (cs.regular_page_topic_guidelines) setRpGuidelinesWiz(cs.regular_page_topic_guidelines)
        }
      } catch { /* ignore */ }
    }
    loadInit()
  }, [clientId])

  // ── Actions ────────────────────────────────────────────────────────────────

  async function handleAnalyze() {
    if (!analyzeUrl.trim()) return
    setAnalyzing(true)
    setAnalyzeMsg('Scanning website…')
    try {
      const res  = await fetch('/api/admin/content/generate-brand-dna', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, site_url: analyzeUrl }),
      })
      const data = await res.json() as Partial<BrandDna> & { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Analysis failed')
      setBrand(prev => ({
        ...prev,
        business_background: data.business_background ?? prev.business_background,
        services:            data.services            ?? prev.services,
        target_audience:     data.target_audience     ?? prev.target_audience,
        geographic_focus:    data.geographic_focus    ?? prev.geographic_focus,
        brand_voice:         data.brand_voice         ?? prev.brand_voice,
        years_in_business:   (data as Record<string, unknown>).years_in_business as string ?? prev.years_in_business,
        phone_number:        (data as Record<string, unknown>).phone_number as string ?? prev.phone_number,
        owner_details:       (data as Record<string, unknown>).owner_details as string ?? prev.owner_details,
        licenses:            (data as Record<string, unknown>).licenses as string ?? prev.licenses,
        guarantees:          (data as Record<string, unknown>).guarantees as string ?? prev.guarantees,
        review_count:        (data as Record<string, unknown>).review_count as string ?? prev.review_count,
        emergency_availability: (data as Record<string, unknown>).emergency_availability as boolean ?? prev.emergency_availability,
      }))
      setBrandLoaded(true)
      setAnalyzeMsg('')
    } catch (err) {
      setAnalyzeMsg(err instanceof Error ? err.message : 'Analysis failed')
      setBrandLoaded(false)
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleFetchPages() {
    setFetchingPages(true)
    setSitemapMsg('Fetching sitemap…')
    setPages([])
    try {
      // Save sitemap URL first so the parse endpoint can use it
      await fetch('/api/admin/content/client-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, sitemap_url: sitemapUrl }),
      })

      const res  = await fetch(`/api/admin/content/sitemap-parse?client_id=${clientId}`, { method: 'POST' })
      const data = await res.json() as SitemapPage[] | { error?: string }
      if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to fetch sitemap')
      const list = data as SitemapPage[]
      setPages(list)
      setSitemapMsg(`Found ${list.length} page${list.length !== 1 ? 's' : ''}`)
    } catch (err) {
      setSitemapMsg(err instanceof Error ? err.message : 'Failed')
    } finally {
      setFetchingPages(false)
    }
  }

  const loadResearch = useCallback(async () => {
    if (researchDone) return
    try {
      // Pass in-memory brand data so the API can use it even if not yet saved to DB
      const params = new URLSearchParams({ client_id: clientId })
      if (brand.services)        params.set('services', brand.services)
      if (brand.geographic_focus) params.set('geo',     brand.geographic_focus)
      const res  = await fetch(`/api/admin/content/keyword-research?${params.toString()}`)
      const data = await res.json() as ResearchData
      setResearch(data)
    } catch {
      setResearch({ keywords: [], competitors: [], hasSerpApi: false, seeds: [] })
    } finally {
      setResearchDone(true)
    }
  }, [clientId, researchDone, brand.services, brand.geographic_focus])

  useEffect(() => {
    if (step === 6) loadResearch()
  }, [step, loadResearch])

  async function saveSettings(wizardCompleted: boolean) {
    const eeatData = {
      years_in_business:      brand.years_in_business,
      phone_number:           brand.phone_number,
      owner_details:          brand.owner_details,
      licenses:               brand.licenses,
      guarantees:             brand.guarantees,
      review_count:           brand.review_count,
      emergency_availability: brand.emergency_availability,
    }

    const res = await fetch('/api/admin/content/client-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:            clientId,
        business_background:  brand.business_background,
        services:             brand.services,
        target_audience:      brand.target_audience,
        geographic_focus:     brand.geographic_focus,
        brand_voice:          brand.brand_voice,
        phone_number:         brand.phone_number,
        sitemap_url:          sitemapUrl || undefined,
        schedule_frequency:   schedule.frequency,
        schedule_day_of_week: schedule.dayOfWeek,
        schedule_start_date:  new Date().toISOString().slice(0, 10),
        publish_time:         schedule.publishTime,
        topics_per_run:  1,
        auto_generate:   schedule.autoGenerate,
        generate_service_pages:         enableServicePages,
        service_page_topic_guidelines:  spGuidelinesWiz || null,
        generate_regular_pages:         enableRegularPages,
        regular_page_topic_guidelines:  rpGuidelinesWiz || null,
        eeat_data:                      eeatData,
        wizard_completed:               wizardCompleted,
      }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(data.error ?? 'Failed to save settings')
    }
  }

  async function handleSave() {
    setSaving(true)
    setSaveMsg('')
    try {
      await saveSettings(true)
      onComplete()
    } catch {
      setSaveMsg('Save failed — please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveAndGenerate() {
    setSaving(true)
    setSaveMsg('')
    try {
      await saveSettings(true)
      // Use calendar/generate to spread topics across scheduled publish slots with proper dates
      const res = await fetch('/api/admin/content/calendar/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id:  clientId,
          start_date: new Date().toISOString().slice(0, 10),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? 'Generation failed')
      }
      onComplete()
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : 'Save failed — please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleSkip = useCallback(async () => {
    await fetch('/api/admin/content/client-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, wizard_completed: true }),
    }).catch(() => {})
    onComplete()
  }, [clientId, onComplete])

  // ── ESC to close ──────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleSkip() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleSkip])

  function next() { setStep(s => Math.min(s + 1, TOTAL_STEPS)) }
  function back() { setStep(s => Math.max(s - 1, 1)) }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 2000, padding: '1rem',
      }}
    >
      <div style={{
        background: 'var(--bg-surface)',
        borderRadius: 16,
        maxWidth: 680,
        width: '100%',
        maxHeight: '92vh',
        overflowY: 'auto',
        boxShadow: '0 32px 100px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem 0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <StepDots current={step} total={TOTAL_STEPS} />
          <button
            onClick={handleSkip}
            style={{ background: 'none', border: 'none', fontSize: '0.75rem', color: 'var(--text-faint)', cursor: 'pointer', padding: '4px 8px', borderRadius: 4 }}
          >
            Skip Setup
          </button>
        </div>

        {/* Step body */}
        <div style={{ padding: '1.5rem', flex: 1 }}>
          {step === 1 && <StepWelcome clientName={clientName} hasGsc={hasGsc} wpUrl={wpUrl} />}
          {step === 2 && (
            <StepBrandAnalysis
              analyzeUrl={analyzeUrl}
              setAnalyzeUrl={setAnalyzeUrl}
              onAnalyze={handleAnalyze}
              analyzing={analyzing}
              analyzeMsg={analyzeMsg}
              brand={brand}
              setBrand={setBrand}
              brandLoaded={brandLoaded}
            />
          )}
          {step === 3 && <StepEeat brand={brand} setBrand={setBrand} />}
          {step === 4 && (
            <StepSitemap
              sitemapUrl={sitemapUrl}
              setSitemapUrl={setSitemapUrl}
              onFetch={handleFetchPages}
              fetching={fetchingPages}
              fetchMsg={sitemapMsg}
              pages={pages}
              setPages={setPages}
            />
          )}
          {step === 5 && <StepSchedule schedule={schedule} setSchedule={setSchedule} />}
          {step === 6 && (
            <StepContentTypes
              enableServicePages={enableServicePages}
              setEnableServicePages={setEnableServicePages}
              spGuidelines={spGuidelinesWiz}
              setSpGuidelines={setSpGuidelinesWiz}
              enableRegularPages={enableRegularPages}
              setEnableRegularPages={setEnableRegularPages}
              rpGuidelines={rpGuidelinesWiz}
              setRpGuidelines={setRpGuidelinesWiz}
            />
          )}
          {step === 7 && <StepResearch research={research} done={researchDone} />}
          {step === 8 && (
            <StepReady
              clientName={clientName}
              brand={brand}
              schedule={schedule}
              pagesCount={pages.length}
              hasGsc={hasGsc ?? false}
              hasSerpApi={research?.hasSerpApi ?? false}
              saving={saving}
              saveMsg={saveMsg}
              onSave={handleSave}
              onSaveAndGenerate={handleSaveAndGenerate}
            />
          )}
        </div>

        {/* Footer nav */}
        {step < 8 && (
          <div style={{
            padding: '1rem 1.5rem 1.25rem',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            borderTop: '1px solid var(--border)',
          }}>
            <button
              onClick={back}
              disabled={step === 1}
              className="btn btn-secondary"
              style={{ fontSize: '0.875rem', opacity: step === 1 ? 0.3 : 1 }}
            >
              ← Back
            </button>
            <button
              onClick={next}
              className="btn btn-primary"
              style={{ fontSize: '0.875rem' }}
            >
              {step === 6 ? 'Skip →' : 'Continue →'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          style={{
            width: i + 1 === current ? 20 : 8,
            height: 8,
            borderRadius: 4,
            background: i + 1 <= current ? 'var(--blue)' : 'var(--border)',
            transition: 'all 0.25s ease',
          }}
        />
      ))}
      <span style={{ fontSize: '0.6875rem', color: 'var(--text-faint)', marginLeft: 8 }}>
        Step {current} of {total}
      </span>
    </div>
  )
}

function StepTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ margin: '0 0 0.375rem', fontSize: '1.375rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.25 }}>
      {children}
    </h2>
  )
}

function StepSub({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: '0 0 1.5rem', fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
      {children}
    </p>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
        {label}
      </label>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '0.5rem 0.625rem', borderRadius: 6,
  border: '1px solid var(--border)', fontSize: '0.875rem',
  background: 'var(--bg-surface)', color: 'var(--text-primary)',
  boxSizing: 'border-box',
}

const taStyle: React.CSSProperties = {
  ...inputStyle, minHeight: 80, resize: 'vertical' as const, fontFamily: 'inherit',
}

// ─── Step 1: Welcome ──────────────────────────────────────────────────────────

function StepWelcome({ clientName, hasGsc, wpUrl }: { clientName: string; hasGsc: boolean | null; wpUrl: string }) {
  return (
    <div>
      <StepTitle>Let&apos;s set up content for {clientName}</StepTitle>
      <StepSub>This wizard guides you through configuring the AI content pipeline. It only takes a few minutes.</StepSub>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { icon: '🗓', title: 'Set a Schedule', body: 'Choose how often posts should publish and configure automation.' },
          { icon: '🔍', title: 'Research Topics', body: 'AI will find the best keyword opportunities based on GSC and competitor data.' },
          { icon: '✍', title: 'Generate Posts', body: 'Full-length, SEO-optimised posts written with the client\'s brand voice.' },
        ].map(c => (
          <div key={c.title} style={{ padding: '1rem', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-subtle)' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: 6 }}>{c.icon}</div>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: 4, color: 'var(--text-primary)' }}>{c.title}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>{c.body}</div>
          </div>
        ))}
      </div>

      {hasGsc === false && (
        <div style={{ padding: '0.875rem 1rem', borderRadius: 8, background: '#fef3c7', border: '1px solid #fde68a', marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: '0.8125rem', color: '#92400e', marginBottom: 3 }}>Google Search Console not connected</div>
          <div style={{ fontSize: '0.75rem', color: '#92400e', lineHeight: 1.5 }}>
            Topic suggestions will be less precise without real keyword data. Connect GSC in Data Connections for best results.
          </div>
        </div>
      )}

      {wpUrl && (
        <div style={{ padding: '0.875rem 1rem', borderRadius: 8, background: '#f0fdf4', border: '1px solid #86efac', marginBottom: 8 }}>
          <div style={{ fontWeight: 600, fontSize: '0.8125rem', color: '#166534', marginBottom: 2 }}>WordPress connected</div>
          <div style={{ fontSize: '0.75rem', color: '#166534' }}>{wpUrl}</div>
        </div>
      )}
    </div>
  )
}

// ─── Step 2: Brand Analysis ───────────────────────────────────────────────────

function StepBrandAnalysis({ analyzeUrl, setAnalyzeUrl, onAnalyze, analyzing, analyzeMsg, brand, setBrand, brandLoaded }: {
  analyzeUrl: string
  setAnalyzeUrl: (v: string) => void
  onAnalyze: () => void
  analyzing: boolean
  analyzeMsg: string
  brand: BrandDna
  setBrand: (b: BrandDna) => void
  brandLoaded: boolean
}) {
  return (
    <div>
      <StepTitle>Analyze this business</StepTitle>
      <StepSub>Enter the website URL and we&apos;ll extract brand information automatically. You can edit everything after.</StepSub>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          type="url"
          value={analyzeUrl}
          onChange={e => setAnalyzeUrl(e.target.value)}
          placeholder="https://example.com"
          style={{ ...inputStyle, flex: 1 }}
        />
        <button
          onClick={onAnalyze}
          disabled={analyzing || !analyzeUrl.trim()}
          className="btn btn-primary"
          style={{ fontSize: '0.875rem', whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          {analyzing ? 'Analyzing…' : 'Analyze Website'}
        </button>
      </div>

      {analyzeMsg && (
        <p style={{ fontSize: '0.8125rem', color: analyzeMsg.includes('ailed') ? 'var(--red)' : 'var(--text-muted)', marginBottom: 12 }}>
          {analyzeMsg}
        </p>
      )}

      {(brandLoaded || brand.business_background) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <Field label="Business Background">
            <textarea value={brand.business_background} onChange={e => setBrand({ ...brand, business_background: e.target.value })} style={taStyle} />
          </Field>
          <Field label="Services">
            <input type="text" value={brand.services} onChange={e => setBrand({ ...brand, services: e.target.value })} style={inputStyle} placeholder="Plumbing, HVAC, Electrical" />
          </Field>
          <Field label="Target Audience">
            <input type="text" value={brand.target_audience} onChange={e => setBrand({ ...brand, target_audience: e.target.value })} style={inputStyle} />
          </Field>
          <Field label="Geographic Focus">
            <input type="text" value={brand.geographic_focus} onChange={e => setBrand({ ...brand, geographic_focus: e.target.value })} style={inputStyle} placeholder="Austin, TX" />
          </Field>
          <Field label="Brand Voice">
            <input type="text" value={brand.brand_voice} onChange={e => setBrand({ ...brand, brand_voice: e.target.value })} style={inputStyle} placeholder="Professional, approachable, trustworthy" />
          </Field>
        </div>
      )}

      {!brandLoaded && !brand.business_background && (
        <div style={{ padding: '2rem', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 10, color: 'var(--text-faint)', fontSize: '0.875rem' }}>
          Enter a website URL above and click &quot;Analyze Website&quot; to auto-fill brand info, or continue to fill it in manually.
        </div>
      )}
    </div>
  )
}

// ─── Step 3: E-E-A-T Signals ─────────────────────────────────────────────────

function StepEeat({ brand, setBrand }: { brand: BrandDna; setBrand: (b: BrandDna) => void }) {
  return (
    <div>
      <StepTitle>Trust &amp; credibility signals</StepTitle>
      <StepSub>These help the AI write with real authority. E-E-A-T signals significantly improve content quality and rankings for local businesses.</StepSub>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
        <Field label="Years in Business">
          <input type="text" value={brand.years_in_business} onChange={e => setBrand({ ...brand, years_in_business: e.target.value })} style={inputStyle} placeholder="15" />
        </Field>
        <Field label="Phone Number">
          <input type="text" value={brand.phone_number} onChange={e => setBrand({ ...brand, phone_number: e.target.value })} style={inputStyle} placeholder="(555) 123-4567" />
        </Field>
        <Field label="Number of Reviews">
          <input type="text" value={brand.review_count} onChange={e => setBrand({ ...brand, review_count: e.target.value })} style={inputStyle} placeholder="200+ Google reviews" />
        </Field>
        <Field label="Owner / Operator Name">
          <input type="text" value={brand.owner_details} onChange={e => setBrand({ ...brand, owner_details: e.target.value })} style={inputStyle} placeholder="John Smith" />
        </Field>
        <Field label="Licenses / Certifications">
          <input type="text" value={brand.licenses} onChange={e => setBrand({ ...brand, licenses: e.target.value })} style={inputStyle} placeholder="Licensed, Bonded, Insured" />
        </Field>
        <Field label="Guarantees / Warranties">
          <input type="text" value={brand.guarantees} onChange={e => setBrand({ ...brand, guarantees: e.target.value })} style={inputStyle} placeholder="100% satisfaction guarantee" />
        </Field>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, padding: '0.75rem 1rem', borderRadius: 8, background: 'var(--bg-subtle)', border: '1px solid var(--border)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flex: 1 }}>
          <input
            type="checkbox"
            checked={brand.emergency_availability}
            onChange={e => setBrand({ ...brand, emergency_availability: e.target.checked })}
            style={{ width: 16, height: 16 }}
          />
          <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)' }}>24/7 Emergency availability</span>
        </label>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>Boosts local search intent matching</span>
      </div>
    </div>
  )
}

// ─── Step 4: Sitemap ──────────────────────────────────────────────────────────

function StepSitemap({ sitemapUrl, setSitemapUrl, onFetch, fetching, fetchMsg, pages, setPages }: {
  sitemapUrl: string
  setSitemapUrl: (v: string) => void
  onFetch: () => void
  fetching: boolean
  fetchMsg: string
  pages: SitemapPage[]
  setPages: (p: SitemapPage[]) => void
}) {
  function togglePriority(idx: number) {
    setPages(pages.map((p, i) => i === idx ? { ...p, isPriority: !p.isPriority } : p))
  }
  function toggleExclude(idx: number) {
    setPages(pages.map((p, i) => i === idx ? { ...p, isExcluded: !p.isExcluded } : p))
  }
  function markServicePages() {
    setPages(pages.map(p => ({ ...p, isPriority: p.url.includes('/service') || p.isPriority })))
  }

  return (
    <div>
      <StepTitle>Import your sitemap</StepTitle>
      <StepSub>We&apos;ll crawl the sitemap to find internal link targets. Mark important pages as Priority to guide topic selection.</StepSub>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          type="url"
          value={sitemapUrl}
          onChange={e => setSitemapUrl(e.target.value)}
          placeholder="https://example.com/sitemap.xml"
          style={{ ...inputStyle, flex: 1 }}
        />
        <button
          onClick={onFetch}
          disabled={fetching || !sitemapUrl.trim()}
          className="btn btn-primary"
          style={{ fontSize: '0.875rem', whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          {fetching ? 'Fetching…' : 'Fetch Pages'}
        </button>
      </div>

      {fetchMsg && (
        <p style={{ fontSize: '0.8125rem', color: fetchMsg.includes('ailed') ? 'var(--red)' : 'var(--text-muted)', marginBottom: 10 }}>
          {fetchMsg}
        </p>
      )}

      {pages.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <button onClick={markServicePages} className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '3px 10px' }}>
              Mark /service pages as Priority
            </button>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>
              {pages.filter(p => p.isPriority).length} priority · {pages.filter(p => p.isExcluded).length} excluded
            </span>
          </div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', maxHeight: 260, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg-subtle)', position: 'sticky', top: 0 }}>
                  <th style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--text-faint)', fontWeight: 600 }}>URL</th>
                  <th style={{ padding: '6px 8px', textAlign: 'center', color: 'var(--text-faint)', fontWeight: 600, width: 70 }}>Priority</th>
                  <th style={{ padding: '6px 8px', textAlign: 'center', color: 'var(--text-faint)', fontWeight: 600, width: 70 }}>Exclude</th>
                </tr>
              </thead>
              <tbody>
                {pages.slice(0, 200).map((p, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '5px 10px', color: 'var(--text-muted)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', maxWidth: 400 }}>
                      {p.title || p.url.split('/').filter(Boolean).pop() || p.url}
                      <span style={{ color: 'var(--text-faint)', display: 'block', fontSize: '0.6875rem' }}>{p.url}</span>
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                      <input type="checkbox" checked={p.isPriority} onChange={() => togglePriority(i)} />
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                      <input type="checkbox" checked={p.isExcluded} onChange={() => toggleExclude(i)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages.length > 200 && (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)', marginTop: 4 }}>Showing first 200 of {pages.length} pages.</p>
          )}
        </>
      )}

      {pages.length === 0 && !fetching && (
        <div style={{ padding: '1.5rem', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 10, color: 'var(--text-faint)', fontSize: '0.875rem' }}>
          Enter a sitemap URL above and click &quot;Fetch Pages&quot;, or skip this step.
        </div>
      )}
    </div>
  )
}

// ─── Step 5: Schedule ─────────────────────────────────────────────────────────

function StepSchedule({ schedule, setSchedule }: { schedule: Schedule; setSchedule: (s: Schedule) => void }) {
  const needsDay = ['weekly', 'biweekly'].includes(schedule.frequency)

  return (
    <div>
      <StepTitle>Publishing schedule</StepTitle>
      <StepSub>How often should this client&apos;s posts be published? You can change this later in the Schedule tab.</StepSub>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 20 }}>
        {FREQ_OPTIONS.map(opt => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setSchedule({ ...schedule, frequency: opt.id })}
            style={{
              padding: '1rem',
              borderRadius: 10,
              border: `2px solid ${schedule.frequency === opt.id ? 'var(--blue)' : 'var(--border)'}`,
              background: schedule.frequency === opt.id ? '#eff6ff' : 'var(--bg-surface)',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: '0.9375rem', color: schedule.frequency === opt.id ? 'var(--blue)' : 'var(--text-primary)' }}>{opt.label}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)', marginTop: 2 }}>{opt.sub}</div>
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
        {needsDay && (
          <Field label="Day of Week">
            <select value={schedule.dayOfWeek} onChange={e => setSchedule({ ...schedule, dayOfWeek: Number(e.target.value) })} style={inputStyle}>
              {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </Field>
        )}
        <Field label="Publish Time">
          <input type="time" value={schedule.publishTime} onChange={e => setSchedule({ ...schedule, publishTime: e.target.value })} style={inputStyle} />
        </Field>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
        {([
          { key: 'autoGenerate', label: 'Auto-generate posts', sub: 'Automatically generate posts from approved topics' },
        ] as const).map(t => (
          <label key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.625rem 0.875rem', borderRadius: 8, background: 'var(--bg-subtle)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={schedule[t.key]}
              onChange={e => setSchedule({ ...schedule, [t.key]: e.target.checked })}
              style={{ width: 15, height: 15 }}
            />
            <div>
              <div style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)' }}>{t.label}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>{t.sub}</div>
            </div>
          </label>
        ))}
      </div>
    </div>
  )
}

// ─── Step 6: Additional Content Types ─────────────────────────────────────────

function StepContentTypes({
  enableServicePages, setEnableServicePages, spGuidelines, setSpGuidelines,
  enableRegularPages, setEnableRegularPages, rpGuidelines, setRpGuidelines,
}: {
  enableServicePages: boolean; setEnableServicePages: (v: boolean) => void
  spGuidelines: string; setSpGuidelines: (v: string) => void
  enableRegularPages: boolean; setEnableRegularPages: (v: boolean) => void
  rpGuidelines: string; setRpGuidelines: (v: string) => void
}) {
  return (
    <div>
      <StepTitle>Additional Content Types</StepTitle>
      <StepSub>
        Optionally enable AI-generated Service Pages and Regular Pages alongside your blog posts.
        You can also configure these later from the Content Schedule tab.
      </StepSub>

      {/* Service Pages */}
      <div className="card p-4" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <input
            type="checkbox"
            id="wiz-sp"
            checked={enableServicePages}
            onChange={e => setEnableServicePages(e.target.checked)}
            style={{ width: 18, height: 18, marginTop: 2, cursor: 'pointer', flexShrink: 0 }}
          />
          <label htmlFor="wiz-sp" style={{ cursor: 'pointer', flex: 1 }}>
            <p style={{ fontWeight: 600, fontSize: '0.9375rem', marginBottom: '0.2rem' }}>Service Pages</p>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: enableServicePages ? '0.75rem' : 0 }}>
              AI-generated landing pages targeting each of your services. Great for service-based businesses that want dedicated pages per offering.
            </p>
          </label>
        </div>
        {enableServicePages && (
          <textarea
            className="input"
            rows={3}
            placeholder="Topic guidelines for service pages (optional) — e.g. 'Focus on local intent, include pricing ranges…'"
            value={spGuidelines}
            onChange={e => setSpGuidelines(e.target.value)}
            style={{ width: '100%', resize: 'vertical', fontSize: '0.8125rem', marginTop: 8 }}
          />
        )}
      </div>

      {/* Regular Pages */}
      <div className="card p-4">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <input
            type="checkbox"
            id="wiz-rp"
            checked={enableRegularPages}
            onChange={e => setEnableRegularPages(e.target.checked)}
            style={{ width: 18, height: 18, marginTop: 2, cursor: 'pointer', flexShrink: 0 }}
          />
          <label htmlFor="wiz-rp" style={{ cursor: 'pointer', flex: 1 }}>
            <p style={{ fontWeight: 600, fontSize: '0.9375rem', marginBottom: '0.2rem' }}>Regular Pages</p>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: enableRegularPages ? '0.75rem' : 0 }}>
              Evergreen pages like About Us, FAQ, Resources, and more. Ideal for filling out a site&apos;s content architecture.
            </p>
          </label>
        </div>
        {enableRegularPages && (
          <textarea
            className="input"
            rows={3}
            placeholder="Topic guidelines for regular pages (optional) — e.g. 'Keep a professional tone, avoid technical jargon…'"
            value={rpGuidelines}
            onChange={e => setRpGuidelines(e.target.value)}
            style={{ width: '100%', resize: 'vertical', fontSize: '0.8125rem', marginTop: 8 }}
          />
        )}
      </div>

      <p style={{ marginTop: 16, fontSize: '0.75rem', color: 'var(--text-faint)' }}>
        You can skip this step — additional content types can be enabled at any time from the Content Schedule tab.
      </p>
    </div>
  )
}

// ─── Step 7: Research ─────────────────────────────────────────────────────────

function StepResearch({ research, done }: { research: ResearchData | null; done: boolean }) {
  return (
    <div>
      <StepTitle>Researching your market</StepTitle>
      <StepSub>We&apos;re looking up keyword opportunities and competitor content for this client. This runs in the background.</StepSub>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        {/* Keywords panel */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '0.75rem 1rem', background: 'var(--bg-subtle)', fontWeight: 600, fontSize: '0.8125rem', color: 'var(--text-primary)' }}>
            Keyword Research
          </div>
          <div style={{ padding: '0.875rem 1rem' }}>
            {!done ? (
              <StatusRow label="Searching keywords…" status="loading" />
            ) : !research?.hasSerpApi ? (
              <div style={{ fontSize: '0.75rem', color: '#92400e', background: '#fef3c7', padding: '0.625rem', borderRadius: 6, lineHeight: 1.5 }}>
                Add a SerpAPI key in Agency Settings for richer keyword research.
              </div>
            ) : research.keywords.length === 0 ? (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>No keyword data found.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {research.keywords.map((kw, i) => (
                  <div key={i}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>{kw.keyword}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {kw.relatedSearches.slice(0, 4).map((q, j) => (
                        <span key={j} style={{ fontSize: '0.6875rem', padding: '1px 6px', borderRadius: 999, background: '#eff6ff', color: '#1d4ed8' }}>{q}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Competitors panel */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '0.75rem 1rem', background: 'var(--bg-subtle)', fontWeight: 600, fontSize: '0.8125rem', color: 'var(--text-primary)' }}>
            Competitor Analysis
          </div>
          <div style={{ padding: '0.875rem 1rem' }}>
            {!done ? (
              <StatusRow label="Finding competitors…" status="loading" />
            ) : (research?.competitors ?? []).length === 0 ? (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>
                {research?.hasSerpApi ? 'No competitors found for these keywords.' : 'Connect SerpAPI to enable competitor analysis.'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {research!.competitors.map((c, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b82f6', flexShrink: 0 }} />
                    <span style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', fontFamily: 'monospace' }}>{c}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {done && (
        <div style={{ padding: '0.75rem 1rem', borderRadius: 8, background: '#f0fdf4', border: '1px solid #86efac', fontSize: '0.8125rem', color: '#166534' }}>
          Research complete. This data will improve topic relevance when generating.
        </div>
      )}
    </div>
  )
}

function StatusRow({ label, status }: { label: string; status: 'loading' | 'done' | 'error' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
      {status === 'loading' && <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>}
      {status === 'done'    && <span style={{ color: '#16a34a' }}>✓</span>}
      {status === 'error'   && <span style={{ color: '#dc2626' }}>✗</span>}
      {label}
    </div>
  )
}

// ─── Step 8: Ready ────────────────────────────────────────────────────────────

function StepReady({ clientName, brand, schedule, pagesCount, hasGsc, hasSerpApi, saving, saveMsg, onSave, onSaveAndGenerate }: {
  clientName: string
  brand: BrandDna
  schedule: Schedule
  pagesCount: number
  hasGsc: boolean
  hasSerpApi: boolean
  saving: boolean
  saveMsg: string
  onSave: () => void
  onSaveAndGenerate: () => void
}) {
  const freqLabel = FREQ_OPTIONS.find(f => f.id === schedule.frequency)?.label ?? schedule.frequency

  const summaryRows = [
    { label: 'Frequency',     value: freqLabel },
    { label: 'Publish time',  value: schedule.publishTime },
    { label: 'Sitemap pages', value: pagesCount > 0 ? String(pagesCount) : '—' },
  ]

  const statusChecks = [
    { label: 'Brand DNA',     ok: !!brand.business_background },
    { label: 'GSC Connected', ok: hasGsc },
    { label: 'SerpAPI',       ok: hasSerpApi },
    { label: 'Sitemap',       ok: pagesCount > 0 },
  ]

  return (
    <div>
      <StepTitle>Setup complete!</StepTitle>
      <StepSub>{clientName} is ready for AI content generation.</StepSub>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '1rem' }}>
          <div style={{ fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', marginBottom: 10 }}>Schedule Summary</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {summaryRows.map(r => (
              <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>{r.label}</span>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '1rem' }}>
          <div style={{ fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', marginBottom: 10 }}>Data Sources</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {statusChecks.map(c => (
              <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem' }}>
                <span style={{ width: 18, height: 18, borderRadius: '50%', background: c.ok ? '#dcfce7' : '#f3f4f6', color: c.ok ? '#16a34a' : '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.625rem', flexShrink: 0, fontWeight: 700 }}>
                  {c.ok ? '✓' : '—'}
                </span>
                <span style={{ color: c.ok ? 'var(--text-primary)' : 'var(--text-faint)' }}>{c.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {saveMsg && (
        <p style={{ fontSize: '0.8125rem', color: 'var(--red)', marginBottom: 12 }}>{saveMsg}</p>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={onSave}
          disabled={saving}
          className="btn btn-secondary"
          style={{ fontSize: '0.875rem', flex: 1 }}
        >
          {saving ? 'Saving…' : 'Save Setup'}
        </button>
        <button
          onClick={onSaveAndGenerate}
          disabled={saving}
          className="btn btn-primary"
          style={{ fontSize: '0.875rem', flex: 2 }}
        >
          {saving ? 'Saving…' : 'Save & Generate First Topics'}
        </button>
      </div>
    </div>
  )
}
