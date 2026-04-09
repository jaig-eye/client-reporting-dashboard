// Ahrefs Summary Card — stub component shown when ahrefs connector type is active.
// No data fetch — displays "Coming Soon" state inside the ConnectionSummaryCard shell.

import ConnectionSummaryCard from './ConnectionSummaryCard'
import { LinkSimple } from '@phosphor-icons/react/dist/ssr'

export default function AhrefsSummaryCard() {
  return (
    <ConnectionSummaryCard
      title="Authority (Ahrefs)"
      icon={<LinkSimple size={18} />}
      accentColor="#f59e0b"
      href="/dashboard/seo/authority"
      hasData={true}
    >
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '1rem',
      }}>
        {[
          { label: 'Domain Rating',     value: '—' },
          { label: 'Backlinks',         value: '—' },
          { label: 'Organic Keywords',  value: '—' },
        ].map(m => (
          <div key={m.label}>
            <p className="metric-label mb-1">{m.label}</p>
            <p style={{
              fontSize: '1.25rem', fontWeight: 700,
              color: 'var(--text-faint)',
              letterSpacing: '-0.01em',
            }}>
              {m.value}
            </p>
          </div>
        ))}
      </div>
      <p style={{
        marginTop: '0.75rem',
        fontSize: '0.75rem',
        color: 'var(--text-faint)',
        fontStyle: 'italic',
      }}>
        Sync pending — Ahrefs integration coming soon.
      </p>
    </ConnectionSummaryCard>
  )
}
