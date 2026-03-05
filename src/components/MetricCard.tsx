'use client'

import { motion } from 'framer-motion'
import { scoreColor } from '@/lib/agency-settings'

interface MetricCardProps {
  label: string
  value: string
  delta?: number
  sub?: string
  invertDelta?: boolean
  benchmarkPct?: number  // 0–100+ percent of benchmark target
  delay?: number         // stagger delay index (0, 1, 2, …)
}

export default function MetricCard({ label, value, delta, sub, invertDelta, benchmarkPct, delay = 0 }: MetricCardProps) {
  const isGood = delta !== undefined
    ? (invertDelta ? delta <= 0 : delta >= 0)
    : null

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: delay * 0.07, ease: 'easeOut' }}
      className="rounded-2xl border p-4"
      style={{
        background: 'rgba(255,255,255,0.025)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderColor: 'rgba(255,255,255,0.07)',
      }}
    >
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">{label}</p>
      <p className="text-2xl font-bold text-white leading-none mb-1">{value}</p>
      {sub && <p className="text-xs text-slate-500 mb-1.5">{sub}</p>}
      {delta !== undefined && delta !== 0 && (
        <div className={`flex items-center gap-0.5 text-xs font-medium ${
          isGood ? 'text-emerald-400' : 'text-red-400'
        }`}>
          <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
              d={delta > 0 ? 'M5 10l7-7m0 0l7 7m-7-7v18' : 'M19 14l-7 7m0 0l-7-7m7 7V3'}
            />
          </svg>
          {Math.abs(delta).toFixed(1)}% vs prior
        </div>
      )}
      {benchmarkPct !== undefined && benchmarkPct > 0 && (
        <div
          className="mt-1.5 text-[10px] font-medium"
          style={{ color: scoreColor(Math.min(benchmarkPct, 100)) }}
        >
          {benchmarkPct}% of target
        </div>
      )}
    </motion.div>
  )
}
