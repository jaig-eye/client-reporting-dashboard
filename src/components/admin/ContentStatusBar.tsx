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

// One colour per kind of state, from the theme: amber needs someone, blue is on its way, green is
// on the site, red was turned down. The word always sits beside the dot.
const STATUS_CONFIG: { key: keyof StatusCounts; label: string; tone: string; pulse: boolean }[] = [
  { key: 'scheduled',  label: 'Pending',    tone: 'var(--amber)', pulse: false },
  { key: 'approved',   label: 'Approved',   tone: 'var(--blue)',  pulse: false },
  { key: 'generating', label: 'Generating', tone: 'var(--blue)',  pulse: true  },
  { key: 'forReview',  label: 'For review', tone: 'var(--amber)', pulse: false },
  { key: 'published',  label: 'Published',  tone: 'var(--green)', pulse: false },
  { key: 'rejected',   label: 'Rejected',   tone: 'var(--red)',   pulse: false },
]

export default function ContentStatusBar({ counts, total }: { counts: StatusCounts; total?: number }) {
  return (
    <div className="pl-statusbar" role="list" aria-label="Items by status">
      {STATUS_CONFIG.map(({ key, label, tone, pulse }) => {
        const count = counts[key]
        if (key === 'rejected' && count === 0) return null
        return (
          <span key={key} role="listitem" className={`pl-statusbar-item${count === 0 ? ' pl-statusbar-item--zero' : ''}`}>
            <span className={`pl-statusbar-dot${pulse && count > 0 ? ' pl-statusbar-dot--live' : ''}`} style={{ '--tone': tone } as React.CSSProperties} aria-hidden />
            <b>{count}</b> {label}
          </span>
        )
      })}
      {total != null && <span className="pl-statusbar-total">{total} item{total === 1 ? '' : 's'}</span>}
    </div>
  )
}
