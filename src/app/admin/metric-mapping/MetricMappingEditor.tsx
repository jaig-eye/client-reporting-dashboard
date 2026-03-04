'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { buildMetaActionOptions } from '@/lib/metric-presets'
import type { MetricConfig } from '@/lib/types'

interface ClientRow {
  id: string
  name: string
  metric_config: MetricConfig | null
}

interface Props {
  globalConfig: MetricConfig
  discoveredMetaActions: string[]
  clients: ClientRow[]
}

const CUSTOM_VALUE = '__custom__'

export default function MetricMappingEditor({ globalConfig, discoveredMetaActions, clients }: Props) {
  const options = buildMetaActionOptions(discoveredMetaActions)
  const presetValues = new Set(options.map(o => o.value))

  const initAction = globalConfig.meta_conversion_action ?? ''
  const isCustom   = !!initAction && !presetValues.has(initAction)

  const router = useRouter()

  const [action,  setAction]  = useState(isCustom ? CUSTOM_VALUE : initAction)
  const [custom,  setCustom]  = useState(isCustom ? initAction : '')
  const [label,   setLabel]   = useState(globalConfig.conversion_label ?? '')
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState('')

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    setError('')

    const meta_conversion_action = action === CUSTOM_VALUE ? custom.trim() : action
    const config: MetricConfig = {
      meta_conversion_action: meta_conversion_action || undefined,
      conversion_label:       label.trim() || undefined,
    }

    const res = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metric_config: config }),
    })
    const data = await res.json()
    setSaving(false)
    if (data.error) {
      setError(data.error)
    } else {
      setSaved(true)
      router.refresh() // invalidate Next.js Router Cache so navigating back shows fresh data
    }
  }

  const selectCls =
    'w-full bg-[#080c18] border border-[#1e2a40] text-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors'
  const inputCls =
    'w-full bg-[#080c18] border border-[#1e2a40] text-slate-200 placeholder-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors'

  return (
    <div className="space-y-4">

      {/* Canonical metric definitions — what's automatic */}
      <section className="bg-[#0f1525] border border-[#1e2a40] rounded-xl p-5">
        <h2 className="text-sm font-semibold text-slate-200 mb-3">Automatic Metrics</h2>
        <p className="text-xs text-slate-500 mb-3">
          These metrics are the same across platforms and require no configuration.
        </p>
        <div className="grid grid-cols-3 gap-2 text-xs">
          {['Spend', 'Clicks', 'Impressions', 'CTR', 'CPC', 'CPM'].map(m => (
            <div key={m} className="flex items-center gap-1.5 text-slate-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
              {m}
            </div>
          ))}
        </div>
      </section>

      {/* Conversions metric — configurable */}
      <section className="bg-[#0f1525] border border-[#1e2a40] rounded-xl p-5 space-y-5">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Conversions Metric — Global Default</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Controls what counts as a &quot;conversion&quot; on all client dashboards.
            Per-client overrides can be set on each client&apos;s page.
          </p>
        </div>

        {/* Platform rows */}
        <div className="space-y-4">
          {/* Meta */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-400 flex-shrink-0" />
              <span className="text-xs font-semibold text-slate-300">Meta Ads</span>
              <span className="text-xs text-slate-600">— which action_type counts</span>
            </div>

            <select
              value={action}
              onChange={e => { setAction(e.target.value); setSaved(false) }}
              className={selectCls}
            >
              <option value="">— not configured (conversions will show 0) —</option>
              <option disabled>──────────────</option>
              {options.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
              {discoveredMetaActions.length === 0 && (
                <option disabled>— sync a Meta account to see discovered actions —</option>
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

            {action && action !== CUSTOM_VALUE && (
              <p className="text-xs text-slate-600 font-mono">
                action_type: <span className="text-slate-400">{action}</span>
              </p>
            )}

            {discoveredMetaActions.length > 0 && (
              <details className="group">
                <summary className="text-xs text-slate-600 cursor-pointer hover:text-slate-500 select-none">
                  {discoveredMetaActions.length} discovered action types from your synced accounts
                </summary>
                <div className="mt-2 pl-3 border-l border-[#1e2a40] space-y-1">
                  {discoveredMetaActions.map(a => (
                    <p key={a} className="text-xs font-mono text-slate-500">{a}</p>
                  ))}
                </div>
              </details>
            )}
          </div>

          {/* Google */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
              <span className="text-xs font-semibold text-slate-300">Google Ads</span>
            </div>
            <p className="text-xs text-slate-500 pl-4">
              Standard Conversions — automatically pulled from your Google Ads account. No configuration needed.
            </p>
          </div>
        </div>

        {/* Conversion label */}
        <div className="space-y-1.5 pt-2 border-t border-[#1e2a40]">
          <label className="block text-xs font-semibold text-slate-300">
            Display Label
            <span className="text-slate-600 font-normal ml-1">— what to call conversions on dashboards</span>
          </label>
          <input
            value={label}
            onChange={e => { setLabel(e.target.value); setSaved(false) }}
            placeholder="Conversions (default)"
            className={inputCls}
          />
          <p className="text-xs text-slate-600">
            Examples: &quot;Leads&quot;, &quot;Phone Calls&quot;, &quot;Purchases&quot;, &quot;Appointments&quot;
          </p>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save Global Defaults'}
          </button>
          {saved && <span className="text-xs text-emerald-400">Saved — dashboard will reflect immediately</span>}
        </div>
      </section>

      {/* Per-client overrides */}
      <section className="bg-[#0f1525] border border-[#1e2a40] rounded-xl p-5">
        <h2 className="text-sm font-semibold text-slate-200 mb-1">Per-Client Overrides</h2>
        <p className="text-xs text-slate-500 mb-4">
          Clients can have their own conversion action and label.
          Configure these on each client&apos;s page.
        </p>
        <div className="divide-y divide-[#1e2a40]">
          {clients.map(client => {
            const cfg = client.metric_config ?? {}
            const hasOverride = !!(cfg.meta_conversion_action || cfg.conversion_label)
            return (
              <div key={client.id} className="flex items-center justify-between py-2.5 gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-300 font-medium truncate">{client.name}</p>
                  {hasOverride ? (
                    <p className="text-xs text-slate-500 font-mono">
                      {cfg.meta_conversion_action && <>action: {cfg.meta_conversion_action}</>}
                      {cfg.meta_conversion_action && cfg.conversion_label && ' · '}
                      {cfg.conversion_label && <>label: &quot;{cfg.conversion_label}&quot;</>}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-600">Inherits global defaults</p>
                  )}
                </div>
                <Link
                  href={`/admin/clients/${client.id}`}
                  className="text-xs border border-[#1e2a40] text-slate-500 px-3 py-1.5 rounded-lg hover:border-[#2a3a54] hover:text-slate-300 transition-colors whitespace-nowrap flex-shrink-0"
                >
                  Override →
                </Link>
              </div>
            )
          })}
          {clients.length === 0 && (
            <p className="text-xs text-slate-600 py-2">No clients yet.</p>
          )}
        </div>
      </section>
    </div>
  )
}
