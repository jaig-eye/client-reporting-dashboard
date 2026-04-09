import Link from 'next/link'
import { ArrowUp, ArrowDown } from '@phosphor-icons/react'

interface ChannelSourceCardProps {
  title: string
  color: string
  icon: React.ReactNode
  metrics: { label: string; value: string; delta?: number }[]
  href: string
}

export default function ChannelSourceCard({ title, color, icon, metrics, href }: ChannelSourceCardProps) {
  return (
    <Link
      href={href}
      aria-label={`View ${title} report`}
      style={{ textDecoration: 'none', display: 'block', height: '100%' }}
    >
      <div
        className="card card-hover"
        style={{
          borderLeft: `3px solid ${color}`,
          borderRadius: '0.625rem',
          padding: '14px 16px',
          cursor: 'pointer',
          height: '100%',
          transition: 'border-color 0.15s, box-shadow 0.15s',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <span style={{ color, display: 'flex', alignItems: 'center', flexShrink: 0 }} aria-hidden>
            {icon}
          </span>
          <span className="section-label" style={{ color: 'var(--text-primary)' }}>
            {title}
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', color: 'var(--text-faint)' }} aria-hidden>
            <ArrowUp size={10} style={{ transform: 'rotate(45deg)' }} />
          </span>
        </div>

        {/* Metrics */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {metrics.map((m, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{m.label}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{
                  fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {m.value}
                </span>
                {m.delta !== undefined && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 1,
                    fontSize: '0.6875rem', fontWeight: 600,
                    color: m.delta > 0 ? 'var(--green)' : m.delta < 0 ? 'var(--red)' : 'var(--text-faint)',
                  }}>
                    {m.delta > 0
                      ? <ArrowUp size={8} aria-hidden />
                      : <ArrowDown size={8} aria-hidden />
                    }
                    {Math.abs(m.delta).toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Link>
  )
}
