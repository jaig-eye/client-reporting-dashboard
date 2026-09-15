'use client'

// Cost vs leads by day: ad spend stacked by platform (bars, left axis) with leads as a line
// (right axis). Both axes start at zero and share one set of gridlines, like SpendChart.

import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts'
import type { TooltipProps } from 'recharts'
import { useIsNarrow, compactNum, niceTicks, evenTickIndices } from '@/components/SpendChart'

/** leads is null for days the CRM has not synced yet, so the line stops instead of dropping to zero. */
export interface CostLeadsDay { date: string; google: number; meta: number; leads: number | null }

const GRID = 'var(--border-subtle)'
const BASE = 'var(--border)'
const AXIS = 'var(--text-muted)'

export default function CostLeadsChart({
  data, leadsLabel, showGoogle, showMeta,
}: { data: CostLeadsDay[]; leadsLabel: string; showGoogle: boolean; showMeta: boolean }) {
  const isNarrow = useIsNarrow()
  if (data.length < 2) return null

  const rows = data.map(d => ({ ...d, label: d.date.slice(5) }))
  const maxSpend = Math.max(0, ...rows.map(r => (showGoogle ? r.google : 0) + (showMeta ? r.meta : 0)))
  const maxLeads = Math.max(0, ...rows.map(r => r.leads ?? 0))
  const intervals  = isNarrow ? 3 : 4
  const spendTicks = niceTicks(maxSpend, intervals)
  const leadTicks  = niceTicks(maxLeads, intervals)
  const money = (v: number) => (isNarrow ? `$${compactNum(v)}` : `$${Math.round(v).toLocaleString()}`)
  const fontSize  = isNarrow ? 10 : 11
  const charPx    = isNarrow ? 6.2 : 6.6
  const leftWidth = Math.max(isNarrow ? 30 : 40, Math.ceil(Math.max(...spendTicks.map(t => money(t).length)) * charPx) + 10)
  const xTicks    = evenTickIndices(rows.length, isNarrow ? 5 : 12).map(i => rows[i].label)
  const googleRadius = (showMeta ? [0, 0, 0, 0] : [3, 3, 0, 0]) as [number, number, number, number]

  const legend: { label: string; color: string; kind: 'bar' | 'line' }[] = [
    ...(showGoogle ? [{ label: 'Google Ads spend', color: 'var(--blue)', kind: 'bar' as const }] : []),
    ...(showMeta   ? [{ label: 'Meta Ads spend',   color: 'var(--ov-indigo)', kind: 'bar' as const }] : []),
    { label: leadsLabel, color: 'var(--green)', kind: 'line' },
  ]

  const tooltip = ({ active, payload, label }: TooltipProps<number, string>) => {
    if (!active || !payload?.length) return null
    const r = payload[0]?.payload as (typeof rows)[number] | undefined
    if (!r) return null
    const lines = [
      ...(showGoogle ? [{ name: 'Google Ads', color: 'var(--blue)', value: `$${r.google.toFixed(2)}` }] : []),
      ...(showMeta   ? [{ name: 'Meta Ads',   color: 'var(--ov-indigo)', value: `$${r.meta.toFixed(2)}` }] : []),
      { name: leadsLabel, color: 'var(--green)', value: r.leads == null ? 'Not synced yet' : r.leads.toLocaleString() },
    ]
    return (
      <div className="ov2-tip">
        <div className="ov2-tip__date">{label}</div>
        {lines.map(l => (
          <div key={l.name} className="ov2-tip__row">
            <span className="ov2-tip__swatch" style={{ background: l.color }} />
            <span className="ov2-tip__name">{l.name}</span>
            <span className="ov2-tip__val">{l.value}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div>
      <div className="ov2-legend" style={{ paddingLeft: leftWidth }}>
        {legend.map(l => (
          <span key={l.label} className="ov2-legend__item">
            <span className={l.kind === 'bar' ? 'ov2-legend__bar' : 'ov2-legend__line'} style={{ background: l.color }} />
            {l.label}
          </span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={isNarrow ? 240 : 280}>
        <ComposedChart data={rows} margin={{ top: 8, right: isNarrow ? 14 : 8, bottom: 0, left: 0 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" ticks={xTicks} interval={0} tick={{ fontSize, fill: AXIS }} tickLine={false} tickMargin={8}
            axisLine={{ stroke: BASE }} />
          <YAxis yAxisId="spend" width={leftWidth} domain={[0, spendTicks[spendTicks.length - 1]]} ticks={spendTicks} interval={0}
            tick={{ fontSize, fill: AXIS }} tickLine={false} axisLine={false} tickFormatter={(v: number) => money(v)} />
          <YAxis yAxisId="leads" orientation="right" width={30} domain={[0, leadTicks[leadTicks.length - 1]]} ticks={leadTicks}
            interval={0} tick={{ fontSize, fill: AXIS }} tickLine={false} axisLine={false}
            tickFormatter={(v: number) => compactNum(v)} hide={isNarrow} />
          <ReferenceLine yAxisId="spend" y={0} stroke={BASE} />
          <Tooltip content={tooltip} cursor={{ fill: 'var(--bg-subtle)' }} wrapperStyle={{ zIndex: 20, outline: 'none' }}
            isAnimationActive={false} />
          {showGoogle && (
            <Bar yAxisId="spend" dataKey="google" stackId="spend" fill="var(--blue)" fillOpacity={0.75} maxBarSize={22}
              radius={googleRadius} isAnimationActive={false} />
          )}
          {showMeta && (
            <Bar yAxisId="spend" dataKey="meta" stackId="spend" fill="var(--ov-indigo)" fillOpacity={0.7} maxBarSize={22}
              radius={[3, 3, 0, 0]} isAnimationActive={false} />
          )}
          <Line yAxisId="leads" type="monotone" dataKey="leads" stroke="var(--green)" strokeWidth={isNarrow ? 2 : 2.5}
            dot={isNarrow || rows.length > 45 ? false : { r: 2, strokeWidth: 0, fill: 'var(--green)' }}
            activeDot={{ r: 4, strokeWidth: 0 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
