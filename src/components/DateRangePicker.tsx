'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

const PRESETS = [
  { label: 'Last 7 days',  days: 7  },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
]

export default function DateRangePicker({ from, to }: { from: string; to: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [localFrom, setLocalFrom] = useState(from)
  const [localTo,   setLocalTo]   = useState(to)

  function applyPreset(days: number) {
    const toDate   = new Date()
    const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const fmt = (d: Date) => d.toISOString().split('T')[0]
    router.push(`/dashboard?from=${fmt(fromDate)}&to=${fmt(toDate)}`)
    setOpen(false)
  }

  function applyCustom() {
    router.push(`/dashboard?from=${localFrom}&to=${localTo}`)
    setOpen(false)
  }

  return (
    <div className="relative">
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
      </button>

      {open && (
        <div
          className="absolute right-0 top-10 rounded-xl p-4 w-72 z-50"
          style={{
            background:  'var(--bg-surface)',
            border:      '1px solid var(--border)',
            boxShadow:   '0 8px 24px rgba(0,0,0,0.12)',
          }}
        >
          <div className="space-y-0.5 mb-3">
            {PRESETS.map(p => (
              <button
                key={p.days}
                onClick={() => applyPreset(p.days)}
                className="w-full text-left text-sm px-3 py-2 rounded-lg transition-colors"
                style={{ color: 'var(--text-secondary)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-subtle)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="pt-3 space-y-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>From</label>
              <input
                type="date"
                value={localFrom}
                onChange={e => setLocalFrom(e.target.value)}
                className="input"
                style={{ padding: '0.375rem 0.5rem', fontSize: '0.875rem' }}
              />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>To</label>
              <input
                type="date"
                value={localTo}
                onChange={e => setLocalTo(e.target.value)}
                className="input"
                style={{ padding: '0.375rem 0.5rem', fontSize: '0.875rem' }}
              />
            </div>
            <button onClick={applyCustom} className="btn btn-primary w-full justify-center mt-1">
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
