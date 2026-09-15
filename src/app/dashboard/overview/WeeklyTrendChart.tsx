'use client'

// 12 weeks of leads, with calls and forms as quieter dashed lines underneath. The most recent
// week gets a marker so the eye lands on "where are we now".
// ComposedChart, not AreaChart: AreaChart silently drops <Line> children.

import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceDot,
} from 'recharts'
import type { TooltipProps } from 'recharts'
import { useIsNarrow, compactNum, niceTicks } from '@/components/SpendChart'

export interface WeekPoint { week: string; label: string; leads: number; calls: number; forms: number }

const SERIES = [
  { key: 'leads', name: 'Leads', color: 'var(--blue)' },
  { key: 'calls', name: 'Calls', color: 'var(--green)' },
  { key: 'forms', name: 'Forms', color: 'var(--ov-violet)' },
] as const

export default function WeeklyTrendChart({ data }: { data: WeekPoint[] }) {
  const isNarrow = useIsNarrow()
  if (data.length < 2) return null

  const max      = Math.max(0, ...data.map(d => Math.max(d.leads, d.calls, d.forms)))
  const ticks    = niceTicks(max, isNarrow ? 3 : 4)
  const fontSize = isNarrow ? 10 : 11
  const last     = data[data.length - 1]

  const tooltip = ({ active, payload }: TooltipProps<number, string>) => {
    if (!active || !payload?.length) return null
    const r = payload[0]?.payload as WeekPoint | undefined
    if (!r) return null
    return (
      <div className="ov2-tip">
        <div className="ov2-tip__date">Week of {r.label}</div>
        {SERIES.map(s => (
          <div key={s.key} className="ov2-tip__row">
            <span className="ov2-tip__swatch" style={{ background: s.color }} />
            <span className="ov2-tip__name">{s.name}</span>
            <span className="ov2-tip__val">{r[s.key].toLocaleString()}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div role="figure" aria-label={`Leads per week over the last ${data.length} weeks. Most recent week: ${last.leads} leads, ${last.calls} calls, ${last.forms} forms.`}>
      <div className="ov2-legend">
        {SERIES.map(s => (
          <span key={s.key} className="ov2-legend__item">
            <span
              className={s.key === 'leads' ? 'ov2-legend__line' : 'ov2-legend__line ov2-legend__line--dashed'}
              style={s.key === 'leads' ? { background: s.color } : { color: s.color }}
            />
            {s.name}
          </span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={isNarrow ? 200 : 240}>
        <ComposedChart data={data} margin={{ top: 10, right: isNarrow ? 14 : 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="ov2-weekly-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--blue)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--blue)" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border-subtle)" />
          <XAxis dataKey="label" tick={{ fontSize, fill: 'var(--text-muted)' }} tickLine={false} tickMargin={8}
            axisLine={{ stroke: 'var(--border)' }} interval={isNarrow ? 2 : 1} />
          <YAxis width={isNarrow ? 28 : 34} domain={[0, ticks[ticks.length - 1]]} ticks={ticks} interval={0}
            tick={{ fontSize, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false}
            tickFormatter={(v: number) => compactNum(v)} />
          <Tooltip content={tooltip} cursor={{ stroke: 'var(--text-faint)', strokeDasharray: '3 3' }}
            wrapperStyle={{ zIndex: 20, outline: 'none' }} isAnimationActive={false} />
          <Area type="monotone" dataKey="leads" stroke="var(--blue)" strokeWidth={2.5} fill="url(#ov2-weekly-fill)"
            dot={false} activeDot={{ r: 4, strokeWidth: 0 }} isAnimationActive={false} />
          <Line type="monotone" dataKey="calls" stroke="var(--green)" strokeWidth={1.5} strokeDasharray="5 4" dot={false}
            isAnimationActive={false} />
          <Line type="monotone" dataKey="forms" stroke="var(--ov-violet)" strokeWidth={1.5} strokeDasharray="5 4" dot={false}
            isAnimationActive={false} />
          <ReferenceDot x={last.label} y={last.leads} r={4.5} fill="var(--blue)" stroke="var(--bg-surface)" strokeWidth={2} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
