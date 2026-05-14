// Shared wrapper for connection summary cards shown on the dashboard cockpit.
// Each channel-specific card (GA4, GSC, GBP, Ahrefs) uses this as its shell.

import Link from 'next/link'
import { ArrowUpRight } from '@phosphor-icons/react/dist/ssr'
import { SkeletonCard } from '@/components/Skeleton'

interface ConnectionSummaryCardProps {
  title: string
  icon: React.ReactNode
  accentColor: string   // left border color
  href: string          // "View full report →" link
  loading?: boolean
  hasData?: boolean
  children: React.ReactNode
}

export default function ConnectionSummaryCard({
  title,
  icon,
  accentColor,
  href,
  loading,
  hasData,
  children,
}: ConnectionSummaryCardProps) {
  return (
    <div
      className="card"
      style={{
        borderLeft: `3px solid ${accentColor}`,
        padding: '1.25rem',
        opacity:    hasData === false ? 0.55 : 1,
        filter:     hasData === false ? 'grayscale(0.6)' : 'none',
        transition: 'opacity 0.2s, filter 0.2s',
      }}
    >
      {/* Card header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '1rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: accentColor, display: 'flex', alignItems: 'center' }} aria-hidden>
            {icon}
          </span>
          <span className="section-label" style={{ color: 'var(--text-primary)', fontSize: '0.75rem' }}>
            {title}
          </span>
        </div>
        <Link
          href={href}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: '0.75rem',
            fontWeight: 500,
            color: 'var(--blue)',
            textDecoration: 'none',
          }}
          onMouseEnter={undefined}
        >
          View full report
          <ArrowUpRight size={12} aria-hidden />
        </Link>
      </div>

      {/* Content area */}
      {loading ? (
        <SkeletonCard rows={3} />
      ) : !hasData ? (
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-faint)', padding: '0.5rem 0' }}>
          No data available for this period.
        </p>
      ) : (
        children
      )}
    </div>
  )
}
