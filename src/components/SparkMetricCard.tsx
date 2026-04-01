'use client'

import { motion } from 'framer-motion'
import Sparkline from './Sparkline'

interface BenchmarkBar {
  actual: number
  target: number
  actualLabel: string
  targetLabel: string
  color: string
}

interface Props {
  label: string
  value: string
  delta?: number
  invertDelta?: boolean
  sub?: string
  sparkData?: { v: number }[]
  sparkColor?: string
  benchmark?: BenchmarkBar
  delay?: number
}

export default function SparkMetricCard({
  label,
  value,
  delta,
  invertDelta = false,
  sub,
  sparkData,
  sparkColor = '#3b82f6',
  benchmark,
  delay = 0,
}: Props) {
  const isGood = delta !== undefined
    ? (invertDelta ? delta <= 0 : delta >= 0)
    : null

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: delay * 0.06, ease: 'easeOut' }}
      className="card p-5 flex flex-col gap-2"
    >
      {/* Label + delta badge */}
      <div className="flex items-start justify-between gap-2">
        <p
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: 'var(--text-muted)', letterSpacing: '0.05em' }}
        >
          {label}
        </p>
        {delta !== undefined && delta !== 0 && (
          <span
            className="text-xs font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
            style={{
              background: isGood ? 'var(--green-subtle)' : 'var(--red-subtle)',
              color:      isGood ? 'var(--green)'       : 'var(--red)',
            }}
          >
            {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>

      {/* Primary value */}
      <p className="text-[1.625rem] font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>
        {value}
      </p>
      {sub && (
        <p className="text-xs -mt-1" style={{ color: 'var(--text-muted)' }}>{sub}</p>
      )}

      {/* Sparkline */}
      {sparkData && sparkData.length > 1 && (
        <div style={{ margin: '2px -4px 0' }}>
          <Sparkline data={sparkData} color={sparkColor} height={52} />
        </div>
      )}

      {/* Benchmark comparison bar */}
      {benchmark && (
        <div className="space-y-1.5 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-subtle)' }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, (benchmark.actual / (benchmark.target || 1)) * 100)}%`,
                  backgroundColor: benchmark.color,
                }}
              />
            </div>
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)', flexShrink: 0, minWidth: 52, textAlign: 'right' }}>
              {benchmark.actualLabel}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 rounded-full" style={{ background: 'var(--border)' }} />
            <span className="text-xs" style={{ color: 'var(--text-faint)', flexShrink: 0, minWidth: 52, textAlign: 'right' }}>
              {benchmark.targetLabel} target
            </span>
          </div>
        </div>
      )}
    </motion.div>
  )
}
