'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'

const PRESETS = [
  { label: 'Last 7 days',  type: 'rolling', days: 7  },
  { label: 'Last 30 days', type: 'rolling', days: 30 },
  { label: 'Last 90 days', type: 'rolling', days: 90 },
  { label: 'This Month',   type: 'month',   current: true },
  { label: 'Last Month',   type: 'month',   current: false },
]

const COMPARE_OPTIONS = [
  { value: 'prior_period', label: 'Previous period' },
  { value: 'last_year',    label: 'Same period last year' },
  { value: 'none',         label: 'No comparison' },
]

function fmtD(d: Date) { return d.toISOString().split('T')[0] }

function getMonthRange(current: boolean): [string, string] {
  const now = new Date()
  if (current) {
    const from = new Date(now.getFullYear(), now.getMonth(), 1)
    return [fmtD(from), fmtD(now)]
  } else {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const to   = new Date(now.getFullYear(), now.getMonth(), 0)
    return [fmtD(from), fmtD(to)]
  }
}

export default function DateRangePicker({
  from,
  to,
  compare = 'none',
}: {
  from:     string
  to:       string
  compare?: string
}) {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [open,      setOpen]      = useState(false)
  const [localFrom, setLocalFrom] = useState(from)
  const [localTo,   setLocalTo]   = useState(to)
  const [cmp,       setCmp]       = useState(compare)

  function buildUrl(f: string, t: string, c = cmp) {
    const p = new URLSearchParams(searchParams.toString())
    p.set('from', f)
    p.set('to',   t)
    if (c && c !== 'none') p.set('compare', c)
    else p.delete('compare')
    return `?${p.toString()}`
  }

  function applyPreset(preset: (typeof PRESETS)[number]) {
    if (preset.type === 'month') {
      const [f, t] = getMonthRange(preset.current!)
      router.push(buildUrl(f, t))
    } else {
      const t = new Date()
      const f = new Date(Date.now() - preset.days! * 24 * 60 * 60 * 1000)
      router.push(buildUrl(fmtD(f), fmtD(t)))
    }
    setOpen(false)
  }

  function applyCustom() {
    router.push(buildUrl(localFrom, localTo))
    setOpen(false)
  }

  function applyCompare(value: string) {
    setCmp(value)
    router.push(buildUrl(from, to, value))
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        className="btn btn-secondary flex items-center gap-2"
        style={{ padding: '0.375rem 0.75rem' }}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
          style={{ color: 'var(--text-muted)' }}>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <span className="text-sm">{from} – {to}</span>
        {cmp && cmp !== 'none' && (
          <span className="text-xs px-1.5 py-0.5 rounded" style={{
            background: 'var(--blue)', color: '#fff', fontSize: '0.7rem', fontWeight: 600,
          }}>vs</span>
        )}
      </button>

      {open && (
        <>
          {/* backdrop */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 49 }}
            onClick={() => setOpen(false)}
          />
          <div
            style={{
              position: 'absolute', right: 0, top: 42, width: 288, zIndex: 50,
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: '12px 0',
            }}
          >
            {/* Presets */}
            <div style={{ padding: '0 4px 8px' }}>
              {PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => applyPreset(p)}
                  className="w-full text-left text-sm px-3 py-2 rounded-lg transition-colors"
                  style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-subtle)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Custom range */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '12px 16px 8px' }}>
              <p className="text-xs mb-2" style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Custom range</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>From</label>
                  <input
                    type="date"
                    value={localFrom}
                    onChange={e => setLocalFrom(e.target.value)}
                    className="input"
                    style={{ padding: '0.3rem 0.4rem', fontSize: '0.8rem', width: '100%' }}
                  />
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>To</label>
                  <input
                    type="date"
                    value={localTo}
                    onChange={e => setLocalTo(e.target.value)}
                    className="input"
                    style={{ padding: '0.3rem 0.4rem', fontSize: '0.8rem', width: '100%' }}
                  />
                </div>
              </div>
              <button onClick={applyCustom} className="btn btn-primary w-full justify-center">
                Apply
              </button>
            </div>

            {/* Compare */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '12px 16px 4px' }}>
              <p className="text-xs mb-2" style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Compare to</p>
              {COMPARE_OPTIONS.map(opt => (
                <label
                  key={opt.value}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 0', cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="compare"
                    value={opt.value}
                    checked={cmp === opt.value || (opt.value === 'none' && !cmp)}
                    onChange={() => applyCompare(opt.value)}
                    style={{ accentColor: 'var(--blue)', width: 14, height: 14 }}
                  />
                  <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
