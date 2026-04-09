// Skeleton loading placeholders — shimmer animation defined in globals.css

interface SkeletonProps {
  className?: string
  style?: React.CSSProperties
}

/** Base shimmer block — use className or style to set dimensions */
export function Skeleton({ className, style }: SkeletonProps) {
  return <div className={`skeleton ${className ?? ''}`} style={style} aria-hidden="true" />
}

/** Skeleton that matches a SparkMetricCard */
export function SkeletonMetricCard() {
  return (
    <div className="card" style={{ padding: '1.25rem' }} aria-hidden="true">
      {/* Label row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <Skeleton style={{ width: '40%', height: 10, borderRadius: 4 }} />
        <Skeleton style={{ width: 36, height: 18, borderRadius: 4 }} />
      </div>
      {/* Value */}
      <Skeleton style={{ width: '55%', height: 32, borderRadius: 4, marginBottom: 8 }} />
      {/* Sparkline area */}
      <Skeleton style={{ width: '100%', height: 52, borderRadius: 6 }} />
    </div>
  )
}

/** Skeleton for a generic card with N rows of text */
export function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <div className="card" style={{ padding: '1.25rem' }} aria-hidden="true">
      <Skeleton style={{ width: '50%', height: 12, borderRadius: 4, marginBottom: 14 }} />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton
          key={i}
          style={{
            width: `${75 + (i % 3) * 10}%`,
            height: 10,
            borderRadius: 4,
            marginBottom: i < rows - 1 ? 8 : 0,
          }}
        />
      ))}
    </div>
  )
}

/** Skeleton that matches a data-table */
export function SkeletonTable({ rows = 5, cols = 7 }: { rows?: number; cols?: number }) {
  return (
    <div aria-hidden="true">
      {/* Header row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: 12,
        padding: '0.5rem 1rem',
        borderBottom: '1px solid var(--border)',
        marginBottom: 4,
      }}>
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} style={{ height: 10, borderRadius: 3, width: i === 0 ? '70%' : '50%' }} />
        ))}
      </div>
      {/* Data rows */}
      {Array.from({ length: rows }).map((_, ri) => (
        <div
          key={ri}
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: 12,
            padding: '0.625rem 1rem',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          {Array.from({ length: cols }).map((_, ci) => (
            <Skeleton
              key={ci}
              style={{
                height: 12,
                borderRadius: 3,
                width: ci === 0 ? `${60 + (ri % 3) * 15}%` : `${40 + (ci % 4) * 10}%`,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Full-width chart area skeleton */
export function SkeletonChart({ height = 240 }: { height?: number }) {
  return (
    <div className="card" style={{ padding: '1.25rem' }} aria-hidden="true">
      <Skeleton style={{ width: '30%', height: 12, borderRadius: 4, marginBottom: 16 }} />
      <Skeleton style={{ width: '100%', height, borderRadius: 8 }} />
    </div>
  )
}
