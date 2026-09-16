// ─────────────────────────────────────────────────────────────────────────────
// Reputation — /dashboard/reputation
//
// What people say on the Google listing, and what the business said back. The rating and the
// review count were already on the SEO pages as two numbers; this is the rest of the story, and
// the half that can be acted on: who is still waiting for a reply, how long a reply usually
// takes, and which way the rating is drifting.
//
// Every figure comes from `gbp_reviews` (migration 219), written by the Google Business Profile
// sync. Before that migration is applied the read comes back empty and the page says so rather
// than breaking.
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
import { Star, ChatCircleText } from '@phosphor-icons/react/dist/ssr'

export const dynamic = 'force-dynamic'

const REVIEW_SELECT = 'review_id,reviewer_name,star_rating,comment,created_at,reply_comment,replied_at'

// A listing with more reviews than this is well past the point where another one changes the
// picture, and the page reads them all into memory.
const REVIEW_CAP = 1000

const _getCachedReputation = unstable_cache(
  async (clientId: string) => {
    const db = createAdminClient()
    const [{ data: reviews }, { data: snapshot }] = await Promise.all([
      // Migration 219. Before it exists this read fails quietly and the page shows its empty state.
      db.from('gbp_reviews').select(REVIEW_SELECT)
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(REVIEW_CAP),
      // Google's own running total and average, which count reviews older than the page cap.
      db.from('gbp_metrics').select('date,reviews_count,reviews_avg_rating')
        .eq('client_id', clientId).gt('reviews_count', 0)
        .order('date', { ascending: false }).limit(1),
    ])
    return {
      reviews:  (reviews  ?? []) as unknown as ReviewRow[],
      snapshot: ((snapshot ?? [])[0] ?? null) as { reviews_count: number; reviews_avg_rating: number } | null,
    }
  },
  ['dashboard-reputation-v1'],
  { revalidate: 600, tags: ['client-metrics'] }
)

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
const day    = (v: string) => v.split('T')[0]

function prettyDate(value: string) {
  const d = new Date(value)
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Whole days between two timestamps, rounded down, never negative. */
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

/** "in a day" reads better than "in 1 day", and same-day replies are the point of the metric. */
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
  const compare = params.compare ?? 'none'

  const { reviews, snapshot } = await _getCachedReputation(client.id)

  if (reviews.length === 0) {
    return (
      <div className="dash-page rep-page">
        <PageHeader title="Reputation" accent="var(--amber)" fromDate={fromDate} toDate={toDate} compare={compare} />
        <EmptyState
          icon={<Star size={22} weight="fill" />}
          title="No reviews here yet"
          description={
            snapshot
              ? `Your Google listing shows ${fmtNum(snapshot.reviews_count)} reviews. They will appear here after the next sync of your Business Profile.`
              : 'Reviews from your Google Business Profile will appear here once the listing is connected and synced.'
          }
        />
      </div>
    )
  }

  // ── The period, and the one before it ─────────────────────────────────────
  const from = iso(fromDate), to = iso(toDate)
  const periodMs  = toDate.getTime() - fromDate.getTime()
  const dayCount  = Math.max(1, Math.round(periodMs / 86_400_000) + 1)
  const priorTo   = new Date(fromDate.getTime() - 86_400_000)
  const priorFrom = new Date(priorTo.getTime() - periodMs)

  const inRange = (r: ReviewRow, a: string, b: string) => day(r.created_at) >= a && day(r.created_at) <= b
  const periodReviews = reviews.filter(r => inRange(r, from, to))
  const priorReviews  = reviews.filter(r => inRange(r, iso(priorFrom), iso(priorTo)))

  // ── The numbers ───────────────────────────────────────────────────────────
  const rated        = reviews.filter(r => r.star_rating > 0)
  const lifetimeAvg  = snapshot?.reviews_avg_rating
    || (rated.length > 0 ? rated.reduce((s, r) => s + r.star_rating, 0) / rated.length : 0)
  const lifetimeCount = snapshot?.reviews_count || reviews.length

  const awaiting  = reviews.filter(r => !r.reply_comment)
  const replied   = reviews.length - awaiting.length
  const replyRate = reviews.length > 0 ? (replied / reviews.length) * 100 : 0

  const replyLags   = reviews
    .map(r => (r.replied_at ? daysBetween(r.created_at, r.replied_at) : null))
    .filter((n): n is number => n != null)
  const medianLag   = median(replyLags)

  const periodAvg = periodReviews.length > 0
    ? periodReviews.reduce((s, r) => s + r.star_rating, 0) / periodReviews.filter(r => r.star_rating > 0).length
    : 0
  const newDelta = priorReviews.length > 0
    ? ((periodReviews.length - priorReviews.length) / priorReviews.length) * 100
    : null

  // How people rate, over everything we hold rather than the period: five reviews in a month say
  // very little, where the whole listing says what a searcher actually sees.
  const distribution = [5, 4, 3, 2, 1].map(stars => ({
    stars,
    count: rated.filter(r => r.star_rating === stars).length,
  }))
  const distMax = Math.max(1, ...distribution.map(d => d.count))

  // Twelve months of reviews, so a quiet spell or a push shows up.
  const monthKey  = (v: string) => v.slice(0, 7)
  const months: { key: string; label: string; count: number; low: number }[] = []
  const cursor = new Date(toDate.getFullYear(), toDate.getMonth(), 1)
  for (let i = 11; i >= 0; i--) {
    const d   = new Date(cursor.getFullYear(), cursor.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const inMonth = reviews.filter(r => monthKey(r.created_at) === key)
    months.push({
      key,
      label: d.toLocaleDateString('en-US', { month: 'short' }),
      count: inMonth.length,
      low:   inMonth.filter(r => r.star_rating > 0 && r.star_rating <= 3).length,
    })
  }
  const monthMax   = Math.max(1, ...months.map(m => m.count))
  const monthsShown = months.some(m => m.count > 0)

  return (
    <div className="dash-page rep-page">
      <PageHeader title="Reputation" accent="var(--amber)" fromDate={fromDate} toDate={toDate} compare={compare} />

      {/* ── The four numbers that matter ────────────────────────────────── */}
      <section className="card rep-kpis" aria-label="Reputation at a glance">
        <div className="rep-kpi">
          <p className="metric-label">Your rating</p>
          <p className="rep-kpi__value">{lifetimeAvg.toFixed(1)}</p>
          <Stars rating={Math.round(lifetimeAvg)} />
          <p className="rep-kpi__sub">{fmtNum(lifetimeCount)} reviews on Google</p>
        </div>
        <div className="rep-kpi">
          <p className="metric-label">New reviews</p>
          <p className="rep-kpi__value">{fmtNum(periodReviews.length)}</p>
          <p className="rep-kpi__sub">
            {newDelta == null
              ? `in the last ${dayCount} days`
              : `${newDelta >= 0 ? '+' : '−'}${Math.abs(newDelta).toFixed(0)}% on the ${dayCount} days before`}
            {periodReviews.length > 0 && isFinite(periodAvg) && periodAvg > 0 && ` · ${periodAvg.toFixed(1)} average`}
          </p>
        </div>
        <div className="rep-kpi">
          <p className="metric-label">Replied to</p>
          <p className="rep-kpi__value">{replyRate.toFixed(0)}%</p>
          <p className="rep-kpi__sub">
            {awaiting.length > 0
              ? `${fmtNum(awaiting.length)} still waiting on a reply`
              : 'Every review has a reply'}
          </p>
        </div>
        <div className="rep-kpi">
          <p className="metric-label">Reply time</p>
          <p className="rep-kpi__value">{medianLag == null ? '—' : replySpeed(medianLag)}</p>
          <p className="rep-kpi__sub">
            {medianLag == null ? 'No replies to measure yet' : `Typical, across ${fmtNum(replyLags.length)} replies`}
          </p>
        </div>
      </section>

      <div className="rep-split">
        {/* ── How people rate ───────────────────────────────────────────── */}
        <section className="card rep-card" aria-labelledby="rep-dist-title">
          <div className="rep-card__head">
            <h2 id="rep-dist-title" className="section-title">How people rate you</h2>
            <p className="section-desc">Every review on the listing</p>
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
              <p className="section-desc">The last 12 months. Amber marks 3 stars or below.</p>
            </div>
            <ul className="rep-months">
              {months.map(m => (
                <li key={m.key} className="rep-month">
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

      {/* ── Waiting on a reply ──────────────────────────────────────────── */}
      {awaiting.length > 0 && (
        <section className="card rep-card" aria-labelledby="rep-waiting-title">
          <div className="rep-card__head">
            <h2 id="rep-waiting-title" className="section-title">Waiting on a reply</h2>
            <p className="section-desc">
              {awaiting.length === 1 ? 'One review has' : `${fmtNum(awaiting.length)} reviews have`} no reply yet, newest first
            </p>
          </div>
          <RowLimit total={awaiting.length} noun="reviews">
            <div className="rep-list">
              {awaiting.map(r => <ReviewCard key={r.review_id} review={r} />)}
            </div>
          </RowLimit>
        </section>
      )}

      {/* ── Everything ──────────────────────────────────────────────────── */}
      <section className="card rep-card" aria-labelledby="rep-all-title">
        <div className="rep-card__head">
          <h2 id="rep-all-title" className="section-title">Every review</h2>
          <p className="section-desc">Newest first, with your reply where there is one</p>
        </div>
        <RowLimit total={reviews.length} noun="reviews">
          <div className="rep-list">
            {reviews.map(r => <ReviewCard key={r.review_id} review={r} />)}
          </div>
        </RowLimit>
        <p className="rep-foot">
          Google doesn&rsquo;t record how a reviewer found you, so reviews can&rsquo;t be traced back to an ad or a
          search the way leads can.
          {reviews.length < lifetimeCount && ` Showing the ${fmtNum(reviews.length)} most recent of ${fmtNum(lifetimeCount)}.`}
        </p>
      </section>
    </div>
  )
}
