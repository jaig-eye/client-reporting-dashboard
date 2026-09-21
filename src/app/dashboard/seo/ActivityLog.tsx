'use client'

// The SEO Activity log: everything we've done for this client, in the order it happened.
//
// Four sources, one list — review replies we wrote, posts we shared, blog posts we published, and
// the off-platform work (backlinks, citations) someone entered by hand. They arrive already merged
// and sorted; this renders them and nothing else.
//
// Lifetime, not a date range, which is the point of the tab: the date picker is hidden on it. A
// client who has been with us two years has hundreds of entries, so the list opens at one year and
// grows a year at a time rather than dumping everything into the DOM at once.

import { useState, useMemo } from 'react'
import {
  ChatCenteredText, ShareNetwork, Article, LinkSimple, Star, ArrowSquareOut,
} from '@phosphor-icons/react'

export type ActivityKind = 'reply' | 'social' | 'post' | 'work'

export interface ActivityItem {
  id:      string
  kind:    ActivityKind
  /** ISO timestamp the work landed. Already resolved by the server; never null. */
  at:      string
  title:   string
  detail?: string | null
  url?:    string | null
  /** Small facts shown as a row of chips: the star rating, the platforms, the keyword. */
  chips?:  string[]
  stars?:  number | null
}

// Green for the links, blue for the writing, violet for social, amber for reviews. Only the first
// three tones exist as global tokens; --act-violet is defined on .act for both themes, the same
// way the old Overview scoped its own palette.
const KIND = {
  reply:  { icon: ChatCenteredText, label: 'Review reply', tint: 'var(--amber)',      bg: 'var(--amber-subtle)' },
  social: { icon: ShareNetwork,     label: 'Social post',  tint: 'var(--act-violet)', bg: 'var(--act-violet-subtle)' },
  post:   { icon: Article,          label: 'Blog post',    tint: 'var(--blue)',       bg: 'var(--blue-subtle)' },
  work:   { icon: LinkSimple,       label: 'SEO work',     tint: 'var(--green)',      bg: 'var(--green-subtle)' },
} as const

const FILTERS: { id: 'all' | ActivityKind; label: string }[] = [
  { id: 'all',    label: 'Everything' },
  { id: 'work',   label: 'SEO work' },
  { id: 'post',   label: 'Blog posts' },
  { id: 'social', label: 'Social posts' },
  { id: 'reply',  label: 'Review replies' },
]

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

const monthOf = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

/** A year of entries at a time, so a long-standing client doesn't render two years on first paint. */
const PAGE = 40

export default function ActivityLog({ items }: { items: ActivityItem[] }) {
  const [filter, setFilter] = useState<'all' | ActivityKind>('all')
  const [shown, setShown]   = useState(PAGE)

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length }
    for (const it of items) c[it.kind] = (c[it.kind] ?? 0) + 1
    return c
  }, [items])

  const filtered = useMemo(
    () => (filter === 'all' ? items : items.filter(i => i.kind === filter)),
    [items, filter])

  const visible = filtered.slice(0, shown)

  // A month heading appears above the first entry of each month.
  let lastMonth = ''

  return (
    <div className="act">
      <div className="act-filters" role="group" aria-label="Filter activity">
        {FILTERS.filter(f => (counts[f.id] ?? 0) > 0).map(f => (
          <button
            key={f.id}
            type="button"
            className="act-filter"
            aria-pressed={filter === f.id}
            onClick={() => { setFilter(f.id); setShown(PAGE) }}
          >
            {f.label}
            <span className="act-filter__n">{counts[f.id] ?? 0}</span>
          </button>
        ))}
      </div>

      <ol className="act-list">
        {visible.map(it => {
          const k = KIND[it.kind]
          const Icon = k.icon
          const month = monthOf(it.at)
          const heading = month !== lastMonth ? month : null
          lastMonth = month

          return (
            <li key={it.id} className="act-item">
              {heading && <h3 className="act-month">{heading}</h3>}
              <div className="act-row">
                <span className="act-icon" style={{ color: k.tint, background: k.bg }} aria-hidden>
                  <Icon size={14} weight="bold" />
                </span>
                <div className="act-body">
                  <div className="act-head">
                    <span className="act-kind" style={{ color: k.tint }}>{k.label}</span>
                    <time className="act-date" dateTime={it.at}>{fmtDate(it.at)}</time>
                  </div>
                  <p className="act-title">
                    {it.url
                      ? <a href={it.url} target="_blank" rel="noopener noreferrer" className="act-link">
                          {it.title}<ArrowSquareOut size={11} weight="bold" aria-hidden />
                        </a>
                      : it.title}
                  </p>
                  {it.detail && <p className="act-detail">{it.detail}</p>}
                  {(it.stars != null || (it.chips && it.chips.length > 0)) && (
                    <div className="act-chips">
                      {it.stars != null && (
                        <span className="act-chip act-chip--stars">
                          <Star size={11} weight="fill" aria-hidden />
                          {it.stars}
                          <span className="sr-only"> star review</span>
                        </span>
                      )}
                      {it.chips?.map(c => <span key={c} className="act-chip">{c}</span>)}
                    </div>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ol>

      {filtered.length > visible.length && (
        <button type="button" className="act-more" onClick={() => setShown(s => s + PAGE)}>
          Show {Math.min(PAGE, filtered.length - visible.length)} more
          <span className="act-more__n">{visible.length} of {filtered.length}</span>
        </button>
      )}
    </div>
  )
}
