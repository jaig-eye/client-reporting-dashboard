'use client'

// The evidence under the Keywords list: what the data already says about what to write.
//
// ONE CARD PER SOURCE, CLOSED UNTIL WANTED
//
// This used to be five full tables stacked above the list they were meant to inform, so the
// decision sat at the bottom of a long scroll and the first thing anyone saw was a table of paid
// search terms. Each source is now one card whose header carries the whole story in a line — what
// it is, where it came from, and a plain summary ("3 on the second page") — and opens when you want
// the rows. Search Console opens by itself, because it is the evidence most clients have and the
// one that most often says "write this".
//
// A source with nothing in it is one quiet line saying why, rather than a card of apologies or a
// gap where it used to be. The page reads the same for every client: same order, same names.
//
// PAID SEARCHES ARE LAST, AND CLOSED
//
// Converting Google Ads terms stopped feeding topics — they are buying searches, and the service
// page should own them. They stay as reporting, at the bottom, closed, and each row can be added
// as one of our own keywords if there is a real question behind it.
//
// Every keyword row (bar the rankings, which are already written about) ends in Add, which puts the
// search into the list above as one of our own keywords, already ticked. Evidence you can act on
// from where you read it.

import { useMemo, useState, type ReactNode } from 'react'
import type { GscData, GscRow } from '@/components/admin/ClientContentTabPanel'
import type { SerpInsightRow } from '@/lib/content/serpInsights'
import SerpInsightsSection from '@/components/admin/SerpInsightsSection'
import {
  AddTerm, Difficulty, EvidenceSection, Explained, HELP, Spot,
  fmtCount, fmtLeads, fmtMoney, fmtPct, type AddState,
} from '@/components/admin/KeywordUi'

// The sources topic selection reads, from /api/admin/content/keyword-sources. The Keywords tab
// fetches that route once and hands these lists down.
export interface PaidTermRow { term: string; conversions: number; spend: number; costPerLead: number | null }
export interface AhrefsRow   { keyword: string; position: number | null; volume: number | null; difficulty: number | null }
export interface EvidenceSources { paidTerms: PaidTermRow[]; ahrefs: AhrefsRow[] }

/** Keyword rank row from the DataForSEO datastream (/api/admin/content/keyword-rankings). */
export interface KeywordRankRow {
  keyword_id:         string
  keyword:            string
  current_position:   number | null
  previous_position:  number | null
  position_delta:     number | null
  current_url:        string | null
  search_volume:      number | null
  keyword_difficulty: number | null
  intent:             string | null
  content_post_id:    string | null
  movement?:          string
}

/** Where an Add from an evidence row stands. Rows not in the map have not been touched. */
export type AddProgress = Map<string, { state: AddState; error?: string }>

/** Rows shown before "Show all": enough to judge a source, not so many the page is a wall again. */
const FIRST_ROWS = 10

/**
 * Search Console's four readings, in the order they are worth acting on, named for what they mean
 * rather than for the rule that sorts them ("Growth opportunities", "Low CTR").
 */
const GSC_BUCKETS = [
  { key: 'growth',     label: 'Second page',             desc: 'Spots 11–20: close to the first page. A post focused on the search can lift it on.' },
  { key: 'quickWins',  label: 'Low on page one',         desc: 'Spots 5–10: people see the site, but most click something higher up. A supporting post can push it up.' },
  { key: 'highVolume', label: 'Searched a lot, far back', desc: 'Plenty of searches, but the site sits past the second page. A new post is the way in.' },
  { key: 'lowCtr',     label: 'Top five, few clicks',     desc: 'Near the top already, but rarely clicked. Usually the page’s title and description need work rather than a new post.' },
] as const
type BucketKey = typeof GSC_BUCKETS[number]['key']

type SectionKey = 'gsc' | 'ranks' | 'ahrefs' | 'serp' | 'paid'

export default function KeywordEvidence({
  gsc, sources, sourcesLoading, sourcesError, ranks, insights, ownDomains, hasDataForSeo,
  inUse, tracked, adds, onAdd,
}: {
  gsc:            GscData
  sources:        EvidenceSources | null
  sourcesLoading: boolean
  sourcesError:   string | null
  ranks:          KeywordRankRow[] | null
  insights:       SerpInsightRow[] | null
  ownDomains:     string[]
  hasDataForSeo:  boolean
  /** Lower-cased keywords already ticked, so a row says "In use" instead of offering Add. */
  inUse:          Set<string>
  /** Lower-cased keywords already rank-tracked, which the list you tick from does not hold. */
  tracked:        Set<string>
  adds:           AddProgress
  onAdd?:         (term: string) => void
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen]     = useState<Record<SectionKey, boolean>>({ gsc: true, ranks: false, ahrefs: false, serp: false, paid: false })
  const toggle = (k: SectionKey) => setOpen(o => ({ ...o, [k]: !o[k] }))

  const q = search.trim().toLowerCase()

  const addFor = (term: string) => {
    const p = adds.get(term.toLowerCase())
    return (
      <AddTerm term={term} inUse={inUse.has(term.toLowerCase())} tracked={tracked.has(term.toLowerCase())} state={p?.state} error={p?.error} onAdd={onAdd} />
    )
  }

  // ── Search Console ──────────────────────────────────────────────────────
  const gscBuckets = useMemo(() => GSC_BUCKETS.map(b => ({
    ...b, rows: (gsc[b.key] ?? []).filter(r => matches(q, r.query, r.page)),
  })), [gsc, q])
  const gscAny = GSC_BUCKETS.some(b => (gsc[b.key] ?? []).length > 0)
  const [bucket, setBucket] = useState<BucketKey | null>(null)
  const activeBucket = gscBuckets.find(b => b.key === bucket && b.rows.length > 0) ?? gscBuckets.find(b => b.rows.length > 0) ?? null

  // ── The rest ────────────────────────────────────────────────────────────
  const ahrefs   = useMemo(() => (sources?.ahrefs ?? []).filter(r => matches(q, r.keyword)), [sources, q])
  const paid     = useMemo(() => (sources?.paidTerms ?? []).filter(r => matches(q, r.term)), [sources, q])
  const rankRows = useMemo(() => (ranks ?? []).filter(r => matches(q, r.keyword)), [ranks, q])
  const serpRows = useMemo(() => (insights ?? []).filter(r => matches(q, r.keyword, r.insight.query)), [insights, q])

  // Rank tracking is the one source that is purely DataForSEO: without it the section can never
  // fill, and "nothing yet" would read as "give it time" when the answer is "connect something".
  const ranksEmpty = !hasDataForSeo && (ranks === null || ranks.length === 0)
    ? 'Rank tracking needs DataForSEO, which this client doesn’t have connected.'
    : ranks !== null && ranks.length === 0
      ? 'Nothing tracked yet. A keyword is tracked once this client’s first post goes live.'
      : undefined

  const sourcesWaiting = sources === null && sourcesLoading
  const sourcesMissing = sources === null && !sourcesLoading
  const noMatch = q ? <>Nothing matches &ldquo;{search}&rdquo;.</> : null

  const onFirstPage = (list: (number | null)[]) => list.filter(p => p != null && p > 0 && p <= 10).length

  return (
    <div className="kw-evidence">
      <div className="kw-evidence-head">
        <div>
          <h3 className="kw-card-title">What the data says</h3>
          <p className="kw-card-desc">
            Use these to decide what to tick. Everything here is from the last sync — opening it doesn’t
            contact Google or spend anything.
          </p>
        </div>
        <label className="kw-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="input"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Filter the evidence by keyword or page"
            placeholder="Filter keywords or pages…"
          />
        </label>
      </div>

      {/* ── Search Console ───────────────────────────────────────────────── */}
      <EvidenceSection
        id="gsc" title="Searches the site nearly wins" source="Google Search Console"
        open={open.gsc} onToggle={() => toggle('gsc')}
        empty={!gscAny ? 'No data yet. Connect Search Console in Integrations and the next sync fills this in.' : undefined}
        summary={<>{summarise([
          [gscBuckets[0].rows.length, 'on the second page'],
          [gscBuckets[1].rows.length, 'low on page one'],
        ]) || `${gscBuckets.reduce((n, b) => n + b.rows.length, 0)} searches`}</>}
      >
        <p className="kw-sec-desc">
          Searches this site already shows up for in Google, but not near the top — the easiest ground
          a new post can gain. Topic ideas already look at these; Add puts one in the list above so it
          is chosen on purpose.
        </p>
        <div className="cal-filter-tabs" role="group" aria-label="Which searches to show">
          {gscBuckets.filter(b => (gsc[b.key] ?? []).length > 0).map(b => (
            <button
              key={b.key}
              type="button"
              className={`cal-filter-tab${activeBucket?.key === b.key ? ' active' : ''}`}
              aria-pressed={activeBucket?.key === b.key}
              onClick={() => setBucket(b.key)}
              disabled={b.rows.length === 0}
            >
              {b.label} <span className="kw-chip-n">{b.rows.length}</span>
            </button>
          ))}
        </div>
        {activeBucket ? (
          <>
            <p className="kw-sec-foot">{activeBucket.desc}</p>
            <GscTable key={activeBucket.key} rows={activeBucket.rows} addFor={addFor} />
          </>
        ) : (
          <p className="kw-sec-desc">{noMatch}</p>
        )}
      </EvidenceSection>

      {/* ── Rankings ─────────────────────────────────────────────────────── */}
      <EvidenceSection
        id="ranks" title="How published posts rank" source="DataForSEO rank tracking"
        open={open.ranks} onToggle={() => toggle('ranks')}
        loading={ranks === null && hasDataForSeo}
        empty={ranksEmpty}
        summary={summarise([[rankRows.length, 'tracked'], [onFirstPage(rankRows.map(r => r.current_position)), 'on the first page']])}
      >
        <p className="kw-sec-desc">Where the posts already written sit in Google, checked on a schedule.</p>
        {rankRows.length === 0 ? <p className="kw-sec-desc">{noMatch}</p> : <RankTable rows={rankRows} />}
      </EvidenceSection>

      {/* ── Ahrefs ───────────────────────────────────────────────────────── */}
      <EvidenceSection
        id="ahrefs" title="Where the site shows up" source="Ahrefs"
        open={open.ahrefs} onToggle={() => toggle('ahrefs')}
        loading={sourcesWaiting}
        empty={sourcesMissing
          ? 'Couldn’t load this — see the message above.'
          : sources && sources.ahrefs.length === 0 ? 'Nothing from Ahrefs. Connect it in Integrations to see more of what the site shows up for.' : undefined}
        summary={summarise([[ahrefs.length, ahrefs.length === 1 ? 'search' : 'searches'], [onFirstPage(ahrefs.map(r => r.position)), 'on the first page']])}
      >
        <p className="kw-sec-desc">
          Every search Ahrefs sees this site in Google for — it often spots ones Search Console misses.
          Spots 11–30 are the near misses worth a post.
        </p>
        {ahrefs.length === 0 ? <p className="kw-sec-desc">{noMatch}</p> : <AhrefsTable rows={ahrefs} addFor={addFor} />}
      </EvidenceSection>

      {/* ── What Google shows ────────────────────────────────────────────── */}
      <EvidenceSection
        id="serp" title="What Google shows" source="Saved Google results"
        open={open.serp} onToggle={() => toggle('serp')}
        loading={insights === null}
        empty={insights !== null && insights.length === 0
          ? 'Nothing saved yet. Google’s results are saved for each post as it’s written.'
          : undefined}
        summary={summarise([[serpRows.length, serpRows.length === 1 ? 'search saved' : 'searches saved']])}
      >
        <p className="kw-sec-desc">
          Google’s results page as it looked for a search — saved for this client’s services when
          research runs, and for each post as it’s written. Open one to see the questions people ask
          and who already ranks.
        </p>
        {serpRows.length === 0
          ? <p className="kw-sec-desc">{noMatch}</p>
          : <SerpInsightsSection rows={serpRows} ownDomains={ownDomains} />}
      </EvidenceSection>

      {/* ── Paid ─────────────────────────────────────────────────────────── */}
      <EvidenceSection
        id="paid" title="Paid searches that brought leads" source="Google Ads, last 90 days"
        open={open.paid} onToggle={() => toggle('paid')}
        loading={sourcesWaiting}
        empty={sourcesMissing
          ? 'Couldn’t load this — see the message above.'
          : sources && sources.paidTerms.length === 0 ? 'No paid searches brought leads in the last 90 days.' : undefined}
        summary={summarise([
          [paid.length, paid.length === 1 ? 'search' : 'searches'],
        ]) + (paid.length ? `, ${fmtLeads(paid.reduce((n, r) => n + r.conversions, 0))} leads` : '')}
      >
        <p className="kw-paid-note">
          These are buying searches — someone ready to hire. The service page should be what ranks for
          them, not a blog post, so they no longer feed topics. Add one as a keyword only when there’s a
          real question behind it worth a post.
        </p>
        {paid.length === 0 ? <p className="kw-sec-desc">{noMatch}</p> : <PaidTable rows={paid} addFor={addFor} />}
      </EvidenceSection>

      {sourcesError && sources && (
        <p className="kw-sec-foot">Some of this may be out of date: the last reload failed ({sourcesError}).</p>
      )}
    </div>
  )
}

/** Whether any of the parts contains the filter text. An empty filter matches everything. */
function matches(q: string, ...parts: (string | null | undefined)[]): boolean {
  return !q || parts.some(p => (p ?? '').toLowerCase().includes(q))
}

/** "3 on the second page, 1 low on page one" — only the parts that are not zero. */
function summarise(parts: [number, string][]): string {
  return parts.filter(([n]) => n > 0).map(([n, what]) => `${n.toLocaleString()} ${what}`).join(', ')
}

/** The first rows, and a button for the rest. */
function useFirst<T>(rows: T[]) {
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, FIRST_ROWS)
  const more = rows.length > FIRST_ROWS ? (
    <button type="button" className="btn btn-ghost btn-sm kw-show-more" onClick={() => setAll(v => !v)} aria-expanded={all}>
      {all ? 'Show fewer' : `Show all ${rows.length}`}
    </button>
  ) : null
  return { shown, more }
}

function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="kw-table-wrap">
      <table className="data-table data-table--compact kw-table">
        <thead><tr>{head}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

/** A page URL as its path — the domain is the same on every row. */
function pagePath(url: string): string {
  try { return new URL(url).pathname || '/' } catch { return url }
}

function GscTable({ rows, addFor }: { rows: GscRow[]; addFor: (term: string) => ReactNode }) {
  const { shown, more } = useFirst(rows)
  return (
    <>
      <Table head={<>
        <th>Search</th>
        <th className="kw-opt">Page</th>
        <th className="kw-r"><Explained name="Times shown" help={HELP.shown}>Shown</Explained></th>
        <th className="kw-r kw-opt">Clicks</th>
        <th className="kw-r kw-opt"><Explained name="Click rate" help={HELP.clickRate}>Click rate</Explained></th>
        <th className="kw-r"><Explained name="Spot in Google" help={HELP.spot}>Spot</Explained></th>
        <th className="kw-act"><span className="sr-only">Add</span></th>
      </>}>
        {shown.map((r, i) => (
          <tr key={`${r.query}-${r.page}-${i}`}>
            <td className="kw-term">
              <span className="kw-term-text">{r.query || '–'}</span>
              {r.recentlyTargeted && (
                <span className="badge badge-gray kw-written" title="A recent post already targets this search">Written about</span>
              )}
            </td>
            <td className="kw-page-cell kw-opt">
              {r.page ? <a href={r.page} target="_blank" rel="noopener noreferrer" title={r.page}>{pagePath(r.page)}</a> : '–'}
            </td>
            <td className="kw-r">{fmtCount(r.impressions)}</td>
            <td className="kw-r kw-opt">{fmtCount(r.clicks)}</td>
            <td className="kw-r kw-opt">{fmtPct(r.ctr)}</td>
            <td className="kw-r"><Spot pos={r.position} decimals /></td>
            <td className="kw-act">{r.query ? addFor(r.query) : null}</td>
          </tr>
        ))}
      </Table>
      {more}
    </>
  )
}

function AhrefsTable({ rows, addFor }: { rows: AhrefsRow[]; addFor: (term: string) => ReactNode }) {
  const { shown, more } = useFirst(rows)
  return (
    <>
      <Table head={<>
        <th>Search</th>
        <th className="kw-r"><Explained name="Spot in Google" help={HELP.spot}>Spot</Explained></th>
        <th className="kw-r"><Explained name="Searches a month" help={HELP.searches}>Searches a month</Explained></th>
        <th className="kw-r kw-opt"><Explained name="Difficulty" help={HELP.difficulty}>Difficulty</Explained></th>
        <th className="kw-act"><span className="sr-only">Add</span></th>
      </>}>
        {shown.map(r => (
          <tr key={r.keyword}>
            <td className="kw-term"><span className="kw-term-text">{r.keyword}</span></td>
            <td className="kw-r"><Spot pos={r.position} /></td>
            <td className="kw-r">{fmtCount(r.volume)}</td>
            <td className="kw-r kw-opt"><Difficulty value={r.difficulty} /></td>
            <td className="kw-act">{addFor(r.keyword)}</td>
          </tr>
        ))}
      </Table>
      {more}
    </>
  )
}

function RankTable({ rows }: { rows: KeywordRankRow[] }) {
  const { shown, more } = useFirst(rows)
  return (
    <>
      <Table head={<>
        <th>Keyword</th>
        <th className="kw-r"><Explained name="Spot in Google" help={HELP.spot}>Spot</Explained></th>
        <th className="kw-r">Change</th>
        <th className="kw-r kw-opt"><Explained name="Searches a month" help={HELP.searches}>Searches a month</Explained></th>
        <th className="kw-r kw-opt"><Explained name="Difficulty" help={HELP.difficulty}>Difficulty</Explained></th>
      </>}>
        {shown.map(r => (
          <tr key={r.keyword_id}>
            <td className="kw-term"><span className="kw-term-text">{r.keyword}</span></td>
            <td className="kw-r"><Spot pos={r.current_position} /></td>
            <td className="kw-r"><Change row={r} /></td>
            <td className="kw-r kw-opt">{fmtCount(r.search_volume)}</td>
            <td className="kw-r kw-opt"><Difficulty value={r.keyword_difficulty} /></td>
          </tr>
        ))}
      </Table>
      {more}
    </>
  )
}

/** Movement in words: "Up 2", "Down 3", "New", "Dropped out". A positive delta moved toward #1. */
function Change({ row }: { row: KeywordRankRow }) {
  if (row.movement === 'dropped') {
    return <span className="kw-change-down" title={row.previous_position != null ? `Was ${row.previous_position}` : undefined}>Dropped out</span>
  }
  if (row.movement === 'entered') return <span className="kw-change-up">New</span>
  const d = row.position_delta
  if (d == null || d === 0) return <span className="kw-muted">No change</span>
  return d > 0
    ? <span className="kw-change-up">▲ Up {Math.abs(d)}</span>
    : <span className="kw-change-down">▼ Down {Math.abs(d)}</span>
}

function PaidTable({ rows, addFor }: { rows: PaidTermRow[]; addFor: (term: string) => ReactNode }) {
  const { shown, more } = useFirst(rows)
  return (
    <>
      <Table head={<>
        <th>Search</th>
        <th className="kw-r"><Explained name="Leads" help={HELP.leads}>Leads</Explained></th>
        <th className="kw-r kw-opt">Spend</th>
        <th className="kw-r">Cost per lead</th>
        <th className="kw-act"><span className="sr-only">Add</span></th>
      </>}>
        {shown.map(r => (
          <tr key={r.term}>
            <td className="kw-term"><span className="kw-term-text">{r.term}</span></td>
            <td className="kw-r">{fmtLeads(r.conversions, true)}</td>
            <td className="kw-r kw-opt">{fmtMoney(r.spend)}</td>
            <td className="kw-r">{fmtMoney(r.costPerLead)}</td>
            <td className="kw-act">{addFor(r.term)}</td>
          </tr>
        ))}
      </Table>
      {more}
    </>
  )
}
