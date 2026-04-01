'use client'

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

export default function SpendChart({
  data,
  priorData,
  colorSpend             = '#93c5fd',
  colorPriorSpend        = '#94a3b8',
  colorConversions       = '#059669',
  colorPriorConversions  = '#34d399',
}: {
  data:       DailyMetric[]
  priorData?: DailyMetric[]
  colorSpend?:            string
  colorPriorSpend?:       string
  colorConversions?:      string
  colorPriorConversions?: string
}) {
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
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart
        data={formatted}
        margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
        barCategoryGap={isCompare ? '18%' : '25%'}
        barGap={2}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: '#6b7280' }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          yAxisId="spend"
          orientation="left"
          tick={{ fontSize: 11, fill: '#6b7280' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={v => `$${v}`}
        />
        <YAxis
          yAxisId="conversions"
          orientation="right"
          tick={{ fontSize: 11, fill: '#6b7280' }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          formatter={(value: number, name: string) => {
            if (name === 'Spend' || name === 'Prior Spend') return [`$${value.toFixed(2)}`, name]
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
        <Legend wrapperStyle={{ fontSize: 12, color: '#6b7280' }} />

        {/* Current period spend bar */}
        <Bar
          yAxisId="spend"
          dataKey="spend"
          fill={colorSpend}
          opacity={0.65}
          radius={[3, 3, 0, 0]}
          name="Spend"
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
          name="Conversions"
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
