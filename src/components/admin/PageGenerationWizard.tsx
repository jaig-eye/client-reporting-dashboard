'use client'

import { useState, useMemo, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PageEntry {
  title: string
  slug:  string   // just the slug segment, no leading slash
}

export interface PageGenerationWizardProps {
  clientId:        string
  contentType:     'service_page' | 'regular_page'
  onClose:         () => void
  onSuccess:       () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const INTERVALS = [
  { value: 'daily',    label: 'Every day',      days: 1  },
  { value: 'every2',   label: 'Every 2 days',   days: 2  },
  { value: 'weekly',   label: 'Every week',     days: 7  },
  { value: 'biweekly', label: 'Every 2 weeks',  days: 14 },
]

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

// Returns bare slug segments only (no prefix). Prefix is for display only.
function parseLines(raw: string): PageEntry[] {
  return raw
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(line => {
      // URL input → extract last path segment as title + slug
      if (/^https?:\/\//i.test(line)) {
        try {
          const u        = new URL(line)
          const segments = u.pathname.replace(/\/$/, '').split('/').filter(Boolean)
          const last     = segments[segments.length - 1] ?? ''
          const title    = last.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
          const slug     = last || slugify(title)
          return { title, slug }
        } catch {
          // fall through to plain text
        }
      }
      return { title: line, slug: slugify(line) }
    })
    .filter(p => p.slug && p.title)
}

function addDays(isoDate: string, n: number): string {
  const d = new Date(isoDate + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function previewDates(count: number, startDate: string, intervalVal: string): string[] {
  const days = INTERVALS.find(i => i.value === intervalVal)?.days ?? 7
  return Array.from({ length: count }, (_, i) => addDays(startDate, i * days))
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

function tomorrow(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PageGenerationWizard({
  clientId,
  contentType,
  onClose,
  onSuccess,
}: PageGenerationWizardProps) {
  const typeLabel = contentType === 'service_page' ? 'Service Pages' : 'Regular Pages'
  const defaultPrefix = contentType === 'service_page' ? '/services' : ''

  // Step 1 — Pages
  const [rawPages,    setRawPages]    = useState('')
  const [slugPrefix,  setSlugPrefix]  = useState(defaultPrefix)

  // Step 2 — Timing
  const [delivery,       setDelivery]       = useState<'immediate' | 'spaced'>('immediate')
  const [spaceInterval,  setSpaceInterval]  = useState('weekly')
  const [spaceStartDate, setSpaceStartDate] = useState(tomorrow)

  // Wizard state
  const [step,       setStep]       = useState<1 | 2 | 3>(1)
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  const pages = useMemo(() => parseLines(rawPages), [rawPages])
  const dates  = useMemo(
    () => delivery === 'spaced' ? previewDates(pages.length, spaceStartDate, spaceInterval) : [],
    [delivery, pages.length, spaceStartDate, spaceInterval],
  )

  const canProceed1 = pages.length > 0
  const canProceed2 = delivery === 'immediate' || (delivery === 'spaced' && !!spaceStartDate)

  const handleSubmit = useCallback(async () => {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/content/pages/queue', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id:        clientId,
          content_type:     contentType,
          pages:            pages.map(p => ({ title: p.title, slug: p.slug })),
          delivery,
          space_interval:   delivery === 'spaced' ? spaceInterval  : undefined,
          space_start_date: delivery === 'spaced' ? spaceStartDate : undefined,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(d.error ?? `HTTP ${res.status}`)
      }
      onSuccess()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      setSubmitting(false)
    }
  }, [clientId, contentType, pages, delivery, spaceInterval, spaceStartDate, onSuccess])

  // ── Shared style tokens ────────────────────────────────────────────────────
  const s = {
    overlay: {
      position:        'fixed' as const,
      inset:           0,
      background:      'rgba(0,0,0,0.55)',
      zIndex:          1000,
      display:         'flex',
      alignItems:      'center',
      justifyContent:  'center',
      padding:         '1rem',
    },
    modal: {
      background:      'var(--bg-surface)',
      border:          '1px solid var(--border)',
      borderRadius:    12,
      width:           '100%',
      maxWidth:        620,
      maxHeight:       '90vh',
      display:         'flex',
      flexDirection:   'column' as const,
      overflow:        'hidden',
    },
    header: {
      padding:         '1.25rem 1.5rem',
      borderBottom:    '1px solid var(--border)',
      display:         'flex',
      alignItems:      'center',
      gap:             12,
    },
    body: {
      padding:         '1.5rem',
      overflowY:       'auto' as const,
      flex:            1,
    },
    footer: {
      padding:         '1rem 1.5rem',
      borderTop:       '1px solid var(--border)',
      display:         'flex',
      justifyContent:  'space-between',
      alignItems:      'center',
      gap:             8,
    },
    label: {
      display:         'block',
      fontSize:        '0.8rem',
      fontWeight:      600,
      color:           'var(--text-muted)',
      marginBottom:    '0.35rem',
      textTransform:   'uppercase' as const,
      letterSpacing:   '0.04em',
    },
    hint: {
      fontSize:        '0.75rem',
      color:           'var(--text-faint)',
      marginBottom:    '0.5rem',
    },
    radio: {
      display:         'flex',
      flexDirection:   'column' as const,
      gap:             8,
    },
    radioOpt: (active: boolean) => ({
      display:        'flex',
      alignItems:     'flex-start',
      gap:            10,
      padding:        '0.75rem 1rem',
      borderRadius:   8,
      border:         `1px solid ${active ? 'var(--blue)' : 'var(--border)'}`,
      background:     active ? 'var(--blue-subtle)' : 'transparent',
      cursor:         'pointer',
    }),
    previewRow: {
      display:        'grid',
      gridTemplateColumns: '1fr 1fr',
      gap:            '0.25rem 1rem',
      fontSize:       '0.78rem',
      padding:        '0.5rem 0.75rem',
      borderRadius:   6,
      background:     'var(--bg-subtle)',
      marginTop:      '0.5rem',
      maxHeight:      240,
      overflowY:      'auto' as const,
    },
  }

  // ── Steps ──────────────────────────────────────────────────────────────────

  const stepIndicator = (
    <div style={{ display: 'flex', gap: 6 }}>
      {([1, 2, 3] as const).map(n => (
        <div key={n} style={{
          width: 24, height: 24, borderRadius: '50%', fontSize: '0.72rem', fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: step === n ? 'var(--blue)' : step > n ? 'var(--green)' : 'var(--bg-subtle)',
          color: step >= n ? '#fff' : 'var(--text-faint)',
          border: `1px solid ${step === n ? 'var(--blue)' : step > n ? 'var(--green)' : 'var(--border)'}`,
        }}>
          {step > n ? '✓' : n}
        </div>
      ))}
    </div>
  )

  // Step 1 — Define pages
  const step1 = (
    <>
      <div style={{ marginBottom: '1.25rem' }}>
        <label style={s.label}>Pages to Generate</label>
        <p style={s.hint}>
          One service or page per line. Enter a name, keyword, or full URL.
          <br />e.g. &quot;Drain Cleaning&quot; or &quot;https://site.com/services/drain-cleaning&quot;
        </p>
        <textarea
          className="input"
          rows={8}
          placeholder={'Plumbing Services\nDrain Cleaning\nEmergency Plumber\nWater Heater Installation'}
          value={rawPages}
          onChange={e => setRawPages(e.target.value)}
          style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace', fontSize: '0.8125rem' }}
          autoFocus
        />
        {pages.length > 0 && (
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 6 }}>
            {pages.length} page{pages.length !== 1 ? 's' : ''} detected
          </p>
        )}
      </div>

      <div>
        <label style={s.label}>Slug Prefix</label>
        <p style={s.hint}>
          The URL path prefix these pages will live under on your site.
        </p>
        <input
          className="input"
          type="text"
          placeholder="/services"
          value={slugPrefix}
          onChange={e => setSlugPrefix(e.target.value)}
          style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8125rem' }}
        />
        {pages.length > 0 && (
          <div style={s.previewRow}>
            <span style={{ color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.7rem' }}>PAGE</span>
            <span style={{ color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.7rem' }}>SLUG</span>
            {pages.map((p, i) => (
              <div key={i} style={{ display: 'contents' }}>
                <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
                <span style={{ color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                  {slugPrefix.replace(/\/+$/, '')}/{p.slug}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )

  // Step 2 — Timing
  const step2 = (
    <>
      <div>
        <label style={s.label}>When to Generate</label>
        <div style={s.radio}>
          <label style={s.radioOpt(delivery === 'immediate')} onClick={() => setDelivery('immediate')}>
            <input type="radio" name="delivery" value="immediate" checked={delivery === 'immediate'} onChange={() => setDelivery('immediate')} style={{ marginTop: 2, flexShrink: 0 }} />
            <div>
              <p style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: 2 }}>Generate all now</p>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                All {pages.length} page{pages.length !== 1 ? 's' : ''} start generating immediately. They will appear in the pipeline as &ldquo;Generating&rdquo; and move to &ldquo;Ready for Review&rdquo; when done.
              </p>
            </div>
          </label>

          <label style={s.radioOpt(delivery === 'spaced')} onClick={() => setDelivery('spaced')}>
            <input type="radio" name="delivery" value="spaced" checked={delivery === 'spaced'} onChange={() => setDelivery('spaced')} style={{ marginTop: 2, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <p style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: 2 }}>Space them out</p>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Pages are queued with staggered publish dates. The cron picks them up automatically — one per run.
              </p>
              {delivery === 'spaced' && (
                <div style={{ marginTop: '0.75rem', display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ ...s.label, marginBottom: '0.25rem' }}>Start Date</label>
                    <input
                      className="input"
                      type="date"
                      value={spaceStartDate}
                      min={tomorrow()}
                      onChange={e => setSpaceStartDate(e.target.value)}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ ...s.label, marginBottom: '0.25rem' }}>Interval</label>
                    <select
                      className="input"
                      value={spaceInterval}
                      onChange={e => setSpaceInterval(e.target.value)}
                      style={{ width: '100%' }}
                    >
                      {INTERVALS.map(i => (
                        <option key={i.value} value={i.value}>{i.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          </label>
        </div>

        {delivery === 'spaced' && dates.length > 0 && (
          <div style={{ marginTop: '0.875rem' }}>
            <p style={s.hint}>Estimated publish schedule:</p>
            <div style={{ ...s.previewRow, gridTemplateColumns: '1fr auto' }}>
              <span style={{ color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.7rem' }}>PAGE</span>
              <span style={{ color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.7rem' }}>DATE</span>
              {pages.map((p, i) => (
                <div key={i} style={{ display: 'contents' }}>
                  <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
                  <span style={{ color: 'var(--text-faint)', whiteSpace: 'nowrap', fontSize: '0.72rem' }}>{fmtDate(dates[i] ?? '')}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )

  // Step 3 — Review
  const step3 = (
    <>
      <div style={{ marginBottom: '1.25rem' }}>
        <p style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>Ready to generate</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          <span><strong style={{ color: 'var(--text-primary)' }}>{pages.length}</strong> {typeLabel.toLowerCase()} to generate</span>
          <span>Slug prefix: <code style={{ fontSize: '0.8rem', background: 'var(--bg-subtle)', padding: '1px 5px', borderRadius: 4 }}>{slugPrefix || '/'}</code></span>
          <span>Delivery: <strong style={{ color: 'var(--text-primary)' }}>
            {delivery === 'immediate'
              ? 'Generate all now'
              : `Spaced ${INTERVALS.find(i => i.value === spaceInterval)?.label.toLowerCase() ?? ''} from ${fmtDate(spaceStartDate)}`
            }
          </strong></span>
        </div>
      </div>

      <div>
        <label style={s.label}>Pages</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 260, overflowY: 'auto' }}>
          {pages.map((p, i) => (
            <div key={i} style={{
              display:        'flex',
              alignItems:     'center',
              gap:            10,
              padding:        '0.45rem 0.75rem',
              borderRadius:   6,
              background:     'var(--bg-subtle)',
              fontSize:       '0.8rem',
            }}>
              <span style={{ color: 'var(--green)', flexShrink: 0 }}>✓</span>
              <span style={{ flex: 1, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
              <span style={{ color: 'var(--text-faint)', fontFamily: 'monospace', fontSize: '0.75rem', flexShrink: 0 }}>
                {delivery === 'spaced' && dates[i] ? `${fmtDate(dates[i]!)} · ` : ''}
                {slugPrefix.replace(/\/+$/, '')}/{p.slug}
              </span>
            </div>
          ))}
        </div>
      </div>

      <p style={{ marginTop: '1rem', fontSize: '0.75rem', color: 'var(--text-faint)' }}>
        Generated pages use your client&apos;s master prompt, brand DNA, and topic guidelines. They will appear in the pipeline as &ldquo;Ready for Review&rdquo; — you approve them before they go live.
      </p>
    </>
  )

  return (
    <div style={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={s.modal} role="dialog" aria-modal="true">
        {/* Header */}
        <div style={s.header}>
          {stepIndicator}
          <div style={{ flex: 1, marginLeft: 8 }}>
            <p style={{ fontWeight: 700, fontSize: '0.9375rem' }}>Generate {typeLabel}</p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>
              {step === 1 ? 'Define the pages you need' : step === 2 ? 'Set timing' : 'Review and generate'}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: '1.25rem', lineHeight: 1, padding: '0 4px' }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={s.body}>
          {step === 1 && step1}
          {step === 2 && step2}
          {step === 3 && step3}
          {error && (
            <p style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--red)', background: 'var(--red-subtle)', padding: '0.5rem 0.75rem', borderRadius: 6 }}>
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div style={s.footer}>
          <button
            className="btn btn-secondary"
            onClick={step === 1 ? onClose : () => setStep(s => (s - 1) as 1 | 2 | 3)}
            disabled={submitting}
          >
            {step === 1 ? 'Cancel' : '← Back'}
          </button>

          {step < 3 ? (
            <button
              className="btn btn-primary"
              onClick={() => setStep(s => (s + 1) as 1 | 2 | 3)}
              disabled={(step === 1 && !canProceed1) || (step === 2 && !canProceed2)}
            >
              Next →
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={submitting || pages.length === 0}
            >
              {submitting ? 'Queuing…' : `Generate ${pages.length} Page${pages.length !== 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
