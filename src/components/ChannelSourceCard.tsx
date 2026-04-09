import Link from 'next/link'

interface ChannelSourceCardProps {
  title: string
  color: string
  icon: string
  metrics: { label: string; value: string; delta?: number }[]
  href: string
}

export default function ChannelSourceCard({ title, color, icon, metrics, href }: ChannelSourceCardProps) {
  return (
    <Link href={href} style={{ textDecoration: 'none', display: 'block' }}>
      <div
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderLeft: `3px solid ${color}`,
          borderRadius: 8,
          padding: '14px 16px',
          cursor: 'pointer',
          height: '100%',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <span style={{ fontSize: '0.85rem', color }}>{icon}</span>
          <span style={{
            fontSize: '0.7rem', fontWeight: 700,
            color: 'var(--text-primary)',
            letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>
            {title}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--text-faint)', opacity: 0.7 }}>→</span>
        </div>

        {/* Metrics */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {metrics.map((m, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{m.label}</span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>{m.value}</span>
                {m.delta !== undefined && (
                  <span style={{
                    fontSize: '0.65rem', fontWeight: 600,
                    color: m.delta > 0 ? 'var(--green)' : m.delta < 0 ? 'var(--red)' : 'var(--text-faint)',
                  }}>
                    {m.delta > 0 ? '▲' : '▼'}{Math.abs(m.delta).toFixed(1)}%
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
