'use client'

import { useState } from 'react'
import { buildMetaActionOptions } from '@/lib/metric-presets'
import type { MetricConfig } from '@/lib/types'

interface Props {
  current: MetricConfig
  discoveredMetaActions: string[]
}

const CUSTOM_VALUE = '__custom__'

export default function MetricSettings({ current, discoveredMetaActions }: Props) {
  const options = buildMetaActionOptions(discoveredMetaActions)
  const presetValues = new Set(options.map(o => o.value))

  const initAction = current.meta_conversion_action ?? 'results'
  const isCustom   = !!initAction && !presetValues.has(initAction)

  const [action,  setAction]  = useState(isCustom ? CUSTOM_VALUE : initAction)
  const [custom,  setCustom]  = useState(isCustom ? initAction : '')
  const [label,   setLabel]   = useState(current.conversion_label ?? '')
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState('')

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    setError('')

    const meta_conversion_action = action === CUSTOM_VALUE ? custom.trim() : action
    const config: MetricConfig = {
      meta_conversion_action: meta_conversion_action || 'results',
      conversion_label:       label.trim() || undefined,
    }

    const res = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metric_config: config }),
    })
    const data = await res.json()
    setSaving(false)
    if (data.error) setError(data.error)
    else setSaved(true)
  }

  const selectCls =
    'w-full bg-[#080c18] border border-[#1e2a40] text-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors'
  const inputCls =
    'w-full bg-[#080c18] border border-[#1e2a40] text-slate-200 placeholder-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors'

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Controls how Meta campaign data maps to the conversions metric.
        Run a sync first to populate the discovered actions dropdown.
        Client-level overrides take precedence over this global default.
      </p>

      {/* Meta conversion action */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-slate-400">
          Meta Conversion Action
          <span className="text-slate-600 font-normal ml-1">— which action_type counts as conversions</span>
        </label>
        <select
          value={action}
          onChange={e => { setAction(e.target.value); setSaved(false) }}
          className={selectCls}
        >
          {options.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
          {discoveredMetaActions.length === 0 && (
            <option disabled value="">— sync an account to see discovered actions —</option>
          )}
          <option value={CUSTOM_VALUE}>Custom action type…</option>
        </select>

        {action === CUSTOM_VALUE && (
          <input
            value={custom}
            onChange={e => { setCustom(e.target.value); setSaved(false) }}
            placeholder="e.g. offsite_conversion.fb_pixel_purchase"
            className={inputCls}
          />
        )}

        {/* Show current effective value */}
        {action !== CUSTOM_VALUE && (
          <p className="text-xs text-slate-600 font-mono">
            action_type: <span className="text-slate-400">{action}</span>
          </p>
        )}
      </div>

      {/* Conversion label override */}
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1">
          Conversion Label
          <span className="text-slate-600 font-normal ml-1">— display name in dashboards (e.g. &quot;Leads&quot;, &quot;Purchases&quot;)</span>
        </label>
        <input
          value={label}
          onChange={e => { setLabel(e.target.value); setSaved(false) }}
          placeholder="Conversions (default)"
          className={inputCls}
        />
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Save Metric Config'}
        </button>
        {saved && <span className="text-xs text-emerald-400">Saved</span>}
      </div>
    </div>
  )
}
