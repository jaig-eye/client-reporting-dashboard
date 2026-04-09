'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { TrendUp, TrendDown } from '@phosphor-icons/react'

interface MetricCardProps {
  label: string
  value: string
  delta?: number
  sub?: string
  invertDelta?: boolean
  delay?: number
}

export default function MetricCard({ label, value, delta, sub, invertDelta, delay = 0 }: MetricCardProps) {
  const prefersReduced = useReducedMotion()

  const isGood = delta !== undefined
    ? (invertDelta ? delta <= 0 : delta >= 0)
    : null

  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={prefersReduced ? {} : { duration: 0.25, delay: delay * 0.05, ease: [0.16, 1, 0.3, 1] }}
      className="card"
      style={{ padding: '1.25rem' }}
    >
      <p className="metric-label mb-2">{label}</p>
      <p className="metric-value mb-1">{value}</p>
      {sub && (
        <p className="text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>{sub}</p>
      )}
      {delta !== undefined && delta !== 0 && (
        <div
          className="flex items-center gap-1"
          style={{
            fontSize: '0.75rem',
            fontWeight: 500,
            color: isGood ? 'var(--green)' : 'var(--red)',
          }}
        >
          {delta > 0
            ? <TrendUp size={13} aria-hidden />
            : <TrendDown size={13} aria-hidden />
          }
          {Math.abs(delta).toFixed(1)}% vs prior
        </div>
      )}
    </motion.div>
  )
}
