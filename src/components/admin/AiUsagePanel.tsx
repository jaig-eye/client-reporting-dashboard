'use client'

// AI spend for the AI tab in agency settings.
//
// Reads the ai_usage ledger (migration 213), which records one row per provider call. Shaped
// after DataForSeoUsagePanel deliberately: the two answer the same question about two different
// vendors, and a reader who has learned one should not have to learn the other.
//
// The difference is that DataForSEO reports its own cost and we can quote it. Here the cost is
// OURS to compute — tokens times a rate card in lib/ai/pricing.ts — so the panel says so, dates
// the rate card, and counts calls it could not price separately rather than folding them in at
// zero and quietly understating the bill.

import { useCallback, useEffect, useState, type CSSProperties } from 'react'

interface Summary {
  from: string
  to:   string
  totals: {
    calls: number; inputTokens: number; outputTokens: number
    costUsd: number; unpricedCalls: number
  }
  byModel:     { model: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number; unpriced: number }[]
  byOperation: { operation: string; calls: number; costUsd: number; unpriced: number }[]
  byDay:       { date: string; calls: number; costUsd: number }[]
}

interface Response {
  summary: Summary
  pricing: { updatedOn: string; rates: { model: string; input?: number; output?: number; perImage?: number }[] }
}

/** Said the way somebody paying the bill would describe it, not the way the code names it. */
const OP_LABELS: Record<string, string> = {
  topics:          'Topic planning',
  article:         'Article generation',
  rewrite:         'Rewrites',
  full_regenerate: 'Full regenerations',
  brief:           'Topic briefs',
  brand_dna:       'Brand DNA',
  silo:            'Silo planning',
  service_area:    'Service area pages',
  image:           'Featured images',
  alert:           'Budget alerts',
  other:           'Other',
}

const RANGES = [7, 30, 90] as const

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n === 0) return '$0.00'
  // Sub-dollar totals are the normal case for a single day, and $0.00 would read as free.
  if (Math.abs(n) < 1) return `$${n.toFixed(4)}`
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function fmtDay(d: string): string {
  const [, m, day] = d.split('-')
  return `${Number(m)}/${Number(day)}`
}

export default function AiUsagePanel() {
  const [data,    setData]    = useState<Response | null>(null)
  const [days,    setDays]    = useState<number>(30)
  const [loading, setLoading] = useState(true)
  const [failed,  setFailed]  = useState(false)

  const load = useCallback((window: number) => {
    setLoading(true)
    setFailed(false)
    let cancelled = false
    fetch(`/api/admin/ai-usage?days=${window}`)
      .then(r => r.ok ? r.json() as Promise<Response> : null)
      .then(d => {
        if (cancelled) return
        if (d) setData(d); else setFailed(true)
        setLoading(false)
      })
      .catch(() => { if (!cancelled) { setFailed(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  useEffect(() => load(days), [days, load])

  if (loading && !data) {
    return <div className="card p-5" style={{ color: 'var(--text-faint)', fontSize: '0.85rem' }}>Loading AI usage…</div>
  }
  if (failed && !data) {
    return (
      <div className="card p-5" style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        Could not load AI usage.
      </div>
    )
  }
  if (!data) return null

  const s      = data.summary
  const maxDay = Math.max(...s.byDay.map(d => d.costUsd), 0.0001)
  const maxOp  = Math.max(...s.byOperation.map(o => o.costUsd), 0.0001)

  return (
    <div className="card p-5">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)', margin: 0 }}>AI Usage &amp; Cost</h2>
          <p className="text-xs" style={{ color: 'var(--text-muted)', margin: '2px 0 0' }}>
            Estimated from token counts · {s.from} → {s.to}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {RANGES.map(r => (
            <button
              key={r}
              type="button"
              onClick={() => setDays(r)}
              aria-pressed={days === r}
              style={{
                fontSize: '0.7rem', fontWeight: 600, padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
                border: `1px solid ${days === r ? 'var(--blue)' : 'var(--border)'}`,
                background: days === r ? 'var(--blue-subtle)' : 'transparent',
                color: days === r ? 'var(--blue)' : 'var(--text-muted)',
              }}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
        <Tile label="Estimated cost" value={fmtMoney(s.totals.costUsd)} hint={`rates as of ${data.pricing.updatedOn}`} />
        <Tile label="Calls"          value={s.totals.calls.toLocaleString()} />
        <Tile label="Input tokens"   value={fmtTokens(s.totals.inputTokens)} />
        <Tile label="Output tokens"  value={fmtTokens(s.totals.outputTokens)} />
      </div>

      {s.totals.calls === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
          Nothing recorded in this window. Generating a post, planning topics, running a rewrite or a
          full regeneration, or generating a featured image all write here — the first one you run
          will show up straight away.
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }} className="ai-usage-grid">
          {/* By operation — where the money goes. */}
          <div>
            <div style={sectionLabel}>By operation</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {s.byOperation.map(o => (
                <div key={o.operation}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: 2, gap: 8 }}>
                    <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {OP_LABELS[o.operation] ?? o.operation}{' '}
                      <span style={{ color: 'var(--text-faint)' }}>· {o.calls.toLocaleString()}</span>
                    </span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                      {fmtMoney(o.costUsd)}
                    </span>
                  </div>
                  <div style={{ height: 5, borderRadius: 3, background: 'var(--bg-muted)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.max(3, (o.costUsd / maxOp) * 100)}%`, background: '#6366f1', borderRadius: 3 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* By model — which connection the money goes through. */}
          <div>
            <div style={sectionLabel}>By model</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {s.byModel.map(m => (
                <div key={m.model} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', gap: 8 }}>
                  <span
                    style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={`${m.model} · ${fmtTokens(m.inputTokens)} in / ${fmtTokens(m.outputTokens)} out`}
                  >
                    {m.model}{' '}
                    <span style={{ color: 'var(--text-faint)' }}>· {m.calls.toLocaleString()}</span>
                  </span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                    {m.unpriced === m.calls ? '—' : fmtMoney(m.costUsd)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {s.byDay.length > 0 && (
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={sectionLabel}>Daily cost</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 56, overflowX: 'auto' }}>
                {s.byDay.map(d => (
                  <div
                    key={d.date}
                    title={`${fmtDay(d.date)} · ${fmtMoney(d.costUsd)} · ${d.calls} call${d.calls === 1 ? '' : 's'}`}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, minWidth: 14 }}
                  >
                    <div style={{ width: 10, height: `${Math.max(2, (d.costUsd / maxDay) * 44)}px`, background: '#6366f1', borderRadius: 2 }} />
                    <span style={{ fontSize: '0.55rem', color: 'var(--text-faint)' }}>{fmtDay(d.date)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Reported, never folded in. A model missing from the rate card has real tokens and an
          unknown price; adding it at zero would make the total look smaller than the invoice. */}
      {s.totals.unpricedCalls > 0 && (
        <p className="text-xs" style={{ color: 'var(--amber, #b45309)', margin: '14px 0 0', lineHeight: 1.5 }}>
          {s.totals.unpricedCalls.toLocaleString()} call{s.totals.unpricedCalls === 1 ? '' : 's'} used a model with no
          entry in the rate card, so their cost is not included above. Add it to lib/ai/pricing.ts to price them.
        </p>
      )}

      <p className="text-xs" style={{ color: 'var(--text-faint)', margin: '12px 0 0', lineHeight: 1.5 }}>
        Estimates, not an invoice — token counts come from the provider, prices from our own rate card
        (last updated {data.pricing.updatedOn}). Check the provider&apos;s billing page for the real figure.
      </p>

      <style>{`@media (max-width: 640px) { .ai-usage-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  )
}

const sectionLabel: CSSProperties = {
  fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
  color: 'var(--text-faint)', marginBottom: 8,
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>{label}</div>
      <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{value}</div>
      {hint && <div style={{ fontSize: '0.6rem', color: 'var(--text-faint)', marginTop: 1 }}>{hint}</div>}
    </div>
  )
}
