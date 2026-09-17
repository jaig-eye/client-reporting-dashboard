// ─────────────────────────────────────────────────────────────────────────────
// Reputation — /dashboard/reputation
//
// What people say on the Google listing, and what the business said back. The rating and the
// review count were already on the SEO pages as two numbers; this is the rest of the story, and
// the half that can be acted on: how quickly reviews get a reply, and which way the rating is
// drifting.
//
// Every number except the lifetime rating answers for the selected date range and moves against
// whichever comparison is chosen, the same as every other page. The rating and the 1–5 spread are
// deliberately lifetime: they are what a searcher sees on the listing, and a month of reviews says
// too little on its own.
//
// Data comes from `gbp_reviews` (migration 219), written by the Google Business Profile sync.
// Before that migration is applied the read comes back empty and the page says so rather than
// breaking.
//
// Google does not record how a reviewer found the business, so nothing here is attributed to a
// campaign, and the page says as much instead of implying otherwise.
// ─────────────────────────────────────────────────────────────────────────────

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveDashboardRange } from '@/lib/dateRange'
import type { Client } from '@/lib/types'
import PageHeader from '@/components/dashboard/PageHeader'
import EmptyState from '@/components/dashboard/EmptyState'
import RowLimit from '@/components/dashboard/RowLimit'
import { Star, ChatCircleText, ArrowUp, ArrowDown, ArrowSquareOut } from '@phosphor-icons/react/dist/ssr'

export const dynamic = 'force-dynamic'

const REVIEW_SELECT = 'review_id,reviewer_name,star_rating,comment,created_at,reply_comment,replied_at'

// A listing with more reviews than this is well past the point where another one changes the
// picture, and the page reads them all into memory.
const REVIEW_CAP = 1000

const POST_SELECT = 'post_id,platforms,account_names,summary,media_url,post_url,published_at,created_at,likes,comments,shares,review_id,'
  // GHL sends more than the columns cover. The payload is already in the row, so these come out of
  // it rather than out of a migration.
  + 'created_via:raw->>source,post_type:raw->>type'
const POST_CAP    = 500

const _getCachedReputation = unstable_cache(
  async (clientId: string) => {
    const db = createAdminClient()
    const [{ data: reviews }, { data: snapshot }, { data: posts }] = await Promise.all([
      // Migration 219. Before it exists this read fails quietly and the page shows its empty state.
      db.from('gbp_reviews').select(REVIEW_SELECT)
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(REVIEW_CAP),
      // Google's own running total and average, which count reviews older than the page cap.
      db.from('gbp_metrics').select('date,reviews_count,reviews_avg_rating')
        .eq('client_id', clientId).gt('reviews_count', 0)
        .order('date', { ascending: false }).limit(1),
      // What we published to their pages. Migration 221, and only populated for a client whose
      // GHL token carries the Social Planner scope — before either, this fails quietly and the
      // section stays out of the page rather than showing an empty promise.
      db.from('ghl_social_posts').select(POST_SELECT)
        .eq('client_id', clientId)
        .order('published_at', { ascending: false })
        .limit(POST_CAP),
    ])
    return {
      reviews:  (reviews  ?? []) as unknown as ReviewRow[],
      snapshot: ((snapshot ?? [])[0] ?? null) as { reviews_count: number; reviews_avg_rating: number } | null,
      posts:    (posts    ?? []) as unknown as SocialRow[],
    }
  },
  ['dashboard-reputation-v3'],
  { revalidate: 600, tags: ['client-metrics'] }
)

type SocialRow = {
  post_id:       string
  platforms:     string[] | null
  account_names: string[] | null
  summary:       string | null
  media_url:     string | null
  post_url:      string | null
  published_at:  string | null
  created_at:    string | null
  likes:         number
  comments:      number
  shares:        number
  review_id:     string | null
  /** GHL's own word for why the post exists — 'review' for the ones we publish from a review. */
  created_via:   string | null
  /** post | story | reel */
  post_type:     string | null
}

type ReviewRow = {
  review_id:     string
  reviewer_name: string | null
  star_rating:   number
  comment:       string | null
  created_at:    string
  reply_comment: string | null
  replied_at:    string | null
}

const iso    = (d: Date) => d.toISOString().split('T')[0]
const fmtNum = (n: number) => n.toLocaleString()
const day    = (v: string) => String(v).split('T')[0]

function prettyDate(value: string) {
  const d = new Date(value)
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Whole days between two timestamps, or null when the pair makes no sense. */
function daysBetween(from: string, to: string): number | null {
  const a = new Date(from).getTime()
  const b = new Date(to).getTime()
  if (!isFinite(a) || !isFinite(b) || b < a) return null
  return Math.floor((b - a) / 86_400_000)
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** "next day" reads better than "1 day", and same-day replies are the point of the metric. */
function replySpeed(days: number): string {
  if (days <= 0) return 'same day'
  if (days === 1) return 'next day'
  return `${Math.round(days)} days`
}

function Stars({ rating, size = 13 }: { rating: number; size?: number }) {
  return (
    <span className="rep-stars" role="img" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map(n => (
        <Star key={n} size={size} weight={n <= rating ? 'fill' : 'regular'}
              className={n <= rating ? 'rep-star rep-star--on' : 'rep-star'} aria-hidden />
      ))}
    </span>
  )
}

/**
 * The change against the comparison period. A faster reply is an improvement even though the
 * number went down, so which direction counts as good is passed in rather than assumed.
 */
function Delta({ pct, lowerIsBetter = false }: { pct: number | null; lowerIsBetter?: boolean }) {
  if (pct == null || !isFinite(pct) || Math.abs(pct) < 0.5) return null
  const good = lowerIsBetter ? pct < 0 : pct > 0
  return (
    <span className={`rep-delta ${good ? 'rep-delta--good' : 'rep-delta--bad'}`}>
      {pct > 0 ? <ArrowUp size={10} weight="bold" aria-hidden /> : <ArrowDown size={10} weight="bold" aria-hidden />}
      {Math.abs(pct).toFixed(0)}%
    </span>
  )
}

function ReviewCard({ review }: { review: ReviewRow }) {
  const waited = review.replied_at ? daysBetween(review.created_at, review.replied_at) : null
  return (
    <article className="rep-review">
      <header className="rep-review__head">
        <Stars rating={review.star_rating} />
        <span className="rep-review__who">{review.reviewer_name || 'Someone'}</span>
        <time className="rep-review__when" dateTime={day(review.created_at)}>{prettyDate(review.created_at)}</time>
      </header>
      {review.comment
        ? <p className="rep-review__text">{review.comment}</p>
        : <p className="rep-review__text rep-review__text--none">Rated without leaving a comment.</p>}
      {review.reply_comment ? (
        <div className="rep-reply">
          <p className="rep-reply__label">
            <ChatCircleText size={12} weight="bold" aria-hidden /> Your reply
            {waited != null && <span className="rep-reply__lag"> · {replySpeed(waited)}</span>}
          </p>
          <p className="rep-reply__text">{review.reply_comment}</p>
        </div>
      ) : (
        <p className="rep-review__pending">No reply yet</p>
      )}
    </article>
  )
}

/** What one period's reviews add up to. Used for the selected range and the one it is compared to. */
function summarise(reviews: ReviewRow[]) {
  const rated   = reviews.filter(r => r.star_rating > 0)
  // The reply rate counts five-star reviews only. Anything less tends to be answered by phone or
  // in person rather than in public, so including it measured a policy rather than the work.
  const praise  = reviews.filter(r => r.star_rating === 5)
  const replied = praise.filter(r => r.reply_comment)
  const lags    = reviews
    .map(r => (r.replied_at ? daysBetween(r.created_at, r.replied_at) : null))
    .filter((n): n is number => n != null)
  return {
    count:     reviews.length,
    avg:       rated.length > 0 ? rated.reduce((s, r) => s + r.star_rating, 0) / rated.length : 0,
    praise:    praise.length,
    replied:   replied.length,
    replyRate: praise.length > 0 ? (replied.length / praise.length) * 100 : 0,
    lags,
    medianLag: median(lags),
  }
}

/** Percent change, or null when there is nothing to compare against. */
function change(now: number, before: number): number | null {
  if (!before) return null
  return ((now - before) / Math.abs(before)) * 100
}

export default async function ReputationPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; compare?: string }>
}) {
  const cookieStore = await cookies()
  const params      = await searchParams

  const token = cookieStore.get('client_token')?.value
  if (!token) redirect('/access')

  const db = createAdminClient()
  const { data: clientData } = await db.from('clients').select('*').eq('dashboard_token', token).maybeSingle()
  const client = clientData as Client | null
  if (!client) redirect('/access')

  const { fromDate, toDate } = resolveDashboardRange(params)
  const compare     = params.compare ?? 'none'
  const showCompare = compare !== 'none'

  const { reviews, snapshot, posts } = await _getCachedReputation(client.id)

  if (reviews.length === 0) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
        <PageHeader title="Reputation" fromDate={fromDate} toDate={toDate} compare={compare} />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <EmptyState
            icon={<Star size={22} weight="fill" />}
            title="No reviews here yet"
            description={
              snapshot
                ? `Your Google listing shows ${fmtNum(snapshot.reviews_count)} reviews. They will appear here after the next sync of your Business Profile.`
                : 'Reviews from your Google Business Profile will appear here once the listing is connected and synced.'
            }
          />
        </main>
      </div>
    )
  }

  // ── The selected range, and whatever it is being compared against ─────────
  const from = iso(fromDate), to = iso(toDate)
  const periodMs = toDate.getTime() - fromDate.getTime()
  const dayCount = Math.max(1, Math.round(periodMs / 86_400_000) + 1)

  let priorFrom: Date, priorTo: Date
  if (compare === 'last_year') {
    priorFrom = new Date(fromDate); priorFrom.setFullYear(priorFrom.getFullYear() - 1)
    priorTo   = new Date(toDate);   priorTo.setFullYear(priorTo.getFullYear() - 1)
  } else {
    priorTo   = new Date(fromDate.getTime() - 86_400_000)
    priorFrom = new Date(priorTo.getTime() - periodMs)
  }
  const priorLabel = compare === 'last_year' ? 'the same dates last year' : `the ${dayCount} days before`

  const inRange = (r: ReviewRow, a: string, b: string) => day(r.created_at) >= a && day(r.created_at) <= b
  const periodReviews = reviews.filter(r => inRange(r, from, to))
  const now    = summarise(periodReviews)
  const before = summarise(reviews.filter(r => inRange(r, iso(priorFrom), iso(priorTo))))

  // ── Lifetime, because this is what a searcher sees on the listing ─────────
  const rated         = reviews.filter(r => r.star_rating > 0)
  const lifetimeAvg   = snapshot?.reviews_avg_rating
    || (rated.length > 0 ? rated.reduce((s, r) => s + r.star_rating, 0) / rated.length : 0)
  const lifetimeCount = snapshot?.reviews_count || reviews.length

  const distribution = [5, 4, 3, 2, 1].map(stars => ({
    stars,
    count: rated.filter(r => r.star_rating === stars).length,
  }))
  const distMax = Math.max(1, ...distribution.map(d => d.count))

  // Twelve months back from the end of the selected range, so the chart follows the date picker.
  const months: { key: string; label: string; count: number; low: number; inRange: boolean }[] = []
  for (let i = 11; i >= 0; i--) {
    const d   = new Date(toDate.getFullYear(), toDate.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const inMonth = reviews.filter(r => day(r.created_at).slice(0, 7) === key)
    months.push({
      key,
      label: d.toLocaleDateString('en-US', { month: 'short' }),
      count: inMonth.length,
      low:   inMonth.filter(r => r.star_rating > 0 && r.star_rating <= 3).length,
      // Any overlap with the selected range at all, so a short window still marks its month.
      inRange: key >= from.slice(0, 7) && key <= to.slice(0, 7),
    })
  }
  const monthMax    = Math.max(1, ...months.map(m => m.count))
  const monthsShown = months.some(m => m.count > 0)

  const periodWord   = now.count === 1 ? 'review' : 'reviews'

  // ── What we published to their pages in this period ───────────────────────
  // A post is dated by when it actually went out; a post with no publish date falls back to when
  // it was created, which is the same day in practice for anything already published.
  const postDay      = (p: SocialRow) => day(p.published_at ?? p.created_at ?? '')
  const periodPosts  = posts.filter(p => {
    const d = postDay(p)
    return d >= from && d <= to
  })
  // How many of THIS period's reviews we shared — the number worth putting in a sentence. Counted
  // over the reviews, not the posts, so one review shared to two pages still counts once.
  const sharedIds    = new Set(periodPosts.map(p => p.review_id).filter(Boolean) as string[])
  const sharedOfNew  = periodReviews.filter(r => sharedIds.has(r.review_id)).length
  const reviewById   = new Map(reviews.map(r => [r.review_id, r]))
  const networkNames = Array.from(new Set(
    periodPosts.flatMap(p => p.platforms ?? []).filter(Boolean),
  )).map(p => p.charAt(0).toUpperCase() + p.slice(1))
  // Distinct reviews, so a review shared to two networks counts once.
  const sharedReviews = new Set(periodPosts.map(p => p.review_id).filter(Boolean)).size
  const byNetwork: { name: string; count: number }[] = Object.entries(
    periodPosts.reduce<Record<string, number>>((acc, p) => {
      for (const n of p.platforms ?? []) acc[n] = (acc[n] ?? 0) + 1
      return acc
    }, {}),
  ).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)

  // The Social Planner posts once per network, so one review comes back as two or three rows with
  // the same words. They are grouped back together here: one thing shared, however many places it
  // went. Engagement sums across them because those really are separate posts.
  type SocialGroup = {
    key:      string
    networks: { platform: string; url: string | null }[]
    summary:  string
    media:    string | null
    day:      string
    likes:    number
    comments: number
    shares:   number
    review:   ReviewRow | undefined
    kind:     string | null
  }
  const groups: SocialGroup[] = []
  const groupByKey = new Map<string, SocialGroup>()
  for (const p of periodPosts) {
    // A post with no review falls back to its own id, so it still gets a row of its own.
    const key = p.review_id ?? `post:${p.post_id}`
    let g = groupByKey.get(key)
    if (!g) {
      g = {
        key,
        networks: [],
        summary:  (p.summary ?? '').replace(/\n{2,}/g, '\n').trim(),
        media:    p.media_url,
        day:      postDay(p),
        likes: 0, comments: 0, shares: 0,
        review:   p.review_id ? reviewById.get(p.review_id) : undefined,
        kind:     p.post_type && p.post_type !== 'post' ? p.post_type : null,
      }
      groupByKey.set(key, g)
      groups.push(g)
    }
    for (const n of p.platforms ?? []) {
      if (!g.networks.some(x => x.platform === n)) g.networks.push({ platform: n, url: p.post_url })
    }
    g.likes += p.likes; g.comments += p.comments; g.shares += p.shares
    if (!g.media && p.media_url) g.media = p.media_url
    if (!g.summary && p.summary) g.summary = p.summary.replace(/\n{2,}/g, '\n').trim()
    // The newest of the group dates it — they go out within seconds of each other.
    if (postDay(p) > g.day) g.day = postDay(p)
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <PageHeader title="Reputation" fromDate={fromDate} toDate={toDate} compare={compare} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5 sm:space-y-6">
        <p className="rep-lede">
          <b>{fmtNum(now.count)}</b> new {periodWord} in this period
          {now.count > 0 && now.avg > 0 && <>, averaging <b>{now.avg.toFixed(1)}</b> stars</>}
          {showCompare ? <>, against {priorLabel}.</> : '.'}
        </p>

        {/* ── The four numbers that matter ────────────────────────────────── */}
        <section className="card rep-kpis" aria-label="Reputation at a glance">
          <div className="rep-kpi">
            <p className="metric-label">Your rating</p>
            <p className="rep-kpi__value">{lifetimeAvg.toFixed(1)}</p>
            <Stars rating={Math.round(lifetimeAvg)} />
            <p className="rep-kpi__sub">All time, across {fmtNum(lifetimeCount)} reviews</p>
          </div>

          <div className="rep-kpi">
            <p className="metric-label">New reviews</p>
            <p className="rep-kpi__value">
              {fmtNum(now.count)}
              {showCompare && <Delta pct={change(now.count, before.count)} />}
            </p>
            <p className="rep-kpi__sub">
              {showCompare
                ? `${fmtNum(before.count)} in ${priorLabel}`
                : `Left in the last ${dayCount} days`}
            </p>
          </div>

          <div className="rep-kpi">
            <p className="metric-label">Replied to</p>
            <p className="rep-kpi__value">
              {now.praise > 0 ? `${now.replyRate.toFixed(0)}%` : '—'}
              {showCompare && before.praise > 0 && now.praise > 0 &&
                <Delta pct={change(now.replyRate, before.replyRate)} />}
            </p>
            <p className="rep-kpi__sub">
              {now.praise > 0
                ? `${fmtNum(now.replied)} of ${fmtNum(now.praise)} five-star reviews`
                : 'No five-star reviews this period'}
            </p>
          </div>

          <div className="rep-kpi">
            <p className="metric-label">Reply time</p>
            <p className="rep-kpi__value">
              {now.medianLag == null ? '—' : replySpeed(now.medianLag)}
              {showCompare && now.medianLag != null && before.medianLag != null &&
                <Delta pct={change(now.medianLag, before.medianLag)} lowerIsBetter />}
            </p>
            <p className="rep-kpi__sub">
              {now.medianLag == null
                ? 'No replies this period'
                : `Typical, across ${fmtNum(now.lags.length)} ${now.lags.length === 1 ? 'reply' : 'replies'}`}
            </p>
          </div>
        </section>

        <div className="rep-split">
          {/* ── How people rate ───────────────────────────────────────────── */}
          <section className="card rep-card" aria-labelledby="rep-dist-title">
            <div className="rep-card__head">
              <h2 id="rep-dist-title" className="section-title">How people rate you</h2>
              <p className="section-desc">Every review on the listing, not just this period</p>
            </div>
            <ul className="rep-dist">
              {distribution.map(d => (
                <li key={d.stars} className="rep-dist__row">
                  <span className="rep-dist__label">{d.stars}<Star size={11} weight="fill" className="rep-star rep-star--on" aria-hidden /></span>
                  <span className="rep-dist__track">
                    <span
                      className={d.stars >= 4 ? 'rep-dist__bar rep-dist__bar--good' : d.stars === 3 ? 'rep-dist__bar' : 'rep-dist__bar rep-dist__bar--bad'}
                      style={{ width: `${(d.count / distMax) * 100}%` }}
                    />
                  </span>
                  <span className="rep-dist__count">{fmtNum(d.count)}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* ── Reviews over time ─────────────────────────────────────────── */}
          {monthsShown && (
            <section className="card rep-card" aria-labelledby="rep-trend-title">
              <div className="rep-card__head">
                <h2 id="rep-trend-title" className="section-title">Reviews each month</h2>
                <p className="section-desc">Twelve months for context — the dates you picked are in full colour. Amber marks three stars or below.</p>
              </div>
              <ul className="rep-months">
                {months.map(m => (
                  <li key={m.key} className={m.inRange ? 'rep-month' : 'rep-month rep-month--outside'}>
                    <span className="rep-month__track">
                      {/* A month with no reviews gets no bar at all — a sliver of colour would read
                          as a little bit of something, when the answer is nothing. */}
                      {m.count > 0 && (
                        <span className="rep-month__bar" style={{ height: `${(m.count / monthMax) * 100}%` }}>
                          {m.low > 0 && (
                            <span className="rep-month__low" style={{ height: `${(m.low / m.count) * 100}%` }} />
                          )}
                        </span>
                      )}
                    </span>
                    <span className="rep-month__n">{m.count || ''}</span>
                    <span className="rep-month__label">{m.label}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* ── What we shared to their pages ───────────────────────────────── */}
        {periodPosts.length > 0 && (
          <section className="card rep-card" aria-labelledby="rep-social-title">
            <div className="rep-card__head">
              <h2 id="rep-social-title" className="section-title">Shared to your pages</h2>
              <p className="section-desc">
                {sharedOfNew > 0
                  ? <><b>{fmtNum(sharedOfNew)}</b> of your {fmtNum(now.count)} new {periodWord} went out
                      {networkNames.length > 0 && <> to {networkNames.join(' and ')}</>}, posted for you automatically.</>
                  : <>{fmtNum(periodPosts.length)} {periodPosts.length === 1 ? 'post' : 'posts'} published for you
                      {networkNames.length > 0 && <> on {networkNames.join(' and ')}</>} in this period.</>}
              </p>
            </div>
            <dl className="rep-social__stats">
              <div>
                <dt className="metric-label">Posts published</dt>
                <dd className="rep-social__fig">{fmtNum(periodPosts.length)}</dd>
              </div>
              {sharedReviews > 0 && (
                <div>
                  <dt className="metric-label">Reviews shared</dt>
                  <dd className="rep-social__fig">{fmtNum(sharedReviews)}</dd>
                </div>
              )}
              {byNetwork.map(n => (
                <div key={n.name}>
                  <dt className="metric-label">{n.name.charAt(0).toUpperCase() + n.name.slice(1)}</dt>
                  <dd className="rep-social__fig">{fmtNum(n.count)}</dd>
                </div>
              ))}
            </dl>
            <RowLimit total={groups.length} noun="posts" limit={4}>
              <div className="rep-social">
                {groups.map(g => {
                  const reach = g.likes + g.comments + g.shares
                  return (
                    <article key={g.key}
                             className={g.media ? 'rep-social__post' : 'rep-social__post rep-social__post--text'}>
                      {g.media && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={g.media} alt="" className="rep-social__media" loading="lazy" />
                      )}
                      <div className="rep-social__body">
                        <header className="rep-social__head">
                          {g.networks.map(n => {
                            const label = n.platform.charAt(0).toUpperCase() + n.platform.slice(1)
                            // The chip is the link where we have one — where it went and how to
                            // get there, in one object.
                            return n.url ? (
                              <a key={n.platform} className="rep-social__where" data-net={n.platform}
                                 href={n.url} target="_blank" rel="noopener noreferrer">
                                {label}<ArrowSquareOut size={10} weight="bold" aria-hidden />
                              </a>
                            ) : (
                              <span key={n.platform} className="rep-social__where" data-net={n.platform}>
                                {label}
                              </span>
                            )
                          })}
                          {g.kind && <span className="rep-social__kind">{g.kind}</span>}
                          <time className="rep-social__when" dateTime={g.day}>{prettyDate(g.day)}</time>
                        </header>
                        {g.summary && <p className="rep-social__text">{g.summary}</p>}
                        {(g.review || reach > 0) && (
                          <footer className="rep-social__foot">
                            {g.review && (
                              <span className="rep-social__review">
                                <Stars rating={g.review.star_rating} />
                                from {g.review.reviewer_name || 'a customer'}
                              </span>
                            )}
                            {reach > 0 && (
                              <span className="rep-social__reach">
                                {g.likes > 0    && <>{fmtNum(g.likes)} {g.likes === 1 ? 'like' : 'likes'}</>}
                                {g.comments > 0 && <>{g.likes > 0 && ' · '}{fmtNum(g.comments)} {g.comments === 1 ? 'comment' : 'comments'}</>}
                                {g.shares > 0   && <>{(g.likes > 0 || g.comments > 0) && ' · '}{fmtNum(g.shares)} {g.shares === 1 ? 'share' : 'shares'}</>}
                              </span>
                            )}
                          </footer>
                        )}
                      </div>
                    </article>
                  )
                })}
              </div>
            </RowLimit>
          </section>
        )}

        {/* ── The reviews in the selected range ───────────────────────────── */}
        <section className="card rep-card" aria-labelledby="rep-all-title">
          <div className="rep-card__head">
            <h2 id="rep-all-title" className="section-title">Reviews in this period</h2>
            <p className="section-desc">
              {periodReviews.length > 0
                ? <>Newest first, with your reply where there is one</>
                : <>Nothing was left between these dates. Widen the range to see more.</>}
            </p>
          </div>
          {periodReviews.length > 0 && (
            <RowLimit total={periodReviews.length} noun="reviews">
              <div className="rep-list">
                {periodReviews.map(r => <ReviewCard key={r.review_id} review={r} />)}
              </div>
            </RowLimit>
          )}
        </section>
      </main>
    </div>
  )
}
