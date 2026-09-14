'use client'

import { useEffect, useId, useState } from 'react'
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import type { TooltipProps } from 'recharts'
import type { DailyMetric } from '@/lib/types'

/** True below the 640px (Tailwind `sm`) breakpoint. SSR / first paint assume desktop. */
function useIsNarrow(query = '(max-width: 639px)') {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia(query)
    const update = () => setNarrow(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [query])
  return narrow
}

/** 1234 -> 1.2k, 1500000 -> 1.5M — keeps the y-axis narrow on phones. */
function compactNum(v: number) {
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `${+(v / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000)     return `${+(v / 1_000).toFixed(1)}k`
  return `${+v.toFixed(abs < 10 && abs % 1 !== 0 ? 1 : 0)}`
}

type Row = {
  date:              string
  spend:             number
  conversions:       number
  priorSpend?:       number
  priorConversions?: number
  priorDate?:        string
}

const GRID_STROKE = 'var(--border-subtle)'
const AXIS_TEXT   = 'var(--text-muted)'

/**
 * Two stacked charts sharing one x-axis: primary series (spend / sessions /
 * profile views) as bars on top, secondary series (conversions / clicks) as a
 * line below. Each has its own y-axis, so no arbitrary dual-scale crossings.
 * Hover is synced across both via `syncId`.
 */
export default function SpendChart({
  data,
  priorData,
  colorSpend             = '#93c5fd',
  colorPriorSpend        = '#94a3b8',
  colorConversions       = '#059669',
  colorPriorConversions  = '#34d399',
  spendLabel             = 'Spend',
  conversionsLabel       = 'Conversions',
  variant                = 'currency',
}: {
  data:       DailyMetric[]
  priorData?: DailyMetric[]
  colorSpend?:            string
  colorPriorSpend?:       string
  colorConversions?:      string
  colorPriorConversions?: string
  spendLabel?:            string
  conversionsLabel?:      string
  /** 'currency' formats as $n.nn (default); 'count' formats as a plain integer */
  variant?:               'currency' | 'count'
}) {
  const syncId   = `spend-chart-${useId()}`
  const isNarrow = useIsNarrow()

  if (!data.length) {
    return (
      <div className="h-64 flex items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>
        No data for this period
      </div>
    )
  }

  const spendFormatter = variant === 'count'
    ? (v: number) => v.toLocaleString()
    : (v: number) => `$${v.toFixed(2)}`
  // Phones: compact axis labels so the axis doesn't eat the plot area.
  const spendAxisFormatter = isNarrow
    ? (v: number) => (variant === 'count' ? compactNum(v) : `$${compactNum(v)}`)
    : spendFormatter
  const convAxisFormatter = isNarrow
    ? (v: number) => compactNum(v)
    : (v: number) => v.toLocaleString()

  const isCompare = !!(priorData && priorData.length > 0)
  const priorSpendLabel       = 'Prior Spend'
  const priorConversionsLabel = 'Prior Conversions'

  // Merge current + prior by index so bars align side-by-side per day slot.
  const formatted: Row[] = data.map((d, i) => ({
    date:        d.date.slice(5),
    spend:       Number(d.spend.toFixed(2)),
    conversions: Number(d.conversions.toFixed(1)),
    ...(isCompare && priorData![i] ? {
      priorSpend:       Number(priorData![i].spend.toFixed(2)),
      priorConversions: Number(priorData![i].conversions.toFixed(1)),
      priorDate:        priorData![i].date.slice(5),
    } : {}),
  }))

  // Both charts must reserve the SAME y-axis width or their plot areas (and so
  // the days) won't line up vertically. Estimate from the widest label.
  const maxSpend = Math.max(0, ...formatted.map(r => Math.max(r.spend, r.priorSpend ?? 0)))
  const maxConv  = Math.max(0, ...formatted.map(r => Math.max(r.conversions, r.priorConversions ?? 0)))
  const fontSize = isNarrow ? 10 : 11
  const charPx   = isNarrow ? 6 : 6.6
  // Round up to a "nice" ceiling so the top tick label is represented.
  const niceCeil = (v: number) => {
    if (v <= 0) return 0
    const p = Math.pow(10, Math.floor(Math.log10(v)))
    return Math.ceil(v / p) * p
  }
  const labelLen = Math.max(
    spendAxisFormatter(niceCeil(maxSpend)).length,
    convAxisFormatter(niceCeil(maxConv)).length,
  )
  const yAxisWidth = Math.max(isNarrow ? 30 : 40, Math.ceil(labelLen * charPx) + 10)

  const margin = isNarrow
    ? { top: 6, right: 4, bottom: 0, left: 0 }
    : { top: 8, right: 12, bottom: 0, left: 0 }

  const topHeight    = isNarrow ? 180 : 220
  // Bottom plot area ≈ 38% of the top; add room for the date labels.
  const xAxisHeight  = isNarrow ? 26 : 28
  const bottomHeight = Math.round(topHeight * 0.38) + xAxisHeight

  const tickCount = isNarrow ? 4 : 5
  const yTick = { fontSize, fill: AXIS_TEXT }
  const cursor = { stroke: 'var(--text-faint)', strokeWidth: 1, strokeDasharray: '3 3' }

  const legendItems: { label: string; color: string; kind: 'bar' | 'line' | 'dashed' }[] = [
    { label: spendLabel, color: colorSpend, kind: 'bar' },
    ...(isCompare ? [{ label: priorSpendLabel, color: colorPriorSpend, kind: 'bar' as const }] : []),
    { label: conversionsLabel, color: colorConversions, kind: 'line' },
    ...(isCompare ? [{ label: priorConversionsLabel, color: colorPriorConversions, kind: 'dashed' as const }] : []),
  ]

  const renderTooltip = ({ active, payload, label }: TooltipProps<number, string>) => {
    if (!active || !payload?.length) return null
    const row = payload[0]?.payload as Row | undefined
    if (!row) return null
    const lines: { name: string; color: string; value: string }[] = [
      { name: spendLabel, color: colorSpend, value: spendFormatter(row.spend) },
      ...(isCompare && row.priorSpend != null
        ? [{ name: priorSpendLabel, color: colorPriorSpend, value: spendFormatter(row.priorSpend) }] : []),
      { name: conversionsLabel, color: colorConversions, value: row.conversions.toLocaleString() },
      ...(isCompare && row.priorConversions != null
        ? [{ name: priorConversionsLabel, color: colorPriorConversions, value: row.priorConversions.toLocaleString() }] : []),
    ]
    return (
      <div
        style={{
          fontSize: 12,
          borderRadius: 8,
          border: '1px solid var(--border)',
          backgroundColor: 'var(--bg-elevated)',
          color: 'var(--text-primary)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
          padding: '8px 10px',
          minWidth: 140,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 4 }}>
          {isCompare && row.priorDate ? `${label} vs ${row.priorDate}` : label}
        </div>
        {lines.map(l => (
          <div key={l.name} style={{ display: 'flex', alignItems: 'center', gap: 6, lineHeight: '18px' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: l.color, flexShrink: 0 }} />
            <span style={{ color: 'var(--text-muted)' }}>{l.name}</span>
            <span style={{ marginLeft: 'auto', paddingLeft: 12, fontVariantNumeric: 'tabular-nums' }}>{l.value}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div>
      {/* Shared legend for both charts */}
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2"
        style={{ fontSize: isNarrow ? 11 : 12, color: 'var(--text-muted)', paddingLeft: yAxisWidth + margin.left }}
      >
        {legendItems.map(item => (
          <span key={item.label} className="inline-flex items-center gap-1.5">
            {item.kind === 'bar' ? (
              <span style={{ width: 10, height: 10, borderRadius: 2, background: item.color, opacity: 0.8 }} />
            ) : (
              <svg width="16" height="10" aria-hidden="true">
                <line
                  x1="1" y1="5" x2="15" y2="5"
                  stroke={item.color}
                  strokeWidth={item.kind === 'line' ? 3 : 1.5}
                  strokeDasharray={item.kind === 'dashed' ? '4 3' : undefined}
                  strokeLinecap="round"
                />
              </svg>
            )}
            {item.label}
          </span>
        ))}
      </div>

      {/* Top: primary series as bars */}
      <ResponsiveContainer width="100%" height={topHeight} minHeight={160}>
        <ComposedChart
          data={formatted}
          syncId={syncId}
          margin={margin}
          barCategoryGap={isCompare ? '18%' : '25%'}
          barGap={2}
        >
          <CartesianGrid vertical={false} stroke={GRID_STROKE} />
          {/* Same categories as the bottom chart; ticks hidden, no reserved height. */}
          <XAxis dataKey="date" hide scale="band" />
          <YAxis
            yAxisId="spend"
            width={yAxisWidth}
            tick={yTick}
            tickLine={false}
            axisLine={false}
            tickCount={tickCount}
            tickFormatter={v => spendAxisFormatter(v)}
          />
          <Tooltip
            content={renderTooltip}
            cursor={cursor}
            position={{ y: 0 }}
            wrapperStyle={{ zIndex: 20, outline: 'none' }}
            isAnimationActive={false}
          />
          <Bar
            yAxisId="spend"
            dataKey="spend"
            fill={colorSpend}
            opacity={0.65}
            radius={[3, 3, 0, 0]}
            name={spendLabel}
            maxBarSize={isCompare ? 12 : 24}
            isAnimationActive={false}
          />
          {isCompare && (
            <Bar
              yAxisId="spend"
              dataKey="priorSpend"
              fill={colorPriorSpend}
              opacity={0.7}
              radius={[3, 3, 0, 0]}
              name={priorSpendLabel}
              maxBarSize={12}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {/* Bottom: secondary series as a line, owns the date labels */}
      <ResponsiveContainer width="100%" height={bottomHeight} minHeight={isNarrow ? 84 : 96}>
        <ComposedChart data={formatted} syncId={syncId} margin={{ ...margin, top: 16 }}>
          <CartesianGrid vertical={false} stroke={GRID_STROKE} />
          <XAxis
            dataKey="date"
            // Band scale (like the bar chart above) so points sit at bar centres.
            scale="band"
            height={xAxisHeight}
            tickMargin={8}
            tick={{ fontSize, fill: AXIS_TEXT }}
            tickLine={false}
            axisLine={{ stroke: GRID_STROKE }}
            interval="preserveStartEnd"
            minTickGap={isNarrow ? 28 : 16}
          />
          <YAxis
            yAxisId="conversions"
            width={yAxisWidth}
            tick={yTick}
            tickLine={false}
            axisLine={false}
            tickCount={3}
            allowDecimals={maxConv < 3}
            tickFormatter={v => convAxisFormatter(v)}
          />
          {/* Cursor only — the combined tooltip renders on the top chart. */}
          <Tooltip content={() => null} cursor={cursor} isAnimationActive={false} />
          <Line
            yAxisId="conversions"
            type="monotone"
            dataKey="conversions"
            stroke={colorConversions}
            strokeWidth={isNarrow ? 2 : 2.5}
            dot={formatted.length > 45 ? false : { fill: colorConversions, r: 2, strokeWidth: 0 }}
            activeDot={{ r: 4, strokeWidth: 0 }}
            name={conversionsLabel}
            isAnimationActive={false}
          />
          {isCompare && (
            <Line
              yAxisId="conversions"
              type="monotone"
              dataKey="priorConversions"
              stroke={colorPriorConversions}
              strokeWidth={1.5}
              strokeDasharray="5 4"
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0 }}
              name={priorConversionsLabel}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
