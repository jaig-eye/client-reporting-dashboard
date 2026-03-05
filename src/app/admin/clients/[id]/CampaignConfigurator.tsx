'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { GOAL_TYPE_OPTIONS, GOAL_TYPE_DEFS } from '@/lib/goal-types'
import { buildMetaActionOptions } from '@/lib/metric-presets'
import type { GoalType, CampaignSettings } from '@/lib/types'

interface CampaignRow extends Omit<CampaignSettings, 'id' | 'created_at' | 'updated_at'> {
  id?: string
  isNew?: boolean
  dirty?: boolean
}

interface Props {
  clientId: string
  discoveredMetaActions: string[]
}

function EyeIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  )
}

// Common Google conversion types for the dropdown
const GOOGLE_CONVERSION_TYPES = [
  { value: 'Purchases',          label: 'Purchases / Sales' },
  { value: 'Leads',              label: 'Leads / Form Fills' },
  { value: 'Phone Calls',        label: 'Phone Calls' },
  { value: 'Appointments',       label: 'Appointments / Bookings' },
  { value: 'Sign-ups',           label: 'Sign-ups / Registrations' },
  { value: 'Page Views',         label: 'Page Views / Micro-conversions' },
  { value: 'All Conversions',    label: 'All Conversions (default)' },
]

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
        hidden: r.hidden ?? false,
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

  const dirtyCount  = rows.filter(r => r.dirty || r.isNew).length
  const hiddenCount = rows.filter(r => r.hidden).length

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Assign a goal and conversion action to each campaign. Purchases goal = ROAS shown;
        all other goals = CPL shown. Use the eye icon to hide campaigns (e.g. test/fraud campaigns).
      </p>

      {loading && <p className="text-xs text-slate-600 py-4 text-center">Loading campaigns…</p>}
      {!loading && rows.length === 0 && (
        <p className="text-xs text-slate-600 py-4 text-center">No campaigns synced yet. Run a sync first.</p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-xs min-w-[820px]">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="text-left py-2 px-3 text-slate-500 font-semibold uppercase tracking-wide w-8">&nbsp;</th>
                <th className="text-left py-2 px-3 text-slate-500 font-semibold uppercase tracking-wide">Campaign</th>
                <th className="text-left py-2 px-3 text-slate-500 font-semibold uppercase tracking-wide w-[155px]">Goal Type</th>
                <th className="text-left py-2 px-3 text-slate-500 font-semibold uppercase tracking-wide w-[210px]">Conversion Action</th>
                <th className="text-left py-2 px-3 text-slate-500 font-semibold uppercase tracking-wide w-[130px]">
                  Label Override
                  <span className="text-slate-700 font-normal ml-1">(Meta only)</span>
                </th>
                <th className="text-center py-2 px-3 text-slate-500 font-semibold uppercase tracking-wide w-14">Hide</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {rows.map((row, i) => {
                const def = GOAL_TYPE_DEFS[row.goal_type]
                return (
                  <tr
                    key={`${row.platform}::${row.campaign_id}`}
                    className={`transition-colors ${row.hidden ? 'opacity-40' : 'hover:bg-white/[0.02]'}`}
                  >
                    <td className="py-2 px-3">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        row.platform === 'meta'
                          ? 'bg-indigo-500/10 text-indigo-400'
                          : 'bg-blue-500/10 text-blue-400'
                      }`}>
                        {row.platform === 'meta' ? 'M' : 'G'}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-300 max-w-[200px]">
                      <span className="truncate block" title={row.campaign_name}>{row.campaign_name}</span>
                      {row.isNew && <span className="text-slate-600 italic">auto-suggested</span>}
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

                    {/* Conversion Action — Meta: action type dropdown; Google: conversion type select */}
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
                        <select
                          value={row.conversion_label ?? ''}
                          onChange={e => update(i, { conversion_label: e.target.value || null })}
                          className={selectCls}
                        >
                          <option value="">— select type —</option>
                          {GOOGLE_CONVERSION_TYPES.map(o => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      )}
                    </td>

                    {/* Label Override — Meta only; Google uses conversion_label above */}
                    <td className="py-2 px-3">
                      {row.platform === 'meta' ? (
                        <input
                          type="text"
                          value={row.conversion_label ?? ''}
                          onChange={e => update(i, { conversion_label: e.target.value || null })}
                          placeholder={GOAL_TYPE_DEFS[row.goal_type].defaultConversionLabel}
                          className={inputCls}
                        />
                      ) : (
                        <span className="text-slate-700 text-xs">—</span>
                      )}
                    </td>

                    <td className="py-2 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => update(i, { hidden: !row.hidden })}
                        title={row.hidden ? 'Hidden — click to show' : 'Visible — click to hide'}
                        className={`inline-flex items-center justify-center rounded p-1 transition-colors ${
                          row.hidden
                            ? 'text-red-400 hover:text-red-300 bg-red-500/10'
                            : 'text-slate-600 hover:text-slate-400 hover:bg-white/[0.05]'
                        }`}
                      >
                        {row.hidden ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
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
          {saved && <span className="text-xs text-emerald-400">Saved</span>}
          {hiddenCount > 0 && (
            <span className="text-xs text-slate-600">{hiddenCount} campaign{hiddenCount !== 1 ? 's' : ''} hidden</span>
          )}
        </div>
      )}
    </div>
  )
}
