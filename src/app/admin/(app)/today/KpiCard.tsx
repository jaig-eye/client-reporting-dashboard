// One KPI on the Today page: a value, how it compares with the last period, and a small trend.
// Server component — only the sparkline itself is client-rendered.

import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowRight, Minus, TrendDown, TrendUp } from '@phosphor-icons/react/dist/ssr'
import Sparkline from '@/components/Sparkline'

/** good = green, bad = red, info = blue (a change that is neither good nor bad), neutral = grey. */
export type KpiTone = 'good' | 'bad' | 'info' | 'neutral'

export interface KpiDelta {
  text:      string
  direction: 'up' | 'down' | 'flat'
  tone:      KpiTone
  /** Full sentence for screen readers, e.g. "Up 12% vs last Monday". */
  label:     string
}

interface Props {
  href?:    string
  label:    string
  value:    ReactNode
  compare?: ReactNode
  delta?:   KpiDelta | null
  /** Oldest → newest. */
  spark?:   number[]
  /** 0–100 bar for rates, instead of a sparkline. */
  meter?:   { pct: number; tone: KpiTone }
  error?:   boolean
}

const SPARK_COLOR = 'var(--blue)'

function DeltaChip({ delta }: { delta: KpiDelta }) {
  const Icon = delta.direction === 'up' ? TrendUp : delta.direction === 'down' ? TrendDown : Minus
  return (
    <span className={`today-delta today-delta--${delta.tone}`} aria-label={delta.label} title={delta.label}>
      <Icon size={11} weight="bold" aria-hidden />
      {delta.text}
    </span>
  )
}

export default function KpiCard({ href, label, value, compare, delta, spark, meter, error }: Props) {
  const body = (
    <>
      <div className="today-kpi__top">
        <p className="today-kpi__label">{label}</p>
        {!error && delta && <DeltaChip delta={delta} />}
      </div>
      <p className="today-kpi__value">{error ? '–' : value}</p>
      <p className="today-kpi__compare">{error ? 'Couldn’t load' : compare}</p>
      <div className="today-kpi__viz" aria-hidden>
        {!error && meter && (
          <div className="today-meter">
            <div className={`today-meter__fill today-meter__fill--${meter.tone}`} style={{ width: `${Math.max(0, Math.min(100, meter.pct))}%` }} />
          </div>
        )}
        {!error && !meter && spark && spark.length > 1 && spark.some(v => v !== 0) && (
          <Sparkline data={spark.map(v => ({ v }))} color={SPARK_COLOR} height={36} />
        )}
      </div>
      {href && <ArrowRight className="today-kpi__go" size={12} weight="bold" aria-hidden />}
    </>
  )

  return href
    ? <Link href={href} className="card today-kpi today-kpi--link">{body}</Link>
    : <div className="card today-kpi">{body}</div>
}
