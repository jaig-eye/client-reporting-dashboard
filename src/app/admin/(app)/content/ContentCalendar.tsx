'use client'

// The content calendar: four months at a time, every client's posts and topics grouped by month
// and then by client. A card shows its date, its status and its title; when it has a rationale,
// the title opens it. Topics still being written refresh the page every 10 seconds.

import { useState, useEffect } from 'react'
import { useRouter }           from 'next/navigation'
import Link                    from 'next/link'
import { ArrowSquareOut, CaretDown, CaretLeft, CaretRight, CalendarBlank, GearSix, Plus } from '@phosphor-icons/react'
import RationaleModal          from '@/components/admin/RationaleModal'
import NewPostModal            from '@/components/admin/NewPostModal'
import { SHOW_NON_BLOG_CONTENT_TYPES } from '@/lib/content/featureFlags'
import StatusBadge, { type StatusTone } from '@/components/ui/StatusBadge'
import EmptyState              from '@/components/ui/EmptyState'
import { PillTabs }            from '@/components/ui/PillTabs'

export type CalendarItem = {
  id:               string
  type:             'topic' | 'post'
  contentType?:     string
  clientId:         string
  clientName:       string
  status:           string
  targetPublishDate: string | null
  topicText:        string | null
  title:            string | null
  targetKeyword:    string | null
  wpPostId:         number | null
  wpSiteUrl:        string | null
  publishedUrl:     string | null
  rationale:        string | null
  competitionLevel: string | null
  generationError:  string | null
  keywordOpportunity: string | null
  rankingStrategy:    string | null
  audienceIntent:     string | null
  whyNow:             string | null
  suggestedTitle:     string | null
  searchVolume:       number | null
  keywordDifficulty:  number | null
  clusterGroup:       string | null
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// One word per state, the same in the filter and on the card. Amber needs someone, blue is on its
// way, green is on the client's site, red was turned down.
const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  pending:     { label: 'Pending',    tone: 'warning' },
  scheduled:   { label: 'Approved',   tone: 'info'    },
  approved:    { label: 'Approved',   tone: 'info'    },
  generating:  { label: 'Generating', tone: 'info'    },
  generated:   { label: 'For review', tone: 'warning' },
  for_review:  { label: 'For review', tone: 'warning' },
  draft_saved: { label: 'On site',    tone: 'success' },
  published:   { label: 'Published',  tone: 'success' },
  rejected:    { label: 'Rejected',   tone: 'danger'  },
}
const statusOf = (s: string) => STATUS[s] ?? { label: s.replace(/_/g, ' '), tone: 'neutral' as StatusTone }

const FILTERS = [
  { id: 'all',         label: 'All'        },
  { id: 'approved',    label: 'Approved'   },
  { id: 'for_review',  label: 'For review' },
  { id: 'draft_saved', label: 'On site'    },
  { id: 'rejected',    label: 'Rejected'   },
]

function shortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function isPast(dateStr: string): boolean {
  return new Date(dateStr + 'T00:00:00') < new Date(new Date().toDateString())
}

const isOnSite = (i: CalendarItem) => i.status === 'draft_saved' || i.status === 'published'

// Group calendar items by client, ordered by client name — used to sub-group
// each month section so the timeline is easier to scan per client.
function groupByClient(items: CalendarItem[]): [string, CalendarItem[]][] {
  const m = new Map<string, CalendarItem[]>()
  for (const it of items) {
    const arr = m.get(it.clientId) ?? []
    arr.push(it)
    m.set(it.clientId, arr)
  }
  return Array.from(m.entries()).sort((a, b) =>
    (a[1][0]?.clientName ?? '').localeCompare(b[1][0]?.clientName ?? '')
  )
}

// A month's cards, in a group per client.
function ClientGroupedCards({ items, onViewRationale }: { items: CalendarItem[]; onViewRationale: (i: CalendarItem) => void }) {
  return (
    <div className="cal-clients">
      {groupByClient(items).map(([cid, clientItems]) => {
        const name = clientItems[0]?.clientName ?? 'Unknown client'
        return (
          <div key={cid}>
            <div className="cal-client-head">
              <Link href={`/admin/clients/${cid}?tab=content`} className="cal-client-name">{name}</Link>
              <Link href={`/admin/clients/${cid}?tab=content&subtab=settings`} className="cal-client-gear" title={`${name}’s content settings`} aria-label={`${name}’s content settings`}>
                <GearSix size={13} aria-hidden />
              </Link>
              <span className="cal-client-count">{clientItems.length}</span>
            </div>
            <div className="cal-grid">
              {clientItems.map(item => <ContentCard key={item.id} item={item} onViewRationale={onViewRationale} />)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MonthHeading({ name, count, unit, open, onToggle, controls }: {
  name: string; count: string; unit?: string; open: boolean; onToggle?: () => void; controls?: string
}) {
  const inner = (
    <>
      {onToggle && <CaretDown size={14} weight="bold" aria-hidden />}
      <span className="cal-month-name">{name}</span>
      <span className="cal-month-rule" aria-hidden />
      <span className="cal-month-count">{count}{unit ? ` ${unit}` : ''}</span>
    </>
  )
  return onToggle
    ? <button type="button" className="cal-month-head" aria-expanded={open} aria-controls={controls} onClick={onToggle}>{inner}</button>
    : <div className="cal-month-head" style={{ cursor: 'default' }}>{inner}</div>
}

export default function ContentCalendar({
  items: initialItems,
  clients,
}: {
  items:   CalendarItem[]
  clients: { id: string; name: string }[]
}) {
  const router   = useRouter()
  const today    = new Date()

  const [windowStart,    setWindowStart]    = useState({ year: today.getFullYear(), month: today.getMonth() })
  const [clientFilter,   setClientFilter]   = useState<string>('all')
  const [statusFilter,   setStatusFilter]   = useState<string>('all')
  const [items,          setItems]          = useState(initialItems)
  const [rationaleFor,   setRationaleFor]   = useState<CalendarItem | null>(null)
  const [activeCalView,  setActiveCalView]  = useState<'blog' | 'service'>('blog')
  const [showNewPost,    setShowNewPost]    = useState(false)
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(() => {
    // Auto-collapse fully-published past months
    const nowKey = `${today.getFullYear()}-${String(today.getMonth()).padStart(2, '0')}`
    const collapsed = new Set<string>()
    const byKey = new Map<string, CalendarItem[]>()
    for (const item of initialItems) {
      if (!item.targetPublishDate) continue
      const d   = new Date(item.targetPublishDate + 'T00:00:00')
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`
      byKey.set(key, [...(byKey.get(key) ?? []), item])
    }
    for (const [key, monthItems] of Array.from(byKey)) {
      if (key >= nowKey) continue // only collapse past months
      if (monthItems.every(isOnSite)) collapsed.add(key)
    }
    return collapsed
  })

  const toggleMonthCollapse = (key: string) => {
    setCollapsedMonths(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else               next.add(key)
      return next
    })
  }

  useEffect(() => { setItems(initialItems) }, [initialItems])

  useEffect(() => {
    const hasGenerating = items.some(i => i.type === 'topic' && i.status === 'generating')
    if (!hasGenerating) return
    const interval = setInterval(() => router.refresh(), 10_000)
    return () => clearInterval(interval)
  }, [items, router])

  const prevWindow = () => {
    setWindowStart(w => w.month === 0
      ? { year: w.year - 1, month: 11 }
      : { year: w.year, month: w.month - 1 })
  }
  const nextWindow = () => {
    setWindowStart(w => w.month === 11
      ? { year: w.year + 1, month: 0 }
      : { year: w.year, month: w.month + 1 })
  }
  const resetToday = () => setWindowStart({ year: today.getFullYear(), month: today.getMonth() })
  const atToday = windowStart.year === today.getFullYear() && windowStart.month === today.getMonth()

  // Build 4-month window keys
  const windowMonths: { year: number; month: number; key: string }[] = []
  for (let i = 0; i < 4; i++) {
    let m = windowStart.month + i
    let y = windowStart.year
    if (m > 11) { m -= 12; y += 1 }
    windowMonths.push({ year: y, month: m, key: `${y}-${String(m).padStart(2, '0')}` })
  }
  const windowKeys = new Set(windowMonths.map(w => w.key))
  const last = windowMonths[3]
  const windowLabel = windowStart.year === last.year
    ? `${MONTH_SHORT[windowStart.month]} – ${MONTH_SHORT[last.month]} ${last.year}`
    : `${MONTH_SHORT[windowStart.month]} ${windowStart.year} – ${MONTH_SHORT[last.month]} ${last.year}`

  function matchesStatus(item: CalendarItem): boolean {
    if (statusFilter === 'approved')    return ['approved', 'generating', 'generated'].includes(item.status)
    if (statusFilter === 'for_review')  return item.status === 'for_review'
    if (statusFilter === 'draft_saved') return isOnSite(item)
    if (statusFilter === 'rejected')    return item.status === 'rejected'
    return item.status !== 'rejected'   // 'all' hides rejected ones
  }

  // Filter items
  const filtered = items.filter(item => {
    if (!item.targetPublishDate) return false
    const d   = new Date(item.targetPublishDate + 'T00:00:00')
    const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`
    if (!windowKeys.has(key)) return false
    if (clientFilter !== 'all' && item.clientId !== clientFilter) return false
    return matchesStatus(item)
  })

  // Unscheduled items (no date)
  const unscheduled = items.filter(item => {
    if (item.targetPublishDate) return false
    if (clientFilter !== 'all' && item.clientId !== clientFilter) return false
    return matchesStatus(item)
  })

  // Stats
  const activeMonths  = new Set(filtered.map(i => {
    const d = new Date(i.targetPublishDate! + 'T00:00:00')
    return `${d.getFullYear()}-${d.getMonth()}`
  })).size
  const uniqueClients = new Set([...filtered, ...unscheduled].map(i => i.clientId)).size
  // Split by contentType
  const blogFiltered = filtered.filter(i => !i.contentType || i.contentType === 'blog')
  const saFiltered   = filtered.filter(i => i.contentType === 'service_area')
  const total        = filtered.length + unscheduled.length

  // Group by month — sorted by date within each month
  function groupByMonth(items: CalendarItem[]) {
    const map = new Map<string, CalendarItem[]>()
    for (const item of items) {
      const d   = new Date(item.targetPublishDate! + 'T00:00:00')
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`
      const arr = map.get(key) ?? []
      arr.push(item)
      map.set(key, arr)
    }
    // Sort within each month by targetPublishDate ascending
    for (const [key, arr] of Array.from(map)) {
      arr.sort((a: CalendarItem, b: CalendarItem) => (a.targetPublishDate ?? '').localeCompare(b.targetPublishDate ?? ''))
      map.set(key, arr)
    }
    return map
  }

  const byMonth   = groupByMonth(blogFiltered)
  const saByMonth = groupByMonth(saFiltered)

  const needReview = items.filter(i => i.status === 'for_review' || (i.type === 'post' && i.status === 'pending')).length
  const unscheduledBlog = unscheduled.filter(i => !i.contentType || i.contentType === 'blog')
  const unscheduledSa   = unscheduled.filter(i => i.contentType === 'service_area')
  const showTypeSwitch  = SHOW_NON_BLOG_CONTENT_TYPES && (saFiltered.length > 0 || unscheduledSa.length > 0)
  const filterName      = FILTERS.find(f => f.id === statusFilter)?.label.toLowerCase()

  return (
    <div>
      {/* ── Controls ─────────────────────────────────────────────────────────── */}
      <div className="cal-bar">
        <div className="cal-window">
          <button type="button" onClick={prevWindow} className="mr-nav" aria-label="Earlier months"><CaretLeft size={16} weight="bold" /></button>
          <span className="cal-window-label" aria-live="polite">{windowLabel}</span>
          <button type="button" onClick={nextWindow} className="mr-nav" aria-label="Later months"><CaretRight size={16} weight="bold" /></button>
          {!atToday && <button type="button" onClick={resetToday} className="btn btn-secondary btn-sm" style={{ marginLeft: 4 }}>This month</button>}
        </div>

        <select className="input" value={clientFilter} onChange={e => setClientFilter(e.target.value)} aria-label="Client">
          <option value="all">All clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <PillTabs items={FILTERS} activeId={statusFilter} onSelect={setStatusFilter} label="Status" />

        <span className="cal-spacer" />

        {/* Manual "pick a day + prompt" single-post generation */}
        <button type="button" onClick={() => setShowNewPost(true)} className="btn btn-primary">
          <Plus size={15} weight="bold" aria-hidden />New post
        </button>
      </div>

      <p className="cal-summary">
        {total === 0 ? 'Nothing matches these filters.' : <>
          {total} post{total === 1 ? '' : 's'} and topic{total === 1 ? '' : 's'}
          {activeMonths > 0 && <> across {activeMonths} month{activeMonths === 1 ? '' : 's'}</>}, for {uniqueClients} client{uniqueClients === 1 ? '' : 's'}.
        </>}
      </p>

      {/* ── View switcher (only when SA content exists and non-blog types are on) ── */}
      {showTypeSwitch && (
        <div style={{ marginBottom: 18 }}>
          <PillTabs
            label="Content type"
            activeId={activeCalView}
            onSelect={id => setActiveCalView(id as 'blog' | 'service')}
            items={[
              { id: 'blog',    label: 'Blog posts',         count: blogFiltered.length + unscheduledBlog.length },
              { id: 'service', label: 'Service area pages', count: saFiltered.length + unscheduledSa.length },
            ]}
          />
        </div>
      )}

      {/* ── "Needs review" callout ───────────────────────────────────────────── */}
      {statusFilter === 'all' && needReview > 0 && (
        <div className="ui-notice ui-notice--warning">
          <span>{needReview} post{needReview === 1 ? ' needs' : 's need'} approval.</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setStatusFilter('for_review')}>Show posts for review</button>
        </div>
      )}

      {/* ── Month sections ───────────────────────────────────────────────────── */}
      {total === 0 ? (
        <div className="card">
          <EmptyState
            icon={<CalendarBlank size={22} weight="duotone" />}
            title={statusFilter === 'all' && clientFilter === 'all' ? 'Nothing scheduled in these months' : 'Nothing matches these filters'}
            actions={statusFilter !== 'all' || clientFilter !== 'all'
              ? <button type="button" className="btn btn-secondary" onClick={() => { setStatusFilter('all'); setClientFilter('all') }}>Show everything</button>
              : undefined}
          >
            {statusFilter !== 'all'
              ? `No ${filterName} posts or topics between ${windowLabel}.`
              : 'Try later months, or add a post by hand with New post.'}
          </EmptyState>
        </div>
      ) : (
        <div className="cal-months">

          {/* ── Blog posts ── */}
          {activeCalView === 'blog' && <>
            {windowMonths.map(({ year, month, key }) => {
              const monthItems  = byMonth.get(key) ?? []
              if (monthItems.length === 0) return null
              const isCollapsed = collapsedMonths.has(key)
              const onSite      = monthItems.filter(isOnSite).length
              return (
                <section key={key} aria-label={`${MONTH_NAMES[month]} ${year}`}>
                  <MonthHeading
                    name={`${MONTH_NAMES[month]} ${year}`}
                    count={isCollapsed ? `${onSite} on site` : `${monthItems.length}`}
                    unit={isCollapsed ? undefined : monthItems.length === 1 ? 'post' : 'posts'}
                    open={!isCollapsed}
                    onToggle={() => toggleMonthCollapse(key)}
                    controls={`cal-${key}`}
                  />
                  {!isCollapsed && (
                    <div id={`cal-${key}`}><ClientGroupedCards items={monthItems} onViewRationale={setRationaleFor} /></div>
                  )}
                </section>
              )
            })}
            {unscheduledBlog.length > 0 && (
              <section aria-label="Not scheduled" className="cal-month--quiet">
                <MonthHeading name="Not scheduled" count={`${unscheduledBlog.length}`} open />
                <ClientGroupedCards items={unscheduledBlog} onViewRationale={setRationaleFor} />
              </section>
            )}
          </>}

          {/* ── Service area pages ── */}
          {activeCalView === 'service' && <>
            {windowMonths.map(({ year, month, key }) => {
              const monthItems = saByMonth.get(key) ?? []
              if (monthItems.length === 0) return null
              return (
                <section key={key} aria-label={`${MONTH_NAMES[month]} ${year}`}>
                  <MonthHeading name={`${MONTH_NAMES[month]} ${year}`} count={`${monthItems.length}`} unit={monthItems.length === 1 ? 'page' : 'pages'} open />
                  <div className="cal-grid">
                    {monthItems.map(item => <ContentCard key={item.id} item={item} onViewRationale={setRationaleFor} showClient />)}
                  </div>
                </section>
              )
            })}
            {unscheduledSa.length > 0 && (
              <section aria-label="Pages not scheduled" className="cal-month--quiet">
                <MonthHeading name="Pages not scheduled" count={`${unscheduledSa.length}`} open />
                <div className="cal-grid">
                  {unscheduledSa.map(item => <ContentCard key={item.id} item={item} onViewRationale={setRationaleFor} showClient />)}
                </div>
              </section>
            )}
          </>}

        </div>
      )}

      {/* ── Rationale modal ───────────────────────────────────────────────────── */}
      <RationaleModal item={rationaleFor} onClose={() => setRationaleFor(null)} />

      {/* ── New Post modal (manual pick-a-day generation) ─────────────────────── */}
      {showNewPost && (
        <NewPostModal
          clients={clients}
          onClose={() => setShowNewPost(false)}
          onCreated={() => router.refresh()}
        />
      )}
    </div>
  )
}

function ContentCard({
  item,
  onViewRationale,
  showClient,
}: {
  item:            CalendarItem
  onViewRationale: (item: CalendarItem) => void
  /** Service area pages aren't grouped by client, so their cards name it. */
  showClient?:     boolean
}) {
  const status       = statusOf(item.status)
  const past         = item.targetPublishDate ? isPast(item.targetPublishDate) : false
  const title        = item.type === 'post'
    ? (item.title ?? item.targetKeyword ?? 'Untitled post')
    : (item.topicText ?? item.targetKeyword ?? 'Untitled topic')
  const hasRationale = !!(item.rationale || item.keywordOpportunity)
  const isSA         = item.contentType === 'service_area'

  return (
    <article className={`cal-card${past ? ' cal-card--past' : ''}`}>
      <div className="cal-card-top">
        {item.targetPublishDate && <span className="cal-date">{shortDate(item.targetPublishDate)}</span>}
        <span className={item.status === 'generating' ? 'cal-generating' : undefined}>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        </span>
        {SHOW_NON_BLOG_CONTENT_TYPES && <StatusBadge tone="neutral" dot={false}>{isSA ? 'Page' : 'Blog'}</StatusBadge>}
        {item.type === 'post' && item.publishedUrl && (
          <a href={item.publishedUrl} target="_blank" rel="noopener noreferrer" className="cal-card-link" title="View it on the site" aria-label={`View “${title}” on the site`}>
            <ArrowSquareOut size={14} weight="bold" aria-hidden />
          </a>
        )}
      </div>

      {showClient && <Link href={`/admin/clients/${item.clientId}?tab=content`} className="cal-client-name" style={{ position: 'relative', zIndex: 1 }}>{item.clientName}</Link>}

      {/* The title is the control when there's a rationale to read; the whole card is its target. */}
      {hasRationale
        ? <button type="button" className="cal-title" onClick={() => onViewRationale(item)} title="Why this topic">{title}</button>
        : <p className="cal-title">{title}</p>}
    </article>
  )
}
