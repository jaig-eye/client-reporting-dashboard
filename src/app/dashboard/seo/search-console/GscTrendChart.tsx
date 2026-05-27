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

export interface GscDailyPoint {
  date:        string
  clicks:      number
  impressions: number
  ctr:         number
}

function fmtTick(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return n.toLocaleString()
}

export default function GscTrendChart({
  data,
  colorClicks      = '#93c5fd',
  colorImpressions = '#94a3b8',
}: {
  data:              GscDailyPoint[]
  colorClicks?:      string
  colorImpressions?: string
}) {
  if (!data.length) return null

  const interval = Math.max(1, Math.ceil(data.length / 12)) - 1

  function Tip({ active, payload, label }: {
    active?:  boolean
    payload?: Array<{ name: string; value: number; color: string }>
    label?:   string
  }) {
    if (!active || !payload?.length) return null
    const pt = data.find(d => d.date === label)
    return (
      <div style={{
        background: '#fff', border: '1px solid var(--border,#e5e7eb)',
        borderRadius: 8, padding: '8px 12px', fontSize: '0.78rem',
        boxShadow: '0 2px 8px rgba(0,0,0,.08)',
      }}>
        <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
          {label ? fmtTick(label) : ''}
        </p>
        {payload.map(p => (
          <p key={p.name} style={{ color: p.color, margin: '2px 0' }}>
            {p.name}: <strong>{fmtNum(p.value)}</strong>
          </p>
        ))}
        {pt && (
          <p style={{ color: '#94a3b8', margin: '2px 0' }}>
            CTR: <strong>{(pt.ctr * 100).toFixed(2)}%</strong>
          </p>
        )}
      </div>
    )
  }

  return (
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border,#e5e7eb)" vertical={false} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: 'var(--text-faint,#9ca3af)' }}
            interval={interval}
            tickFormatter={fmtTick}
          />
          <YAxis
            yAxisId="l"
            orientation="left"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: 'var(--text-faint,#9ca3af)' }}
            tickFormatter={fmtNum}
            width={44}
          />
          <YAxis
            yAxisId="r"
            orientation="right"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: 'var(--text-faint,#9ca3af)' }}
            tickFormatter={fmtNum}
            width={50}
          />
          <Tooltip content={<Tip />} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '0.72rem', paddingTop: 6 }} />
          <Bar
            yAxisId="l"
            dataKey="clicks"
            name="Clicks"
            fill={colorClicks}
            radius={[3, 3, 0, 0]}
            maxBarSize={24}
          />
          <Line
            yAxisId="r"
            type="monotone"
            dataKey="impressions"
            name="Impressions"
            stroke={colorImpressions}
            strokeWidth={2}
            strokeDasharray="4 2"
            dot={false}
            activeDot={{ r: 4 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
