'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { TrendUp, TrendDown } from '@phosphor-icons/react'
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
  const prefersReduced = useReducedMotion()

  const isGood = delta !== undefined
    ? (invertDelta ? delta <= 0 : delta >= 0)
    : null

  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={prefersReduced ? {} : { duration: 0.25, delay: delay * 0.05, ease: [0.16, 1, 0.3, 1] }}
      className="card flex flex-col gap-2"
      style={{ padding: '1.25rem', overflow: 'hidden' }}
    >
      {/* Label + delta badge */}
      <div className="flex items-start justify-between gap-2">
        <p className="metric-label">{label}</p>
        {delta !== undefined && delta !== 0 && (
          <span
            className="badge flex-shrink-0 flex items-center gap-0.5"
            style={{
              background: isGood ? 'var(--green-subtle)' : 'var(--red-subtle)',
              color:      isGood ? 'var(--green)'        : 'var(--red)',
            }}
          >
            {delta > 0
              ? <TrendUp size={9} aria-hidden />
              : <TrendDown size={9} aria-hidden />
            }
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>

      {/* Primary value */}
      <p className="metric-value leading-tight">{value}</p>
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
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-subtle)' }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, (benchmark.actual / (benchmark.target || 1)) * 100)}%`,
                  backgroundColor: benchmark.color,
                  transition: 'width 0.5s ease',
                }}
              />
            </div>
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)', flexShrink: 0, minWidth: 52, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {benchmark.actualLabel}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full" style={{ background: 'var(--border)' }} />
            <span className="text-xs" style={{ color: 'var(--text-faint)', flexShrink: 0, minWidth: 52, textAlign: 'right' }}>
              {benchmark.targetLabel} target
            </span>
          </div>
        </div>
      )}
    </motion.div>
  )
}
