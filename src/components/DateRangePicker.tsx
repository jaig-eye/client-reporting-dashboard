'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'

function fmtD(d: Date) { return d.toISOString().split('T')[0] }

function getRollingRange(days: number): [string, string] {
  const to   = new Date()
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return [fmtD(from), fmtD(to)]
}

function getTodayRange(): [string, string] {
  const d = fmtD(new Date())
  return [d, d]
}

function getYesterdayRange(): [string, string] {
  const y = new Date(Date.now() - 24 * 60 * 60 * 1000)
  return [fmtD(y), fmtD(y)]
}

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

function getThisYearRange(): [string, string] {
  const now  = new Date()
  const from = new Date(now.getFullYear(), 0, 1)
  return [fmtD(from), fmtD(now)]
}

function getLastYearRange(): [string, string] {
  const now  = new Date()
  const from = new Date(now.getFullYear() - 1, 0, 1)
  const to   = new Date(now.getFullYear() - 1, 11, 31)
  return [fmtD(from), fmtD(to)]
}

type PresetId = 'today' | 'yesterday' | 'last7' | 'last14' | 'last30' | 'last90' | 'mtd' | 'lastMonth' | 'ytd' | 'lastYear'

const PRESETS: { id: PresetId; label: string }[] = [
  { id: 'today',     label: 'Today'        },
  { id: 'yesterday', label: 'Yesterday'    },
  { id: 'last7',     label: 'Last 7 days'  },
  { id: 'last14',    label: 'Last 14 days' },
  { id: 'last30',    label: 'Last 30 days' },
  { id: 'last90',    label: 'Last 90 days' },
  { id: 'mtd',       label: 'Month to Date' },
  { id: 'lastMonth', label: 'Last Month'   },
  { id: 'ytd',       label: 'Year to Date' },
  { id: 'lastYear',  label: 'Last Year'    },
]

function presetRange(id: PresetId): [string, string] {
  switch (id) {
    case 'today':     return getTodayRange()
    case 'yesterday': return getYesterdayRange()
    case 'last7':     return getRollingRange(7)
    case 'last14':    return getRollingRange(14)
    case 'last30':    return getRollingRange(30)
    case 'last90':    return getRollingRange(90)
    case 'mtd':       return getMonthRange(true)
    case 'lastMonth': return getMonthRange(false)
    case 'ytd':       return getThisYearRange()
    case 'lastYear':  return getLastYearRange()
  }
}

/** Try to detect which preset the current from/to matches (best-effort). */
function detectPreset(from: string, to: string): PresetId | null {
  for (const p of PRESETS) {
    const [f, t] = presetRange(p.id)
    if (f === from && t === to) return p.id
  }
  return null
}

const COMPARE_OPTIONS = [
  { value: 'prior_period', label: 'Previous period'          },
  { value: 'last_year',    label: 'Same period last year'    },
  { value: 'none',         label: 'No comparison'            },
]

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
  const activePreset = detectPreset(from, to)

  function buildUrl(f: string, t: string, c = cmp) {
    const p = new URLSearchParams(searchParams.toString())
    p.set('from', f)
    p.set('to',   t)
    if (c && c !== 'none') p.set('compare', c)
    else p.delete('compare')
    return `?${p.toString()}`
  }

  function applyPreset(id: PresetId) {
    const [f, t] = presetRange(id)
    setLocalFrom(f)
    setLocalTo(t)
    router.push(buildUrl(f, t))
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

  const presetLabel = activePreset ? PRESETS.find(p => p.id === activePreset)?.label : null

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
        <span className="text-sm">{presetLabel ?? `${from} – ${to}`}</span>
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
              position: 'absolute', right: 0, top: 42, width: 296, zIndex: 50,
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: '12px 0',
            }}
          >
            {/* Presets */}
            <div style={{ padding: '0 4px 8px' }}>
              {PRESETS.map(p => {
                const isActive = activePreset === p.id
                return (
                  <button
                    key={p.id}
                    onClick={() => applyPreset(p.id)}
                    className="w-full text-left text-sm px-3 py-2 rounded-lg transition-colors"
                    style={{
                      color:      isActive ? 'var(--blue)'          : 'var(--text-secondary)',
                      fontWeight: isActive ? 600                     : 400,
                      background: isActive ? 'var(--bg-subtle)'     : 'transparent',
                    }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-subtle)' }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                  >
                    {p.label}
                  </button>
                )
              })}
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
