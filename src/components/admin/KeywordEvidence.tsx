'use client'

// What the data says to write about, and how the published posts are doing.
//
// Split out of ClientContentTabPanel when Analytics folded into Keywords: the Keywords tab renders
// these, and importing them from the panel meant a child importing its own parent. Everything here
// was already one unit — the evidence tables, the Search Console blocks and the rankings table
// share one search box. The evidence rows come from the Keywords tab's read of keyword-sources.

import { useState, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { GscData, GscRow } from '@/components/admin/ClientContentTabPanel'

// ─── Formatting ──────────────────────────────────────────────────────────────
function fmtImpr(n: number | null | undefined): string {
  if (!n) return '—'
  if (n >= 10000) return `${Math.round(n / 1000)}k`
  if (n >= 1000)  return `${(n / 1000).toFixed(1)}k`
  return n.toLocaleString()
}
function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—'
  return `${(n * 100).toFixed(1)}%`
}
function fmtPos(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toFixed(1)
}
// Theme variables, not hex: the light greens and yellows these used to be stayed light in dark mode.
function posColor(pos: number | null): string {
  if (!pos) return 'var(--text-muted)'
  if (pos <= 3)  return 'var(--green)'
  if (pos <= 10) return 'var(--amber)'
  return 'var(--text-faint)'
}
function posBg(pos: number | null): string {
  if (!pos) return 'var(--bg-muted)'
  if (pos <= 3)  return 'var(--green-subtle)'
  if (pos <= 10) return 'var(--amber-subtle)'
  return 'var(--bg-muted)'
}
function truncatePage(url: string, max = 44): string {
  try {
    const u    = new URL(url)
    const path = u.pathname
    return path.length > max ? '…' + path.slice(-(max - 1)) : path
  } catch {
    return url.length > max ? url.slice(0, max) + '…' : url
  }
}

function GscSection({
  badge, rows, search,
}: {
  badge: string
  rows:  GscRow[]; search: string
}) {
  const filtered = rows.filter(r => {
    if (!search) return true
    const q = search.toLowerCase()
    return (r.query ?? '').toLowerCase().includes(q) || (r.page ?? '').toLowerCase().includes(q)
  })
  if (filtered.length === 0) return null

  return (
    <div style={{ marginBottom: '1.25rem' }}>
      {/* A sub-heading inside the Search Console card, in the product's own small-label style
          rather than a coloured pill of its own. */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <span className="section-label">{badge}</span>
        <span className="section-desc" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {filtered.length} keyword{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="data-table data-table--compact">
          <thead>
            <tr>
              {(['Query','Page','Impr','Clicks','CTR','Position'] as const).map(h => (
                <th key={h} style={{ textAlign: h === 'Query' || h === 'Page' ? 'left' : 'right', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={i}>
                <td style={{ color: 'var(--text-primary)', fontWeight: 500, maxWidth: 200 }}>
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.query ?? ''}>
                    {r.query || '—'}
                  </span>
                  {r.recentlyTargeted && (
                    <span style={{ fontSize: '0.6rem', color: 'var(--text-faint)', background: 'var(--bg-muted)', padding: '1px 4px', borderRadius: 3 }}>↩ used</span>
                  )}
                </td>
                <td style={{ color: 'var(--blue)', maxWidth: 180 }}>
                  {r.page ? (
                    <a href={r.page} target="_blank" rel="noopener noreferrer"
                      title={r.page}
                      style={{ color: 'var(--blue)', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {truncatePage(r.page)}
                    </a>
                  ) : '—'}
                </td>
                <td style={{ textAlign: 'right' }}>{fmtImpr(r.impressions)}</td>
                <td style={{ textAlign: 'right' }}>{r.clicks ?? '—'}</td>
                <td style={{ textAlign: 'right' }}>{fmtPct(r.ctr)}</td>
                <td style={{ textAlign: 'right' }}>
                  <span style={{
                    display: 'inline-block', padding: '1px 6px', borderRadius: 4,
                    fontWeight: 600, fontSize: '0.75rem',
                    background: posBg(r.position), color: posColor(r.position),
                  }}>
                    {fmtPos(r.position)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// The other sources topic selection reads, from /api/admin/content/keyword-sources. The Keywords
// tab fetches that route once and hands these two lists down; this component used to fetch the
// same route again for itself.
export interface PaidTermRow { term: string; conversions: number; spend: number; costPerLead: number | null }
export interface AhrefsRow   { keyword: string; position: number | null; volume: number | null; difficulty: number | null }
export interface EvidenceSources { paidTerms: PaidTermRow[]; ahrefs: AhrefsRow[] }

/** One column of a source table. `align` defaults to right, because most of these are numbers. */
interface SourceColumn<T> {
  label:  string
  render: (row: T) => React.ReactNode
  left?:  boolean
  /** Hover explanation on the column header, for a figure that needs one. */
  title?: string
}

/**
 * A titled, badged table for one keyword source.
 *
 * Without `emptyText`, renders nothing when the source has no rows — a client without Ahrefs sees
 * no Ahrefs card rather than an empty one. With it, the card stays and says why it is empty. A
 * filter that matches nothing says so instead of making the card vanish.
 */
function SourceSection<T>({
  title, provider, note, emptyText, loading = false, columns, rows, search, searchOn,
}: {
  title: string; provider: string; note?: string; emptyText?: string; loading?: boolean
  columns: SourceColumn<T>[]; rows: T[]; search: string
  searchOn: (row: T) => string
}) {
  const filtered = rows.filter(r => !search || searchOn(r).toLowerCase().includes(search.toLowerCase()))
  if ((loading || rows.length === 0) && !emptyText) return null

  return (
    <div className="card p-5">
      <SectionHead
        title={title} provider={provider}
        count={rows.length > 0 ? filtered.length : undefined}
        desc={rows.length > 0 ? note : undefined}
      />
      {loading ? (
        <p className="section-desc" style={{ margin: 0 }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p className="section-desc" style={{ margin: 0 }}>{emptyText}</p>
      ) : filtered.length === 0 ? (
        <p className="section-desc" style={{ margin: 0 }}>Nothing matches &ldquo;{search}&rdquo;.</p>
      ) : (
        <>
          {/* The product's own table styling, rather than a private copy of it — these tables used
              hand-rolled padding and borders a shade off every other table in the admin. */}
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table data-table--compact">
              <thead>
                <tr>
                  {columns.map(c => (
                    <th key={c.label} title={c.title}
                      style={{ textAlign: c.left ? 'left' : 'right', whiteSpace: 'nowrap', cursor: c.title ? 'help' : undefined }}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 25).map((row, i) => (
                  <tr key={i}>
                    {columns.map(c => (
                      <td key={c.label} style={{
                        textAlign: c.left ? 'left' : 'right',
                        color: c.left ? 'var(--text-primary)' : undefined,
                      }}>{c.render(row)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > 25 && (
            <p className="section-desc" style={{ margin: '8px 0 0' }}>
              Showing the top 25 of {filtered.length}.
            </p>
          )}
        </>
      )}
    </div>
  )
}

// Keyword rank row from the DataForSEO datastream (/api/admin/content/keyword-rankings).
interface KeywordRankRow {
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

export function AnalyticsTab({ data, clientId, isActive, epoch, hasDataForSeo = true, sources, sourcesLoading = false, sourcesError = null, onRefreshed }: {
  data: GscData; clientId: string; isActive: boolean; epoch: number
  /** Rankings is the one section that is purely DataForSEO, so it says so when there is none. */
  hasDataForSeo?: boolean
  /** Converting ad terms and Ahrefs rows, from the Keywords tab's one read of keyword-sources. */
  sources: EvidenceSources | null
  /** That read is in flight — so Reload can say "updated" only once it has landed. */
  sourcesLoading?: boolean
  sourcesError?: string | null
  /** Reload re-reads the whole page, including the parts this component does not own. */
  onRefreshed?: () => void
}) {
  const router           = useRouter()
  const [search, setSearch]       = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [ranks, setRanks]           = useState<KeywordRankRow[] | null>(null)
  const [refreshNote, setRefreshNote] = useState<{ text: string; error: boolean } | null>(null)
  // The server-rendered Search Console rows come back through router.refresh(); inside a
  // transition, isPending says when they actually have.
  const [gscPending, startGscRefresh] = useTransition()

  // Research ran elsewhere (epoch moved): forget what was loaded so the loading state shows
  // while the effects below fetch again. Runs once on mount as well, where clearing
  // already-empty state changes nothing.
  useEffect(() => { setRanks(null) }, [epoch])

  // Every table is fetched each time this tab is shown, and again on epoch or Refresh. A tab
  // that fetched once and then trusted itself showed a list from before a "Look again" run
  // until the page was reloaded — the old rows stayed on screen while a fetch is in flight.
  const [loadTick, setLoadTick] = useState(0)
  useEffect(() => { if (isActive) setLoadTick(t => t + 1) }, [isActive, epoch])

  useEffect(() => {
    if (!loadTick) return
    let cancelled = false
    fetch(`/api/admin/content/keyword-rankings?client_id=${clientId}`)
      .then(r => r.ok ? r.json() : { rankings: [] })
      .then(d => { if (!cancelled) setRanks((d.rankings ?? []) as KeywordRankRow[]) })
      .catch(() => { if (!cancelled) setRanks([]) })
    return () => { cancelled = true }
  }, [loadTick, clientId])

  /**
   * Re-read everything on the page from our own database. Nothing external, nothing billable.
   *
   * This used to POST /api/admin/sync, pulling Search Console live and waiting on Google before
   * it would show you anything — a heavy, slow, surprising thing to sit behind a button labelled
   * "Refresh" next to a filter box. Syncing is a scheduled job; this is the button that shows you
   * what the last sync brought in, and it is labelled Reload for that reason.
   */
  function handleRefresh() {
    setRefreshing(true)
    setRefreshNote(null)
    // router.refresh() does not clear component state, so the rankings are cleared here for the
    // effect above to fetch again.
    setRanks(null)
    setLoadTick(t => t + 1)
    // The keyword sources belong to the Keywords tab, which reloads them in the same click.
    onRefreshed?.()
    // Search Console rows are rendered by the server component, so the page itself re-renders.
    startGscRefresh(() => router.refresh())
  }

  // "Updated" is said when everything has actually come back — the rankings, the sources the
  // Keywords tab reloads, and the server-rendered Search Console rows — not the moment the button
  // is pressed, which is when it used to appear.
  useEffect(() => {
    if (!refreshing || ranks === null || sourcesLoading || gscPending) return
    setRefreshing(false)
    setRefreshNote(sourcesError
      ? { text: `Couldn’t reload everything (${sourcesError})`, error: true }
      : { text: 'Updated just now', error: false })
  }, [refreshing, ranks, sourcesLoading, sourcesError, gscPending])

  useEffect(() => {
    if (!refreshNote) return
    const t = setTimeout(() => setRefreshNote(null), 8000)
    return () => clearTimeout(t)
  }, [refreshNote])

  const isEmpty = data.quickWins.length === 0 && data.growth.length === 0
    && data.lowCtr.length === 0 && data.highVolume.length === 0

  const filteredRanks = (ranks ?? []).filter(r =>
    !search || r.keyword.toLowerCase().includes(search.toLowerCase()))

  return (
    // One gap between every card on the page, set here rather than as a marginBottom on each one.
    // Per-card margins are what made the spacing collapse between Search Console and Rankings:
    // the card before them had its own margin, those two did not.
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* The title lives on the Keywords tab; this row is only the two controls. The refresh
          button carried its icon as a "↻" inside the label, which wrapped onto its own line the
          moment the row got tight — an icon stacked above its own word. It is an inline SVG with
          a nowrap label now, so the button is one line at any width. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {refreshNote && (
          <span role="status" style={{ marginRight: 'auto', fontSize: '0.75rem', color: refreshNote.error ? 'var(--red)' : 'var(--text-faint)' }}>
            {refreshNote.text}
          </span>
        )}
        <button
          type="button"
          className="btn btn-secondary"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
            fontSize: '0.8125rem', padding: '0.375rem 0.75rem', flexShrink: 0,
          }}
          onClick={handleRefresh}
          disabled={refreshing}
          title="Re-read every table on this tab from the last sync. Doesn’t contact Google or spend anything."
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden
            style={refreshing ? { animation: 'ccSpin 0.9s linear infinite' } : undefined}>
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <polyline points="21 3 21 9 15 9" />
          </svg>
          {refreshing ? 'Reloading…' : 'Reload'}
        </button>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter keywords or pages…"
          className="input"
          style={{ width: 240, maxWidth: '100%', fontSize: '0.8125rem', padding: '0.375rem 0.625rem' }}
        />
      </div>

      {/* ── The sources that feed topic selection ──────────────────────────── */}
      <SourceSection<PaidTermRow>
        title="Converted in paid" provider="Google Ads"
        note="Terms that produced leads in the last 90 days. These are buying searches — the service page should own them, so write the question a buyer asks on the way there."
        rows={sources?.paidTerms ?? []} search={search}
        searchOn={r => r.term}
        columns={[
          { label: 'Search term', left: true, render: r => r.term },
          { label: 'Leads',       render: r => r.conversions.toFixed(1) },
          { label: 'Spend',       render: r => `$${r.spend.toFixed(2)}` },
          { label: 'Cost / lead', render: r => r.costPerLead == null ? '—' : `$${r.costPerLead.toFixed(2)}` },
        ]}
      />

      <SourceSection<AhrefsRow>
        title="Organic positions" provider="Ahrefs"
        note="Positions Search Console under-reports. 11–30 are the near-misses."
        rows={sources?.ahrefs ?? []} search={search}
        searchOn={r => r.keyword}
        columns={[
          { label: 'Keyword',    left: true, render: r => r.keyword },
          { label: 'Google position', title: 'Where the site currently ranks', render: r => r.position   == null ? '—' : `#${r.position}` },
          { label: 'Searches/mo', title: 'Average searches a month', render: r => r.volume     == null ? '—' : r.volume.toLocaleString() },
          { label: 'Difficulty', title: 'How hard it is to rank, 0–100. Under 30 is winnable quickly.', render: r => r.difficulty == null ? '—' : String(r.difficulty) },
        ]}
      />

      {/* ── Search Console insights ────────────────────────────────────────── */}
      {/* Labelled the same way whether or not it has anything in it — an unlabelled card of grey
          text in the middle of a labelled page reads as something having gone wrong. */}
      <div className="card p-5">
        <SectionHead
          title="Search Console" provider="Google"
          desc={isEmpty ? undefined : 'What this site already shows up for, and where it nearly does.'}
        />
        {isEmpty ? (
          <p className="section-desc" style={{ margin: 0 }}>
            Nothing here yet. Connect Google Search Console and run a sync.
          </p>
        ) : (
          <>
            <GscSection badge="Growth opportunities" rows={data.growth}     search={search} />
            <GscSection badge="Quick wins"           rows={data.quickWins}  search={search} />
            <GscSection badge="Low CTR"              rows={data.lowCtr}     search={search} />
            <GscSection badge="High volume, low rank" rows={data.highVolume} search={search} />
          </>
        )}
      </div>

      {/* ── Rankings ───────────────────────────────────────────────────────── */}
      {/* Last, because it reports on what is already published rather than informing what to write
          next, and because it is the one section that is purely DataForSEO — a client without a
          connection has nothing here and should be told why rather than shown an empty table. */}
      <div className="card p-5">
        <SectionHead
          title="Rankings" provider="DataForSEO"
          count={ranks === null ? undefined : filteredRanks.length}
          desc={ranks && ranks.length > 0 ? 'Where the published posts sit in Google, checked on a schedule.' : undefined}
        />
        <KeywordRankTable ranks={filteredRanks} loading={ranks === null} hasDataForSeo={hasDataForSeo} />
      </div>
    </div>
  )
}

/**
 * The header every section on this page wears.
 *
 * It used to be a coloured pill in a colour unique to each section, which nothing else in this
 * product does — the rest of the admin uses `.section-title` with a `.section-desc` under it, and
 * six pills in six colours read as decoration competing with the sentence beside them. This is
 * that same pattern: the name on the left, where it came from and how many rows on the right,
 * quiet.
 *
 * Counts are in "keywords" throughout. They are all keywords here, whichever system reported
 * them, and the page previously alternated between "terms" and "keywords" for the same idea.
 */
export function SectionHead({ title, provider, count, desc }: {
  title: string; provider?: string; count?: number; desc?: string
}) {
  return (
    <div style={{ marginBottom: desc ? 10 : 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h3 className="section-title" style={{ margin: 0 }}>{title}</h3>
        {(provider || count != null) && (
          <span className="section-desc" style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
            {[provider, count == null ? null : `${count} keyword${count === 1 ? '' : 's'}`]
              .filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
      {desc && <p className="section-desc" style={{ margin: '2px 0 0' }}>{desc}</p>}
    </div>
  )
}

function KeywordRankTable({ ranks, loading, hasDataForSeo = true }: {
  ranks: KeywordRankRow[]; loading: boolean; hasDataForSeo?: boolean
}) {
  if (loading) {
    return <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-faint)' }}>Loading rankings…</p>
  }
  if (ranks.length === 0) {
    // Two different empty states. Without a connection this section can never fill, and saying
    // "no rankings yet" would read as "give it time" when the answer is "connect something".
    return (
      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
        {hasDataForSeo
          ? 'No rankings yet. A keyword starts being tracked once this client’s first post goes live, or sooner if the site already ranks for something.'
          : 'Rank tracking needs DataForSEO, which this client does not have connected. Everything else on this page works without it.'}
      </p>
    )
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table data-table--compact">
        <thead>
          <tr>
            {(['Keyword','Position','Change','Volume','Difficulty'] as const).map(h => (
              <th key={h} style={{ textAlign: h === 'Keyword' ? 'left' : 'right', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ranks.map(r => (
            <tr key={r.keyword_id}>
              <td style={{ color: 'var(--text-primary)', fontWeight: 500, maxWidth: 260 }}>
                <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.keyword}>
                  {r.keyword}
                </span>
              </td>
              <td style={{ textAlign: 'right' }}>
                <span style={{
                  display: 'inline-block', padding: '1px 6px', borderRadius: 4,
                  fontWeight: 600, fontSize: '0.75rem',
                  background: posBg(r.current_position), color: posColor(r.current_position),
                }}>
                  {r.current_position ?? '—'}
                </span>
              </td>
              <td style={{ textAlign: 'right' }}>
                {r.movement === 'dropped'
                  ? <span style={{ color: 'var(--red)', fontWeight: 600, fontSize: '0.75rem' }} title={r.previous_position != null ? `was #${r.previous_position}` : undefined}>dropped</span>
                  : r.movement === 'entered'
                  ? <span style={{ color: 'var(--green)', fontWeight: 600, fontSize: '0.75rem' }}>new</span>
                  : <RankDelta delta={r.position_delta} />}
              </td>
              <td style={{ textAlign: 'right' }}>{fmtImpr(r.search_volume)}</td>
              <td style={{ textAlign: 'right' }}>
                {r.keyword_difficulty == null ? '—' : Math.round(r.keyword_difficulty)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Rank movement pill. Positive delta = improved (moved toward #1) → green ▲.
function RankDelta({ delta }: { delta: number | null }) {
  if (delta == null || delta === 0) return <span style={{ color: 'var(--text-faint)' }}>—</span>
  const improved = delta > 0
  return (
    <span style={{ color: improved ? 'var(--green)' : 'var(--red)', fontWeight: 600, fontSize: '0.75rem' }}>
      {improved ? '▲' : '▼'} {Math.abs(delta)}
    </span>
  )
}
