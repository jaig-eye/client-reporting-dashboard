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
        className="flex items-center gap-2 text-sm border border-gray-200 bg-white rounded-lg px-3 py-1.5 hover:border-gray-300 transition-colors"
      >
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        {from} – {to}
      </button>

      {open && (
        <div className="absolute right-0 top-10 bg-white border border-gray-200 rounded-xl shadow-lg p-4 w-72 z-50">
          <div className="space-y-1 mb-4">
            {PRESETS.map(p => (
              <button
                key={p.days}
                onClick={() => applyPreset(p.days)}
                className="w-full text-left text-sm px-3 py-2 rounded-lg hover:bg-gray-50 text-gray-700"
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="border-t border-gray-100 pt-3 space-y-2">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">From</label>
              <input type="date" value={localFrom} onChange={e => setLocalFrom(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">To</label>
              <input type="date" value={localTo} onChange={e => setLocalTo(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-2 py-1 text-sm"
              />
            </div>
            <button
              onClick={applyCustom}
              className="w-full bg-blue-600 text-white text-sm font-medium py-1.5 rounded-lg mt-1"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
