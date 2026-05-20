'use client'

export interface StatusCounts {
  scheduled:  number
  approved:   number
  generating: number
  forReview:  number
  published:  number
  rejected:   number
}

export function computeStatusCounts(
  topics: { status: string }[],
  posts:  { status: string }[]
): StatusCounts {
  return {
    scheduled:  topics.filter(t => t.status === 'pending' || t.status === 'scheduled').length,
    approved:   topics.filter(t => t.status === 'approved').length,
    generating: topics.filter(t => t.status === 'generating').length,
    forReview:  posts.filter(p => p.status === 'for_review' || p.status === 'generated').length,
    published:  posts.filter(p => p.status === 'draft_saved' || p.status === 'published').length,
    rejected:   [...topics, ...posts].filter(x => x.status === 'rejected').length,
  }
}

const STATUS_CONFIG: { key: keyof StatusCounts; label: string; dot: string; pulse: boolean }[] = [
  { key: 'scheduled',  label: 'Pending',    dot: '#f59e0b', pulse: false },
  { key: 'approved',   label: 'Approved',   dot: '#2563eb', pulse: false },
  { key: 'generating', label: 'Generating', dot: '#f97316', pulse: true  },
  { key: 'forReview',  label: 'For Review', dot: '#10b981', pulse: false },
  { key: 'published',  label: 'Published',  dot: '#059669', pulse: false },
  { key: 'rejected',   label: 'Rejected',   dot: '#ef4444', pulse: false },
]

export default function ContentStatusBar({ counts }: { counts: StatusCounts }) {
  const hasGenerating = counts.generating > 0
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
      {hasGenerating && (
        <style>{`@keyframes csb-pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
      )}
      {STATUS_CONFIG.map(({ key, label, dot, pulse }) => {
        const count = counts[key]
        if (key === 'rejected' && count === 0) return null
        return (
          <span
            key={key}
            style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.8125rem', opacity: count === 0 ? 0.4 : 1 }}
          >
            <span style={{
              width: 8, height: 8, borderRadius: '50%', background: dot,
              display: 'inline-block', flexShrink: 0,
              ...(pulse && count > 0 ? { animation: 'csb-pulse 1.5s ease-in-out infinite' } : {}),
            }} />
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{count}</span>
            <span style={{ color: 'var(--text-faint)' }}>{label}</span>
          </span>
        )
      })}
    </div>
  )
}
