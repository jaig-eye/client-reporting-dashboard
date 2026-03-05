'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { MetricConfig } from '@/lib/types'

const METRICS = [
  { key: 'efficiency_score', label: 'Efficiency Score',   description: 'Marketing Efficiency Score ring widget' },
  { key: 'roas',             label: 'ROAS',               description: 'Return on Ad Spend' },
  { key: 'revenue',          label: 'Conversion Value',   description: 'Total revenue / conversion value' },
  { key: 'conversions',      label: 'Conversions',        description: 'Conversion count card' },
  { key: 'cpl',              label: 'CPL',                description: 'Cost per Lead / Cost per Conversion' },
  { key: 'clicks',           label: 'Clicks',             description: 'Total click count' },
  { key: 'ctr',              label: 'CTR',                description: 'Click-through rate' },
  { key: 'cpc',              label: 'Avg. CPC',           description: 'Average cost per click' },
  { key: 'impressions',      label: 'Impressions',        description: 'Total impression count' },
]

interface Props {
  clientId: string
  currentMetricConfig: MetricConfig
}

export default function ClientMetricVisibility({ clientId, currentMetricConfig }: Props) {
  const router = useRouter()
  const [hidden, setHidden] = useState<Set<string>>(
    new Set(currentMetricConfig.hidden_metrics ?? [])
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError]   = useState('')

  function toggle(key: string) {
    setSaved(false)
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    setError('')

    // Merge with existing metric_config so other fields (meta_conversion_action etc.) are preserved
    const res = await fetch(`/api/admin/clients/${clientId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        metric_config: {
          ...currentMetricConfig,
          hidden_metrics: Array.from(hidden),
        },
      }),
    })
    const data = await res.json()
    setSaving(false)
    if (data.error) {
      setError(data.error)
    } else {
      setSaved(true)
      router.refresh()
    }
  }

  const hiddenCount = hidden.size

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Toggle which metrics appear on this client&apos;s dashboard. Hidden metrics are removed
        completely — useful for lead-gen clients who don&apos;t need ROAS, or awareness clients
        who don&apos;t need CPL.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {METRICS.map(m => {
          const isHidden = hidden.has(m.key)
          return (
            <label
              key={m.key}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-all select-none ${
                isHidden
                  ? 'border-red-500/20 bg-red-500/5'
                  : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]'
              }`}
            >
              {/* Toggle switch */}
              <div
                onClick={() => toggle(m.key)}
                className={`relative flex-shrink-0 inline-flex h-5 w-9 rounded-full border-2 border-transparent transition-colors ${
                  isHidden ? 'bg-red-500/40' : 'bg-blue-600'
                }`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  isHidden ? 'translate-x-0' : 'translate-x-4'
                }`} />
              </div>
              <div className="min-w-0">
                <p className={`text-xs font-medium ${isHidden ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
                  {m.label}
                </p>
                <p className="text-[10px] text-slate-600 truncate">{m.description}</p>
              </div>
            </label>
          )
        })}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-40 transition-colors"
        >
          {saving ? 'Saving…' : 'Save Visibility'}
        </button>
        {saved && <span className="text-xs text-emerald-400">Saved</span>}
        {hiddenCount > 0 && (
          <span className="text-xs text-slate-600">{hiddenCount} metric{hiddenCount !== 1 ? 's' : ''} hidden</span>
        )}
      </div>
    </div>
  )
}
