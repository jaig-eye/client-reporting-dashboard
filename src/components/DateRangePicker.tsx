'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

const PRESETS = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
]

export default function DateRangePicker({ from, to }: { from: string; to: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [localFrom, setLocalFrom] = useState(from)
  const [localTo, setLocalTo] = useState(to)

  function applyPreset(days: number) {
    const toDate = new Date()
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
        className="flex items-center gap-2 text-sm border border-[#1e2a40] bg-[#0f1525] text-slate-300 rounded-lg px-3 py-1.5 hover:border-[#2a3a54] hover:bg-[#151c30] transition-colors"
      >
        <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        {from} – {to}
      </button>

      {open && (
        <div className="absolute right-0 top-10 bg-[#0f1525] border border-[#1e2a40] rounded-xl shadow-2xl shadow-black/60 p-4 w-72 z-50">
          <div className="space-y-1 mb-4">
            {PRESETS.map(p => (
              <button
                key={p.days}
                onClick={() => applyPreset(p.days)}
                className="w-full text-left text-sm px-3 py-2 rounded-lg hover:bg-[#151c30] text-slate-300 transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="border-t border-[#1e2a40] pt-3 space-y-2">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">From</label>
              <input type="date" value={localFrom} onChange={e => setLocalFrom(e.target.value)}
                className="w-full bg-[#080c18] border border-[#1e2a40] text-slate-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">To</label>
              <input type="date" value={localTo} onChange={e => setLocalTo(e.target.value)}
                className="w-full bg-[#080c18] border border-[#1e2a40] text-slate-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20"
              />
            </div>
            <button
              onClick={applyCustom}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium py-1.5 rounded-lg mt-1 transition-colors"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
