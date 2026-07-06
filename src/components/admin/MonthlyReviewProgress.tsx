'use client'

interface Props {
  approvedCount:  number
  totalPosts:     number
  clientsTotal:   number
  clientsDone:    number
  soundEnabled:   boolean
  onToggleSound:  () => void
  onExit:         () => void
  month:          string
}

export default function MonthlyReviewProgress({
  approvedCount,
  totalPosts,
  clientsTotal,
  clientsDone,
  soundEnabled,
  onToggleSound,
  onExit,
  month,
}: Props) {
  const pct = totalPosts > 0 ? Math.round((approvedCount / totalPosts) * 100) : 0

  return (
    <div style={{
      position:   'sticky',
      top:        0,
      zIndex:     40,
      background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--border)',
      boxShadow:  '0 2px 8px rgba(0,0,0,0.06)',
    }}>
      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px 8px' }}>
        <a href="/admin/content" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: 14, display: 'flex', alignItems: 'center', gap: 4 }}>
          ← Back
        </a>
        <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)', flex: 1 }}>
          Monthly Review — {month}
        </div>
        <button
          onClick={onToggleSound}
          className="btn btn-ghost btn-sm"
          title={soundEnabled ? 'Mute sounds' : 'Enable sounds'}
          style={{ fontSize: 16, padding: '4px 8px' }}
        >
          {soundEnabled ? '♪' : '♩'}
        </button>
        <button onClick={onExit} className="btn btn-secondary btn-sm">
          Exit Review
        </button>
      </div>

      {/* Progress row */}
      <div style={{ padding: '0 20px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, background: 'var(--bg-subtle)', borderRadius: 999, height: 8, overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            background: 'var(--green)',
            borderRadius: 999,
            width: `${pct}%`,
            transition: 'width 0.4s ease',
          }} />
        </div>
        <span style={{ fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {approvedCount} of {totalPosts} posts &nbsp;·&nbsp; {clientsDone} of {clientsTotal} clients
        </span>
      </div>
    </div>
  )
}
