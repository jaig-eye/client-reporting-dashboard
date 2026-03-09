'use client'

import { motion } from 'framer-motion'

interface MetricCardProps {
  label: string
  value: string
  delta?: number
  sub?: string
  invertDelta?: boolean
  delay?: number
}

export default function MetricCard({ label, value, delta, sub, invertDelta, delay = 0 }: MetricCardProps) {
  const isGood = delta !== undefined
    ? (invertDelta ? delta <= 0 : delta >= 0)
    : null

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: delay * 0.06, ease: 'easeOut' }}
      className="card p-4"
    >
      <p className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>
        {label}
      </p>
      <p className="text-2xl font-bold leading-none mb-1" style={{ color: 'var(--text-primary)' }}>
        {value}
      </p>
      {sub && (
        <p className="text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>{sub}</p>
      )}
      {delta !== undefined && delta !== 0 && (
        <div
          className="flex items-center gap-0.5 text-xs font-medium"
          style={{ color: isGood ? 'var(--green)' : 'var(--red)' }}
        >
          <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
              d={delta > 0 ? 'M5 10l7-7m0 0l7 7m-7-7v18' : 'M19 14l-7 7m0 0l-7-7m7 7V3'}
            />
          </svg>
          {Math.abs(delta).toFixed(1)}% vs prior
        </div>
      )}
    </motion.div>
  )
}
