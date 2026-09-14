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
  Legend,
} from 'recharts'
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
  const spendFormatter = variant === 'count'
    ? (v: number) => v.toLocaleString()
    : (v: number) => `$${v.toFixed(2)}`
  const isNarrow = useIsNarrow()
  // Phones: compact left-axis labels so the axis doesn't eat the plot area.
  const axisFormatter = isNarrow
    ? (v: number) => (variant === 'count' ? compactNum(v) : `$${compactNum(v)}`)
    : spendFormatter
  if (!data.length) {
    return (
      <div className="h-64 flex items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>
        No data for this period
      </div>
    )
  }

  const isCompare = !!(priorData && priorData.length > 0)

  // Merge current + prior by index so bars align side-by-side per day slot.
  const formatted = data.map((d, i) => ({
    date:        d.date.slice(5),
    spend:       Number(d.spend.toFixed(2)),
    conversions: Number(d.conversions.toFixed(1)),
    ...(isCompare && priorData![i] ? {
      priorSpend:       Number(priorData![i].spend.toFixed(2)),
      priorConversions: Number(priorData![i].conversions.toFixed(1)),
      priorDate:        priorData![i].date.slice(5),
    } : {}),
  }))

  return (
    <ResponsiveContainer width="100%" height={280} minHeight={240}>
      <ComposedChart
        data={formatted}
        margin={isNarrow ? { top: 4, right: 4, bottom: 0, left: -4 } : { top: 4, right: 16, bottom: 0, left: 0 }}
        barCategoryGap={isCompare ? '18%' : '25%'}
        barGap={2}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: isNarrow ? 10 : 11, fill: '#6b7280' }}
          tickLine={false}
          axisLine={false}
          {...(isNarrow ? { interval: 'preserveStartEnd' as const, minTickGap: 28 } : {})}
        />
        <YAxis
          yAxisId="spend"
          orientation="left"
          tick={{ fontSize: isNarrow ? 10 : 11, fill: '#6b7280' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={v => axisFormatter(v)}
          {...(isNarrow ? { width: 40, tickCount: 4 } : {})}
        />
        <YAxis
          yAxisId="conversions"
          orientation="right"
          tick={{ fontSize: 11, fill: '#6b7280' }}
          tickLine={false}
          axisLine={false}
          // Phones: keep the axis for scaling the line but reserve no width for
          // its ticks — the legend + tooltip identify the values.
          hide={isNarrow}
        />
        <Tooltip
          formatter={(value: number, name: string) => {
            if (name === spendLabel || name === 'Prior Spend') return [spendFormatter(value), name]
            return [value, name]
          }}
          labelFormatter={(label, payload) => {
            if (isCompare && payload?.[0]) {
              const priorDate = payload[0].payload?.priorDate
              if (priorDate) return `${label} vs ${priorDate}`
            }
            return label
          }}
          contentStyle={{
            fontSize: 12,
            borderRadius: 8,
            border: '1px solid #e5e7eb',
            backgroundColor: '#ffffff',
            color: '#111827',
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          }}
          cursor={{ fill: 'rgba(0,0,0,0.03)' }}
        />
        <Legend wrapperStyle={{ fontSize: isNarrow ? 11 : 12, color: '#6b7280' }} />

        {/* Current period spend bar */}
        <Bar
          yAxisId="spend"
          dataKey="spend"
          fill={colorSpend}
          opacity={0.65}
          radius={[3, 3, 0, 0]}
          name={spendLabel}
          maxBarSize={isCompare ? 12 : 24}
        />

        {/* Prior period spend bar */}
        {isCompare && (
          <Bar
            yAxisId="spend"
            dataKey="priorSpend"
            fill={colorPriorSpend}
            opacity={0.7}
            radius={[3, 3, 0, 0]}
            name="Prior Spend"
            maxBarSize={12}
          />
        )}

        {/* Current conversions line */}
        <Line
          yAxisId="conversions"
          type="monotone"
          dataKey="conversions"
          stroke={colorConversions}
          strokeWidth={3}
          dot={{ fill: colorConversions, r: 2, strokeWidth: 0 }}
          activeDot={{ r: 5, strokeWidth: 0 }}
          name={conversionsLabel}
        />

        {/* Prior conversions line — dashed */}
        {isCompare && (
          <Line
            yAxisId="conversions"
            type="monotone"
            dataKey="priorConversions"
            stroke={colorPriorConversions}
            strokeWidth={1.5}
            strokeDasharray="5 4"
            dot={false}
            name="Prior Conversions"
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}
