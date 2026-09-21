'use client'

import { useEffect, useState } from 'react'
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts'
import type { TooltipProps } from 'recharts'
import type { DailyMetric } from '@/lib/types'

/** True below the 640px (Tailwind `sm`) breakpoint. SSR / first paint assume desktop. */
export function useIsNarrow(query = '(max-width: 639px)') {
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
export function compactNum(v: number) {
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `${+(v / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000)     return `${+(v / 1_000).toFixed(1)}k`
  return `${+v.toFixed(abs < 10 && abs % 1 !== 0 ? 1 : 0)}`
}

/**
 * Nice, evenly spaced ticks from 0 to just above `max`, using exactly
 * `intervals` steps. Both axes share an interval count so the left and right
 * scales produce the same horizontal gridlines.
 */
export function niceTicks(max: number, intervals: number): number[] {
  const MULTIPLIERS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
  const target = Math.max(max, 0) * 1.04
  if (target <= 0) return Array.from({ length: intervals + 1 }, (_, i) => i)
  const p = Math.pow(10, Math.floor(Math.log10(target / intervals)))
  for (const m of MULTIPLIERS) {
    const step = m * p
    // Integer data (>= 3) shouldn't get fractional ticks like 2.5.
    if (max >= 3 && step % 1 !== 0) continue
    if (step * intervals >= target) {
      return Array.from({ length: intervals + 1 }, (_, i) => +(step * i).toFixed(6))
    }
  }
  const step = 10 * p
  return Array.from({ length: intervals + 1 }, (_, i) => +(step * i).toFixed(6))
}

/**
 * Evenly spaced x-axis tick indices that always include the first and last day.
 * Prefers a label count that divides the range exactly (uniform spacing, no
 * trailing gap); otherwise spreads labels as evenly as rounding allows.
 */
export function evenTickIndices(n: number, maxLabels: number): number[] {
  if (n <= maxLabels) return Array.from({ length: n }, (_, i) => i)
  const span = n - 1
  for (let labels = maxLabels; labels >= 4; labels--) {
    if (span % (labels - 1) === 0) {
      const step = span / (labels - 1)
      return Array.from({ length: labels }, (_, i) => i * step)
    }
  }
  // No exact divisor: step uniformly, then land on the last day. Rounding
  // fractional positions could put two labels on adjacent days.
  const step = Math.ceil(span / (maxLabels - 1))
  const idx: number[] = []
  for (let i = 0; i < span; i += step) idx.push(i)
  if (span - idx[idx.length - 1] < step * 0.6) idx.pop()
  idx.push(span)
  return idx
}

type Row = {
  date:              string
  spend:             number
  conversions:       number
  priorSpend?:       number
  priorConversions?: number
  priorDate?:        string
}

const GRID_STROKE     = 'var(--border-subtle)'
const BASELINE_STROKE = 'var(--border)'
const AXIS_TEXT       = 'var(--text-muted)'

/**
 * Daily performance: primary series (spend / sessions / profile views) as bars
 * on the left axis, secondary series (conversions / clicks) as a line on the
 * right axis, in one combined plot. Both scales start at 0 so the bars and the
 * line are anchored to the same baseline.
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
  priorSpendLabel,
  priorConversionsLabel,
  variant                = 'currency',
  height: heightProp,
}: {
  data:       DailyMetric[]
  priorData?: DailyMetric[]
  colorSpend?:            string
  colorPriorSpend?:       string
  colorConversions?:      string
  colorPriorConversions?: string
  spendLabel?:            string
  conversionsLabel?:      string
  /** Override the plot height. Omitted, it stays 300 on a desktop and 260 on a phone. */
  height?: number
  /** Defaults to `Prior ${spendLabel}` — e.g. "Prior Leads" on a CRM page. */
  priorSpendLabel?:       string
  /** Defaults to `Prior ${conversionsLabel}` — e.g. "Prior Calls" on a CRM page. */
  priorConversionsLabel?: string
  /** 'currency' formats as $n.nn (default); 'count' formats as a plain integer */
  variant?:               'currency' | 'count'
}) {
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
  // Prior-period names follow the series names unless overridden.
  const priorSpendName       = priorSpendLabel       ?? `Prior ${spendLabel}`
  const priorConversionsName = priorConversionsLabel ?? `Prior ${conversionsLabel}`

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

  const maxSpend = Math.max(0, ...formatted.map(r => Math.max(r.spend, r.priorSpend ?? 0)))
  const maxConv  = Math.max(0, ...formatted.map(r => Math.max(r.conversions, r.priorConversions ?? 0)))

  // Same interval count on both axes => one set of horizontal gridlines that
  // is true for the left and the right scale alike.
  const intervals  = isNarrow ? 3 : 4
  const spendTicks = niceTicks(maxSpend, intervals)
  const convTicks  = niceTicks(maxConv, intervals)
  const spendDomain: [number, number] = [0, spendTicks[spendTicks.length - 1]]
  const convDomain:  [number, number] = [0, convTicks[convTicks.length - 1]]

  const fontSize = isNarrow ? 10 : 11
  const charPx   = isNarrow ? 6.2 : 6.6
  const widthFor = (labels: string[], min: number) =>
    Math.max(min, Math.ceil(Math.max(...labels.map(l => l.length)) * charPx) + 10)
  const leftWidth  = widthFor(spendTicks.map(spendAxisFormatter), isNarrow ? 30 : 40)
  // Phones: the right axis still scales the line, but reserves no width — the
  // legend and tooltip carry the conversions numbers.
  const rightWidth = widthFor(convTicks.map(convAxisFormatter), 30)

  const height = heightProp ?? (isNarrow ? 260 : 300)
  const margin = isNarrow
    // Right margin leaves room for the centred last date label.
    ? { top: 8, right: 14, bottom: 0, left: 0 }
    : { top: 8, right: 8, bottom: 0, left: 0 }

  // Evenly spaced dates, always including the first and last day.
  const xTicks = evenTickIndices(formatted.length, isNarrow ? 5 : 16).map(i => formatted[i].date)

  const yTick  = { fontSize, fill: AXIS_TEXT }
  const cursor = { stroke: 'var(--text-faint)', strokeWidth: 1, strokeDasharray: '3 3' }

  const legendItems: { label: string; color: string; kind: 'bar' | 'line' | 'dashed' }[] = [
    { label: spendLabel, color: colorSpend, kind: 'bar' },
    ...(isCompare ? [{ label: priorSpendName, color: colorPriorSpend, kind: 'bar' as const }] : []),
    { label: conversionsLabel, color: colorConversions, kind: 'line' },
    ...(isCompare ? [{ label: priorConversionsName, color: colorPriorConversions, kind: 'dashed' as const }] : []),
  ]

  const renderTooltip = ({ active, payload, label }: TooltipProps<number, string>) => {
    if (!active || !payload?.length) return null
    const row = payload[0]?.payload as Row | undefined
    if (!row) return null
    const lines: { name: string; color: string; value: string }[] = [
      { name: spendLabel, color: colorSpend, value: spendFormatter(row.spend) },
      ...(isCompare && row.priorSpend != null
        ? [{ name: priorSpendName, color: colorPriorSpend, value: spendFormatter(row.priorSpend) }] : []),
      { name: conversionsLabel, color: colorConversions, value: row.conversions.toLocaleString() },
      ...(isCompare && row.priorConversions != null
        ? [{ name: priorConversionsName, color: colorPriorConversions, value: row.priorConversions.toLocaleString() }] : []),
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
      {/* Single legend for both series */}
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2"
        style={{ fontSize: isNarrow ? 11 : 12, color: 'var(--text-muted)', paddingLeft: leftWidth + margin.left }}
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

      <ResponsiveContainer width="100%" height={height} minHeight={isNarrow ? 220 : 260}>
        <ComposedChart
          data={formatted}
          margin={margin}
          barCategoryGap={isCompare ? '18%' : '25%'}
          barGap={2}
        >
          <CartesianGrid vertical={false} stroke={GRID_STROKE} />
          <XAxis
            dataKey="date"
            height={isNarrow ? 26 : 28}
            tickMargin={8}
            tick={{ fontSize, fill: AXIS_TEXT }}
            tickLine={false}
            axisLine={{ stroke: BASELINE_STROKE }}
            ticks={xTicks}
            interval={0}
          />
          <YAxis
            yAxisId="spend"
            orientation="left"
            width={leftWidth}
            domain={spendDomain}
            ticks={spendTicks}
            interval={0}
            tick={yTick}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => spendAxisFormatter(v)}
          />
          <YAxis
            yAxisId="conversions"
            orientation="right"
            width={rightWidth}
            domain={convDomain}
            ticks={convTicks}
            interval={0}
            tick={yTick}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => convAxisFormatter(v)}
            // Phones: keep the scale, drop the ticks so the plot stays readable.
            hide={isNarrow}
          />
          {/* Anchors both scales at a visible zero baseline. */}
          <ReferenceLine yAxisId="spend" y={0} stroke={BASELINE_STROKE} />
          <Tooltip
            content={renderTooltip}
            cursor={cursor}
            wrapperStyle={{ zIndex: 20, outline: 'none' }}
            isAnimationActive={false}
          />

          {/* Current period primary series */}
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

          {/* Prior period primary series */}
          {isCompare && (
            <Bar
              yAxisId="spend"
              dataKey="priorSpend"
              fill={colorPriorSpend}
              opacity={0.7}
              radius={[3, 3, 0, 0]}
              name={priorSpendName}
              maxBarSize={12}
              isAnimationActive={false}
            />
          )}

          {/* Current secondary series */}
          <Line
            yAxisId="conversions"
            type="monotone"
            dataKey="conversions"
            stroke={colorConversions}
            strokeWidth={isNarrow ? 2 : 2.5}
            dot={isNarrow || formatted.length > 45 ? false : { fill: colorConversions, r: 2, strokeWidth: 0 }}
            activeDot={{ r: 4, strokeWidth: 0 }}
            name={conversionsLabel}
            isAnimationActive={false}
          />

          {/* Prior secondary series — dashed */}
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
              name={priorConversionsName}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
