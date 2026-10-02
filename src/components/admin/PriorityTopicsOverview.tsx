// The Content page's agency-wide view of Priority topics: every client's sets, how far through them
// each is, what is written next, and which links the team still has to add by hand.
// Server-rendered; the page reads the data and passes it in.
//
// It was the "Silos" view: post counts labelled "Coverage", a core/outer section badge, pending hub
// links, and each set opening the authority planner — a pillar-cluster tool most sets never use. It
// now speaks the language of the Pipeline section it summarises ("2 of 6 written", "Next up", when the
// next one is due), and each set opens in that client's Pipeline, where sets are actually managed.
// The authority planner stays reachable as a quiet link.

import Link from 'next/link'
import { Flag } from '@phosphor-icons/react/dist/ssr'
import { fmtPublishDay } from '@/components/admin/priorityTopics'
import StatusBadge, { type StatusTone } from '@/components/ui/StatusBadge'
import EmptyState from '@/components/ui/EmptyState'

export interface OverviewSet {
  id:          string
  name:        string
  /** Only blog sets take publish dates. */
  contentType: string
  hubUrl:      string | null
  hubTitle:    string | null
  /** Null when its keywords could not be read. */
  stats: { total: number; written: number; picked: number; nextKeyword: string | null } | null
  /** Links the team still has to add by hand (main-page sets). */
  linksOpen:   number
}

export interface OverviewClient {
  id:    string
  name:  string
  /** Oldest set first — the order the topic run takes them. */
  sets:  OverviewSet[]
  /** The next open date, from the same rule the topic run uses. 'error' when it could not be read. */
  slot:  { date: string; picksOn: string | null; autoGenerate: boolean } | null | 'error'
}

const pipelineHref = (clientId: string) => `/admin/clients/${clientId}?tab=content&subtab=pipeline#priority-topics`

const isPages = (s: OverviewSet) => s.contentType !== 'blog'
const waiting = (s: OverviewSet) => s.stats ? s.stats.total - s.stats.written - s.stats.picked : 0

/** The set that takes the client's next date: the oldest blog set with keywords waiting. */
function nextUp(sets: OverviewSet[]): OverviewSet | null {
  return sets.find(s => !isPages(s) && waiting(s) > 0) ?? null
}

export default function PriorityTopicsOverview({ clients }: { clients: OverviewClient[] }) {
  if (clients.length === 0) {
    return (
      <div className="card">
        {/* /admin/clients only redirects to /admin/dashboard, where the client list lives. A plain
            link to it loaded the page and was then redirected mid-render, which threw in the
            browser ("Rendered more hooks than during the previous render") before landing. */}
        <EmptyState
          icon={<Flag size={22} weight="duotone" />}
          title="No priority topics yet"
          actions={<Link className="btn btn-secondary" href="/admin/dashboard">Go to clients</Link>}
        >
          They’re added per client: open a client, go to Content, then Pipeline, and use Add priority topics.
          Each keyword becomes a post that goes next in the queue.
        </EmptyState>
      </div>
    )
  }

  const setCount = clients.reduce((n, c) => n + c.sets.length, 0)
  const waitingCount = clients.reduce((n, c) => n + c.sets.reduce((m, s) => m + (isPages(s) ? 0 : waiting(s)), 0), 0)
  const linkCount = clients.reduce((n, c) => n + c.sets.reduce((m, s) => m + s.linksOpen, 0), 0)

  return (
    <div className="pto">
      <p className="pto-lede">
        Keywords the team asked to have written next, across {clients.length} client{clients.length === 1 ? '' : 's'}:{' '}
        {setCount} set{setCount === 1 ? '' : 's'}, {waitingCount} keyword{waitingCount === 1 ? '' : 's'} waiting
        {linkCount > 0 && <>, <strong className="pto-links-due">{linkCount} link{linkCount === 1 ? '' : 's'} to add</strong></>}.
        Each set takes its client’s next open publish dates, ahead of the usual topic picks, until it runs out.
      </p>

      {clients.map(c => {
        const next = nextUp(c.sets)
        // Sets with work left first (oldest first), then empty ones, then done.
        const ordered = [
          ...c.sets.filter(s => isPages(s) || waiting(s) > 0 || s.stats === null),
          ...c.sets.filter(s => !isPages(s) && s.stats !== null && s.stats.total === 0),
          ...c.sets.filter(s => !isPages(s) && s.stats !== null && s.stats.total > 0 && waiting(s) === 0),
        ]
        return (
          <section key={c.id} className="pto-client" aria-labelledby={`pto-${c.id}`}>
            <div className="pto-client-head">
              <div className="pto-client-id">
                <h2 id={`pto-${c.id}`} className="pto-client-name"><Link href={pipelineHref(c.id)}>{c.name}</Link></h2>
                <p className="pto-client-when">{whenLine(next, c.slot)}</p>
              </div>
              <Link className="btn btn-secondary btn-sm" href={pipelineHref(c.id)}>Manage in Pipeline</Link>
            </div>
            <div className="pto-grid">
              {ordered.map(s => <SetCard key={s.id} set={s} clientId={c.id} isNext={next?.id === s.id} next={next} slot={c.slot} />)}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function whenLine(next: OverviewSet | null, slot: OverviewClient['slot']): string {
  if (!next) return 'Nothing waiting. Add keywords in the Pipeline to keep a set going.'
  if (slot === 'error') return `“${next.name}” goes next. The schedule couldn’t be read just now.`
  if (!slot) return `“${next.name}” goes next, but there’s no open publish date to fill right now.`
  if (!slot.autoGenerate) return `Automatic topics are off: the next post (${fmtPublishDay(slot.date)}) is only picked by hand.`
  if (slot.picksOn === null) return `Next priority post: ${fmtPublishDay(slot.date)}. Its topic is picked within the next couple of hours.`
  return `Next priority post: ${fmtPublishDay(slot.date)}. Its topic is picked on ${fmtPublishDay(slot.picksOn)}.`
}

function SetCard({ set, clientId, isNext, next, slot }: {
  set: OverviewSet; clientId: string; isNext: boolean; next: OverviewSet | null; slot: OverviewClient['slot']
}) {
  const st = set.stats
  const pages = isPages(set)
  const left = waiting(set)
  const done = !pages && !!st && st.total > 0 && left === 0
  const empty = !pages && !!st && st.total === 0

  const badge: { label: string; tone: StatusTone } =
    pages  ? { label: 'Service pages', tone: 'neutral' }
    : empty ? { label: 'No keywords yet', tone: 'warning' }
    : done ? (st!.picked === 0 ? { label: 'All written', tone: 'success' } : { label: 'All picked', tone: 'neutral' })
    : isNext ? { label: 'Next up', tone: 'info' }
    : { label: 'Queued', tone: 'neutral' }

  let line: string
  if (!st) line = 'Its keywords couldn’t be read just now.'
  else if (pages) line = 'Made from the page generator on demand, not on the publish schedule.'
  else if (empty) line = 'Add keywords in the Pipeline to start it.'
  else if (done) line = st.picked === 0 ? 'Every keyword is written. Add more to keep it going.' : `Every keyword has a topic; ${st.picked} still being written.`
  else if (isNext && st.nextKeyword) {
    const date = slot && slot !== 'error' ? ` · for ${fmtPublishDay(slot.date)}` : ''
    line = `Next: “${st.nextKeyword}”${date}`
  } else line = `Next: “${st.nextKeyword ?? '—'}”, once “${next?.name ?? 'the set ahead'}” runs out.`

  return (
    <article className={`pt-set pto-set${isNext ? ' pt-set--next' : ''}${done ? ' pt-set--done' : ''}`}>
      <div className="pt-set-title-row">
        <Link className="pt-set-name pto-set-name" href={pipelineHref(clientId)}>{set.name}</Link>
        <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
      </div>
      {st && !pages && st.total > 0 && (
        <div className="pt-progress-row">
          <div className="pt-progress" role="img" aria-label={`${st.written} of ${st.total} written${st.picked ? `, ${st.picked} in progress` : ''}`}>
            <span className="pt-progress-done" style={{ width: `${(st.written / st.total) * 100}%` }} />
            <span className="pt-progress-picked" style={{ width: `${(st.picked / st.total) * 100}%` }} />
          </div>
          <span className="pt-progress-text"><strong>{st.written} of {st.total}</strong> written{st.picked > 0 ? `, ${st.picked} in progress` : ''}</span>
        </div>
      )}
      <p className="pto-set-line">{line}</p>
      {set.hubUrl && (
        <p className="pto-set-line pto-set-hub">
          Main page: {set.hubTitle || set.hubUrl}.
          {set.linksOpen > 0 && <> <strong className="pto-links-due">{set.linksOpen} link{set.linksOpen === 1 ? '' : 's'} to add</strong> by hand.</>}
        </p>
      )}
      <Link className="pto-quiet" href={`/admin/content/silos/${set.id}`}>Authority planner</Link>
    </article>
  )
}
