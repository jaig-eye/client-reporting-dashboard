'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { buildMetaActionOptions } from '@/lib/metric-presets'
import type { MetricConfig } from '@/lib/types'

interface Props {
  clientId: string
  /** The client's own metric_config (may be empty {}). */
  current: MetricConfig
  /** Global agency metric_config — shown as fallback hint. */
  globalConfig: MetricConfig
  /** Discovered action types from this client's Meta accounts. */
  discoveredMetaActions: string[]
}

const CUSTOM_VALUE  = '__custom__'
const INHERIT_VALUE = '__inherit__'

export default function ClientMetricConfig({
  clientId, current, globalConfig, discoveredMetaActions,
}: Props) {
  const router = useRouter()
  const options = buildMetaActionOptions(discoveredMetaActions)
  const presetValues = new Set(options.map(o => o.value))

  const globalAction = globalConfig.meta_conversion_action ?? 'results'
  const clientAction = current.meta_conversion_action
  const initAction   = clientAction
    ? (presetValues.has(clientAction) ? clientAction : CUSTOM_VALUE)
    : INHERIT_VALUE
  const initCustom   = (clientAction && !presetValues.has(clientAction)) ? clientAction : ''

  const [action,  setAction]  = useState(initAction)
  const [custom,  setCustom]  = useState(initCustom)
  const [label,   setLabel]   = useState(current.conversion_label ?? '')
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState('')

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    setError('')

    let config: MetricConfig
    if (action === INHERIT_VALUE) {
      config = {}
    } else {
      const meta_conversion_action = action === CUSTOM_VALUE ? custom.trim() : action
      config = {
        meta_conversion_action: meta_conversion_action || undefined,
        conversion_label:       label.trim() || undefined,
      }
    }

    const res = await fetch(`/api/admin/clients/${clientId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metric_config: config }),
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

  const selectCls =
    'w-full bg-[#080c18] border border-[#1e2a40] text-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors'
  const inputCls =
    'w-full bg-[#080c18] border border-[#1e2a40] text-slate-200 placeholder-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors'

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Override the global metric mapping for this client only. Leave on &quot;Inherit global&quot; to use the
        agency default (<span className="text-slate-400 font-mono">{globalAction}</span>).
        {discoveredMetaActions.length === 0 && (
          <> Run a Meta sync to populate the discovered actions dropdown.</>
        )}
      </p>

      {/* Meta conversion action */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-slate-400">Meta Conversion Action</label>
        <select
          value={action}
          onChange={e => { setAction(e.target.value); setSaved(false) }}
          className={selectCls}
        >
          <option value={INHERIT_VALUE}>Inherit global ({globalAction})</option>
          <option disabled>──────────────</option>
          {options.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
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

        {action !== INHERIT_VALUE && action !== CUSTOM_VALUE && (
          <p className="text-xs text-slate-600 font-mono">
            action_type: <span className="text-slate-400">{action}</span>
          </p>
        )}
      </div>

      {/* Conversion label */}
      {action !== INHERIT_VALUE && (
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">
            Conversion Label
            <span className="text-slate-600 font-normal ml-1">— override display name (e.g. &quot;Leads&quot;, &quot;Phone Calls&quot;)</span>
          </label>
          <input
            value={label}
            onChange={e => { setLabel(e.target.value); setSaved(false) }}
            placeholder="Conversions (default)"
            className={inputCls}
          />
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="text-xs text-emerald-400">Saved</span>}
      </div>
    </div>
  )
}
