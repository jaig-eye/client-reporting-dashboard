'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { GOAL_TYPE_OPTIONS, GOAL_TYPE_DEFS, detectGoalType } from '@/lib/goal-types'
import { buildMetaActionOptions } from '@/lib/metric-presets'
import type { GoalType, CampaignSettings } from '@/lib/types'

interface CampaignRow extends Omit<CampaignSettings, 'id' | 'created_at' | 'updated_at'> {
  id?: string
  /** True if this row came from metrics but has no settings row yet */
  isNew?: boolean
  dirty?: boolean
}

interface Props {
  clientId: string
  discoveredMetaActions: string[]
}

export default function CampaignConfigurator({ clientId, discoveredMetaActions }: Props) {
  const router = useRouter()
  const metaOptions = buildMetaActionOptions(discoveredMetaActions)

  const [rows, setRows]       = useState<CampaignRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState('')

  useEffect(() => {
    fetch(`/api/admin/clients/${clientId}/campaigns`)
      .then(r => r.json())
      .then(({ settings, unsettled }: { settings: CampaignSettings[]; unsettled: CampaignSettings[] }) => {
        const configured: CampaignRow[] = settings.map(s => ({ ...s, dirty: false }))
        const newRows: CampaignRow[] = unsettled.map(u => ({ ...u, id: undefined, isNew: true, dirty: false }))
        setRows([...configured, ...newRows])
      })
      .catch(() => setError('Failed to load campaigns'))
      .finally(() => setLoading(false))
  }, [clientId])

  function update(index: number, patch: Partial<CampaignRow>) {
    setRows(prev => prev.map((r, i) => i === index ? { ...r, ...patch, dirty: true } : r))
    setSaved(false)
  }

  async function handleSave() {
    const dirty = rows.filter(r => r.dirty || r.isNew)
    if (!dirty.length) return

    setSaving(true)
    setSaved(false)
    setError('')

    const res = await fetch(`/api/admin/clients/${clientId}/campaigns`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dirty.map(r => ({
        platform: r.platform,
        campaign_id: r.campaign_id,
        campaign_name: r.campaign_name,
        goal_type: r.goal_type,
        meta_conversion_action: r.meta_conversion_action ?? null,
        conversion_label: r.conversion_label ?? null,
      }))),
    })
    const data = await res.json()
    setSaving(false)

    if (data.error) {
      setError(data.error)
    } else {
      setRows(prev => prev.map(r => ({ ...r, dirty: false, isNew: false })))
      setSaved(true)
      router.refresh()
    }
  }

  const selectCls = 'bg-black/40 border border-white/10 text-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500 transition-colors w-full'
  const inputCls  = 'bg-black/40 border border-white/10 text-slate-200 placeholder-slate-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500 transition-colors w-full'

  const dirtyCount = rows.filter(r => r.dirty || r.isNew).length

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Assign a goal type to each campaign. Goal types control which metrics are shown on the dashboard
        (ROAS for purchases, CPL for leads, etc.) and how campaigns are grouped in the summary cards.
        Goal type is auto-suggested from the campaign name — review and override as needed.
      </p>

      {loading && <p className="text-xs text-slate-600 py-4 text-center">Loading campaigns…</p>}
      {!loading && rows.length === 0 && (
        <p className="text-xs text-slate-600 py-4 text-center">No campaigns synced yet. Run a sync first.</p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-xs min-w-[700px]">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="text-left py-2 px-3 text-slate-500 font-semibold uppercase tracking-wide w-8">&nbsp;</th>
                <th className="text-left py-2 px-3 text-slate-500 font-semibold uppercase tracking-wide">Campaign</th>
                <th className="text-left py-2 px-3 text-slate-500 font-semibold uppercase tracking-wide w-[160px]">Goal Type</th>
                <th className="text-left py-2 px-3 text-slate-500 font-semibold uppercase tracking-wide w-[220px]">Meta Conversion Action</th>
                <th className="text-left py-2 px-3 text-slate-500 font-semibold uppercase tracking-wide w-[120px]">Label Override</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {rows.map((row, i) => {
                const def = GOAL_TYPE_DEFS[row.goal_type]
                const autoSuggested = row.isNew
                return (
                  <tr key={`${row.platform}::${row.campaign_id}`} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-2 px-3">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        row.platform === 'meta'
                          ? 'bg-indigo-500/10 text-indigo-400'
                          : 'bg-blue-500/10 text-blue-400'
                      }`}>
                        {row.platform === 'meta' ? 'M' : 'G'}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-300 max-w-[220px]">
                      <span className="truncate block" title={row.campaign_name}>{row.campaign_name}</span>
                      {autoSuggested && (
                        <span className="text-slate-600 italic">auto-suggested</span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      <select
                        value={row.goal_type}
                        onChange={e => update(i, { goal_type: e.target.value as GoalType })}
                        className={selectCls}
                        style={{ borderColor: row.dirty || row.isNew ? 'rgba(99,102,241,0.4)' : '' }}
                      >
                        {GOAL_TYPE_OPTIONS.map(gt => (
                          <option key={gt} value={gt}>{GOAL_TYPE_DEFS[gt].label}</option>
                        ))}
                      </select>
                      <div className={`mt-1 text-[10px] px-1.5 py-0.5 rounded inline-block font-medium ${def.badgeClasses}`}>
                        {def.badge}
                      </div>
                    </td>
                    <td className="py-2 px-3">
                      {row.platform === 'meta' ? (
                        <select
                          value={row.meta_conversion_action ?? ''}
                          onChange={e => update(i, { meta_conversion_action: e.target.value || null })}
                          className={selectCls}
                        >
                          <option value="">— inherit client/global —</option>
                          {metaOptions.map(o => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-slate-600 text-xs italic">Standard Conversions (auto)</span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="text"
                        value={row.conversion_label ?? ''}
                        onChange={e => update(i, { conversion_label: e.target.value || null })}
                        placeholder={GOAL_TYPE_DEFS[row.goal_type].defaultConversionLabel}
                        className={inputCls}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      {rows.length > 0 && (
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSave}
            disabled={saving || dirtyCount === 0}
            className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-40 transition-colors"
          >
            {saving ? 'Saving…' : `Save${dirtyCount > 0 ? ` (${dirtyCount} changed)` : ''}`}
          </button>
          {saved && <span className="text-xs text-emerald-400">Saved — dashboard will update immediately</span>}
        </div>
      )}
    </div>
  )
}
