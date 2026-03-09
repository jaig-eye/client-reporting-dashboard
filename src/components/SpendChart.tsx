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

export default function SpendChart({ data }: { data: DailyMetric[] }) {
  if (!data.length) {
    return (
      <div className="h-64 flex items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>
        No data for this period
      </div>
    )
  }

  const formatted = data.map(d => ({
    ...d,
    date: d.date.slice(5),
    spend: Number(d.spend.toFixed(2)),
    conversions: Number(d.conversions.toFixed(1)),
  }))

  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={formatted} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} />
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
          formatter={(value: number, name: string) => [
            name === 'spend' ? `$${value.toFixed(2)}` : value,
            name === 'spend' ? 'Spend' : 'Conversions',
          ]}
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
        <Bar yAxisId="spend" dataKey="spend" fill="#2563eb" opacity={0.8} radius={[3, 3, 0, 0]} name="Spend" />
        <Line
          yAxisId="conversions"
          type="monotone"
          dataKey="conversions"
          stroke="#059669"
          strokeWidth={2}
          dot={false}
          name="Conversions"
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
