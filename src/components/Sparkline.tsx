'use client'

import { AreaChart, Area, ResponsiveContainer } from 'recharts'

export default function Sparkline({
  data,
  color = '#3b82f6',
  height = 52,
}: {
  data: { v: number }[]
  color?: string
  height?: number
}) {
  if (!data || data.length < 2) return null
  // Sanitise gradient ID — strip non-alphanumeric chars
  const gradId = `spark-${color.replace(/[^a-z0-9]/gi, '')}`
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.22} />
            <stop offset="95%" stopColor={color} stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.75}
          fill={`url(#${gradId})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
