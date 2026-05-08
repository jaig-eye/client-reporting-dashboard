'use client'

import { useState, useEffect } from 'react'
import type { EeatData }       from '@/lib/content/types'

interface SiteOption {
  connectionId: string
  siteUrl:      string
  siteName:     string
  clientId:     string
}

interface ManualLink {
  url:   string
  label: string
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

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
      {children}
      {hint && <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}> — {hint}</span>}
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
}: {
  clientId: string
  sites:    SiteOption[]
}) {
  const [form,        setForm]        = useState<BrandDnaForm>({ business_background: '', services: '', target_audience: '', geographic_focus: '', brand_voice: '', phone_number: '', cta_list: '' })
  const [eeat,        setEeat]        = useState<EeatData>(EMPTY_EEAT)
  const [sitemapUrls, setSitemapUrls] = useState<string[]>([])
  const [manualLinks, setManualLinks] = useState<ManualLink[]>([])
  const [saving,      setSaving]      = useState(false)
  const [saved,       setSaved]       = useState(false)
  const [error,       setError]       = useState('')
  const [loading,     setLoading]     = useState(true)
  const [aiLoading,   setAiLoading]   = useState(false)
  const [aiError,     setAiError]     = useState('')
  const [aiSuggested, setAiSuggested] = useState(false)
  const [siteUrlInput, setSiteUrlInput] = useState('')
  const [showSiteInput, setShowSiteInput] = useState(false)

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
        if (d.eeat_data && typeof d.eeat_data === 'object') {
          setEeat({ ...EMPTY_EEAT, ...(d.eeat_data as Partial<EeatData>) })
        }
        const urls: string[] = Array.isArray(d.sitemap_urls) && (d.sitemap_urls as string[]).length > 0
          ? d.sitemap_urls as string[]
          : (d.sitemap_url ? [String(d.sitemap_url)] : [])
        setSitemapUrls(urls)
        const links: ManualLink[] = ((d.manual_link_urls ?? []) as string[]).map(s => {
          try { const p = JSON.parse(s); if (p?.url) return { url: String(p.url), label: String(p.label ?? '') } } catch { /* skip */ }
          if (typeof s === 'string' && s.startsWith('http')) return { url: s, label: '' }
          return null
        }).filter(Boolean) as ManualLink[]
        setManualLinks(links)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [clientId])

  function setField<K extends keyof BrandDnaForm>(key: K, val: string) {
    setForm(p => ({ ...p, [key]: val }))
  }
  function setEeatField<K extends keyof EeatData>(key: K, val: EeatData[K]) {
    setEeat(p => ({ ...p, [key]: val }))
  }

  function addSitemap()                            { setSitemapUrls(p => [...p, '']) }
  function updateSitemap(i: number, val: string)   { setSitemapUrls(p => p.map((u, idx) => idx === i ? val : u)) }
  function removeSitemap(i: number)                { setSitemapUrls(p => p.filter((_, idx) => idx !== i)) }
  function addManualLink()                         { setManualLinks(p => [...p, { url: '', label: '' }]) }
  function updateManualLink(i: number, field: 'url' | 'label', val: string) {
    setManualLinks(p => p.map((l, idx) => idx === i ? { ...l, [field]: val } : l))
  }
  function removeManualLink(i: number)             { setManualLinks(p => p.filter((_, idx) => idx !== i)) }

  async function autoFill(siteUrl?: string) {
    setAiLoading(true); setAiError(''); setAiSuggested(false)
    const res = await fetch('/api/admin/content/generate-brand-dna', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, ...(siteUrl ? { site_url: siteUrl } : {}) }),
    })
    setAiLoading(false)
    if (res.status === 422) {
      setShowSiteInput(true)
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
    }
    setForm(prev => ({
      ...prev,
      business_background: d.business_background || prev.business_background,
      services:            d.services            || prev.services,
      target_audience:     d.target_audience     || prev.target_audience,
      geographic_focus:    d.geographic_focus    || prev.geographic_focus,
      brand_voice:         d.brand_voice         || prev.brand_voice,
    }))
    // Merge any E-E-A-T signals the AI found — only overwrite non-empty values
    const EEAT_KEYS: (keyof EeatData)[] = [
      'years_in_business','review_count','licenses','insurance','awards',
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
    if (Object.keys(eeatUpdate).length > 0) setEeat(prev => ({ ...prev, ...eeatUpdate }))
    setAiSuggested(true)
    setShowSiteInput(false)
  }

  async function save() {
    setSaving(true); setError(''); setSaved(false)
    const res = await fetch('/api/admin/content/client-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        ...form,
        eeat_data:        eeat,
        sitemap_urls:     sitemapUrls.filter(u => u.trim()),
        manual_link_urls: manualLinks.filter(l => l.url.trim()).map(l => JSON.stringify({ url: l.url.trim(), label: l.label.trim() })),
      }),
    })
    setSaving(false)
    if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
    else { const d = await res.json(); setError(d.error || 'Failed to save') }
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

        {/* Site URL input — shown when no WordPress connection found */}
        {showSiteInput && (
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
              onClick={() => setShowSiteInput(false)}
            >✕</button>
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
            <Label hint="comma-separated">Services Offered</Label>
            <textarea className="input" rows={2} style={{ width: '100%' }} value={form.services} onChange={e => setField('services', e.target.value)} />
          </div>
          <div>
            <Label>Target Audience</Label>
            <input className="input" style={{ width: '100%' }} value={form.target_audience} onChange={e => setField('target_audience', e.target.value)} />
          </div>
          <div>
            <Label>Geographic Focus</Label>
            <input className="input" style={{ width: '100%' }} value={form.geographic_focus} onChange={e => setField('geographic_focus', e.target.value)} />
          </div>
          <div>
            <Label>Brand Voice</Label>
            <input className="input" style={{ width: '100%' }} value={form.brand_voice} onChange={e => setField('brand_voice', e.target.value)} />
          </div>
        </div>

        <div>
          <Label hint="used when referencing phone in content">Phone Number</Label>
          <input className="input" type="tel" style={{ width: '50%' }} value={form.phone_number} onChange={e => setField('phone_number', e.target.value)} placeholder="(321) 555-5555" />
        </div>

        <div>
          <Label hint="one per line — AI picks the most relevant for each post">Call-to-Action Options</Label>
          <textarea
            className="input"
            rows={3}
            style={{ width: '100%' }}
            value={form.cta_list}
            onChange={e => setField('cta_list', e.target.value)}
            placeholder={`e.g.\nCall us at (321) 555-5555 for a free quote.\nBook online at https://example.com/book`}
          />
          <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
            The AI maps each CTA to the post&rsquo;s funnel stage and intent automatically.
          </p>
        </div>
      </div>

      {/* ── Sitemaps & Internal Links ─────────────────────────────────────── */}
      <div className="card p-6 space-y-4">
        <h3 className="section-title">Sitemaps &amp; Internal Links</h3>
        <p className="section-desc">
          Sitemaps give the AI page context for internal linking. Always-include links are injected into every generated post.
        </p>

        <div>
          <Label hint="for internal link suggestions">Sitemap URLs</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {sitemapUrls.map((url, i) => (
              <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input className="input" type="url" style={{ flex: 1 }} value={url} onChange={e => updateSitemap(i, e.target.value)} placeholder="https://example.com/sitemap.xml" />
                <button type="button" onClick={() => removeSitemap(i)} style={{ flexShrink: 0, fontSize: '0.75rem', color: 'var(--text-faint)', padding: '0.25rem 0.5rem', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
              </div>
            ))}
            <button type="button" onClick={addSitemap} className="btn btn-secondary" style={{ alignSelf: 'flex-start', fontSize: '0.75rem', padding: '0.3rem 0.75rem' }}>+ Add Sitemap</button>
          </div>
        </div>

        <div>
          <Label hint="included as internal links in every generated post">Always-Include Links</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {manualLinks.map((link, i) => (
              <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input className="input" type="url" style={{ flex: 2 }} value={link.url} onChange={e => updateManualLink(i, 'url', e.target.value)} placeholder="https://example.com/services" />
                <input className="input" style={{ flex: 1 }} value={link.label} onChange={e => updateManualLink(i, 'label', e.target.value)} placeholder="Label" />
                <button type="button" onClick={() => removeManualLink(i)} style={{ flexShrink: 0, fontSize: '0.75rem', color: 'var(--text-faint)', padding: '0.25rem 0.5rem', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
              </div>
            ))}
            <button type="button" onClick={addManualLink} className="btn btn-secondary" style={{ alignSelf: 'flex-start', fontSize: '0.75rem', padding: '0.3rem 0.75rem' }}>+ Add Link</button>
          </div>
        </div>
      </div>

      {/* ── Trust & Credibility (E-E-A-T) ────────────────────────────────── */}
      <details className="card" style={{ overflow: 'hidden' }}>
        <summary className="p-6 cursor-pointer font-semibold text-sm flex items-center justify-between" style={{ color: 'var(--text-primary)', listStyle: 'none' }}>
          <span>Trust &amp; Credibility <span className="text-xs font-normal ml-1" style={{ color: 'var(--text-muted)' }}>(E-E-A-T signals — used in every AI prompt)</span></span>
          <span style={{ color: 'var(--text-faint)', fontSize: '0.75rem' }}>▸</span>
        </summary>

        <div className="p-6 pt-0 space-y-4" style={{ borderTop: '1px solid var(--border)' }}>
          <p className="section-desc">
            These signals let the AI write as a genuine expert — not generic AI filler. Even a few filled fields make a noticeable difference in content quality.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Years in Business</Label>
              <input className="input" style={{ width: '100%' }} value={eeat.years_in_business} onChange={e => setEeatField('years_in_business', e.target.value)} placeholder="e.g. 22 years" />
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
