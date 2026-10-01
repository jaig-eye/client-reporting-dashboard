'use client'

// The Keywords tab: deciding what this client's blog posts are written about.
//
// THE DECISION FIRST
//
// The page exists for one decision — which keywords blog topics are chosen from — and it used to
// make you scroll past five tables of evidence to reach it, starting with a table of paid search
// terms that no longer feed topics at all. It reads top to bottom in the order you think now:
//
//   Where this client stands   ticked vs available, the market, when research last looked and
//                              when it looks again — and the one control that spends (Find new)
//   What we write about        the list you tick, with what is in use shown above it
//   What the data says         the evidence, one closed card per source, paid searches last
//
// ONE PAGE, NOT THREE VIEWS
//
// This was briefly a tablist — Evidence, Rankings, Pick. It read as three places to go and it was
// really one subject, so the tabs cost a click to find out a view was empty and hid the rest of the
// page while you were in any one of them. The evidence cards do the same job without hiding
// anything: every source's header says what is in it before you open it.
//
// Research location is gone entirely. It was a second location field whose only job was to name
// the market, which the first service area already does; nobody had ever set it. The market is
// derived and shown, not asked for.

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import KeywordResearchPanel, { type ResearchKeyword } from '@/components/admin/KeywordResearchPanel'
import KeywordChipInput, { splitPhrases } from '@/components/admin/KeywordChipInput'
import KeywordEvidence, { type AddProgress, type AhrefsRow, type EvidenceSources, type KeywordRankRow, type PaidTermRow } from '@/components/admin/KeywordEvidence'
import { NoticeLine, PlusIcon, RefreshIcon, SkeletonRows, fmtDay, type Notice } from '@/components/admin/KeywordUi'
import type { SerpInsightRow } from '@/lib/content/serpInsights'
import type { SiteOption } from '@/lib/content/types'
import type { GscData } from '@/components/admin/ClientContentTabPanel'

interface Payload {
  researched:        ResearchKeyword[]
  /** Converting paid search terms and Ahrefs rows, for the evidence cards. */
  paidTerms:         PaidTermRow[]
  ahrefs:            AhrefsRow[]
  researchLocation?: string | null
  /** Candidates in the pool behind the ones shown. */
  poolTotal?:        number | null
  /** When research last ran. */
  lastResearchAt?:   string | null
  /** Whether this client has a DataForSEO connection — without one nothing can be researched. */
  hasDataForSeo?:    boolean
  /** The client's services in its own order; the list can be read service by service. */
  services:          string[]
}

/** Matches the monthly job: a client is due for research once its last run is 30 days old. */
const RESEARCH_EVERY_DAYS = 30

const NO_SITES: SiteOption[] = []

export default function KeywordsTab({ clientId, isActive, epoch, sites = NO_SITES, gscData, onResearchRun }: {
  clientId: string
  isActive: boolean
  /** Search Console rows, for the evidence. */
  gscData:  GscData
  /** The client's own sites, so their own line is marked in a list of competitors. */
  sites?:   SiteOption[]
  /** Bumped when research reruns elsewhere, so this refetches rather than showing a stale list. */
  epoch:    number
  /** After research runs here, so the parent bumps `epoch` and everything reading the pool reloads. */
  onResearchRun?: () => void
}) {
  const router = useRouter()
  const [data,    setData]    = useState<Payload | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [reload,  setReload]  = useState(0)
  // What Google showed for this client's keywords, and where its posts rank.
  const [insights, setInsights] = useState<SerpInsightRow[] | null>(null)
  const [ranks,    setRanks]    = useState<KeywordRankRow[] | null>(null)
  const [rankTick, setRankTick] = useState(0)

  const [showAdd, setShowAdd] = useState(false)
  const [draft,   setDraft]   = useState('')
  // Text typed into the chip box but not yet turned into a chip. Without it the Add button stays
  // disabled until you press Enter, so typing a phrase and clicking Add does nothing.
  const [pending, setPending] = useState('')
  const [adding,  setAdding]  = useState(false)
  const [addNotice, setAddNotice] = useState<Notice | null>(null)
  /** Adds started from an evidence row, by lower-cased term. */
  const [rowAdds, setRowAdds] = useState<AddProgress>(() => new Map())

  const [busy,    setBusy]    = useState(false)
  const [confirmResearch, setConfirmResearch] = useState(false)
  const [researchNotice,  setResearchNotice]  = useState<Notice | null>(null)
  const [dirty,   setDirty]   = useState(false)
  // Unsaved picks close the "look now" confirmation, so saving them can't reopen it unasked.
  useEffect(() => { if (dirty) setConfirmResearch(false) }, [dirty])

  const [refreshing,  setRefreshing]  = useState(false)
  const [refreshNote, setRefreshNote] = useState<{ text: string; error: boolean } | null>(null)
  // The server-rendered Search Console rows come back through router.refresh(); inside a
  // transition, isPending says when they actually have.
  const [gscPending, startGscRefresh] = useTransition()

  // One read of keyword-sources for the whole tab — the list, the summary and the evidence all
  // come from it — plus the saved Google results beside it.
  useEffect(() => {
    if (!isActive) return
    let cancelled = false
    setError(null)
    setLoading(true)
    fetch(`/api/admin/content/keyword-sources?client_id=${clientId}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => { if (!cancelled) setData({
        researched:       d.researched ?? [],
        paidTerms:        d.paidTerms ?? [],
        ahrefs:           d.ahrefs ?? [],
        researchLocation: d.researchLocation ?? null,
        poolTotal:        d.poolTotal ?? null,
        lastResearchAt:   d.lastResearchAt ?? null,
        hasDataForSeo:    d.hasDataForSeo !== false,
        services:         Array.isArray(d.services) ? (d.services as unknown[]).map(String).filter(Boolean) : [],
      }) })
      // Keep whatever was loaded before, and never stand in an empty list: an empty list offers to
      // find keywords, which on a failed load invited a paid run that wipes the unchosen half of a
      // pool that was there all along.
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load') })
      .finally(() => { if (!cancelled) setLoading(false) })
    fetch(`/api/admin/content/serp-insights?client_id=${clientId}`)
      .then(r => r.ok ? r.json() : { insights: [] })
      .then(d => { if (!cancelled) setInsights((d as { insights?: SerpInsightRow[] }).insights ?? []) })
      .catch(() => { if (!cancelled) setInsights([]) })
    return () => { cancelled = true; setLoading(false) }
  }, [clientId, isActive, epoch, reload])

  // Research ran elsewhere (epoch moved): forget the ranks so the loading state shows while they
  // are fetched again.
  useEffect(() => { setRanks(null) }, [epoch])

  // Rankings are fetched each time the tab is shown, and again on epoch or Reload. A tab that
  // fetched once and then trusted itself showed a list from before a research run until the page
  // was reloaded.
  useEffect(() => {
    if (!isActive) return
    let cancelled = false
    fetch(`/api/admin/content/keyword-rankings?client_id=${clientId}`)
      .then(r => r.ok ? r.json() : { rankings: [] })
      .then(d => { if (!cancelled) setRanks(((d as { rankings?: KeywordRankRow[] }).rankings ?? [])) })
      .catch(() => { if (!cancelled) setRanks([]) })
    return () => { cancelled = true }
  }, [clientId, isActive, epoch, rankTick])

  /**
   * Re-read everything on the page from our own database. Nothing external, nothing billable.
   *
   * Syncing is a scheduled job; this is the button that shows you what the last sync brought in,
   * and it is labelled Reload for that reason.
   */
  const reloadAll = useCallback(() => {
    setRefreshing(true)
    setRefreshNote(null)
    setRanks(null)
    setRankTick(t => t + 1)
    setReload(v => v + 1)
    // Search Console rows are rendered by the server component, so the page itself re-renders.
    startGscRefresh(() => router.refresh())
  }, [router])

  // "Updated" is said when everything has actually come back — the rankings, the sources and the
  // server-rendered Search Console rows — not the moment the button is pressed.
  useEffect(() => {
    if (!refreshing || ranks === null || loading || gscPending) return
    setRefreshing(false)
    setRefreshNote(error
      ? { text: `Couldn’t reload everything (${error})`, error: true }
      : { text: 'Updated just now', error: false })
  }, [refreshing, ranks, loading, error, gscPending])

  useEffect(() => {
    if (!refreshNote) return
    const t = setTimeout(() => setRefreshNote(null), 8000)
    return () => clearTimeout(t)
  }, [refreshNote])

  // Stable identities for what the children memoize on. Built inline, each was a new array on
  // every render, so the keyword list regrouped itself on every keystroke in the add box.
  const evidence = useMemo<EvidenceSources | null>(
    () => data ? { paidTerms: data.paidTerms, ahrefs: data.ahrefs } : null, [data])
  const inUse = useMemo(
    () => new Set((data?.researched ?? []).filter(k => k.chosen).map(k => k.keyword.toLowerCase())), [data])
  // Rank-tracked keywords never appear in the list you tick from, so an evidence row for one says
  // "Tracked" rather than offering an Add whose result could not be seen.
  const tracked = useMemo(() => new Set((ranks ?? []).map(r => r.keyword.toLowerCase())), [ranks])
  const ownDomains = useMemo(() => sites.map(s => s.siteUrl), [sites])
  const place    = data?.researchLocation ? data.researchLocation.split(',')[0] : null
  const geoWords = useMemo(() => place ? [place] : [], [place])
  const hasDfs   = data?.hasDataForSeo !== false
  const reloadSources = useCallback(() => setReload(v => v + 1), [])

  /**
   * Put keywords into the pool, already chosen. The one path for both ways in: typed into the box,
   * or added from a row of evidence. Throws with the server's sentence when it fails.
   */
  const addKeywords = useCallback(async (list: string[]): Promise<void> => {
    const res = await fetch('/api/admin/content/keyword-research', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, add: list }),
    })
    const body = await res.json().catch(() => ({})) as { error?: string; added?: number; rechosen?: number }
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
    const n = (body.added ?? 0) + (body.rechosen ?? 0)
    setAddNotice(n
      ? { tone: 'success', text: n === 1 && list.length === 1 ? `Added “${list[0]}” — it’s in use.` : `Added ${n}, in use.` }
      : { tone: 'neutral', text: 'Nothing new to add — those are already in use.' })
    setReload(v => v + 1)
  }, [clientId])

  /**
   * Add what is in the box to the pool, already chosen.
   *
   * Phrases already in use, or already rank-tracked, are set aside first and named. The server
   * counts any row it already holds as "chosen again", so sending them came back as "Added — it's
   * in use" for a keyword that was in use all along, or for a tracked one that this list never
   * shows. The evidence rows make the same check before offering Add.
   */
  const addTyped = useCallback(async () => {
    const list = splitPhrases([draft, pending].filter(Boolean).join(', '))
    if (!list.length) return
    const norm = (k: string) => k.trim().toLowerCase().replace(/\s+/g, ' ')
    const already = list.filter(k => inUse.has(norm(k)))
    const isTracked = list.filter(k => !inUse.has(norm(k)) && tracked.has(norm(k)))
    const toSend = list.filter(k => !inUse.has(norm(k)) && !tracked.has(norm(k)))
    const quote = (l: string[]) => l.map(k => `“${k}”`).join(', ')
    const setAside = [
      already.length ? `${quote(already)} ${already.length === 1 ? 'is' : 'are'} already in use.` : '',
      isTracked.length
        ? `${quote(isTracked)} ${isTracked.length === 1 ? 'is' : 'are'} already tracked — a post targets ${isTracked.length === 1 ? 'it' : 'them'} or the site ranks for ${isTracked.length === 1 ? 'it' : 'them'} — so ${isTracked.length === 1 ? 'it isn’t' : 'they aren’t'} in this list.`
        : '',
    ].filter(Boolean).join(' ')
    setAddNotice(null)
    if (!toSend.length) {
      setAddNotice({ tone: 'neutral', text: setAside })
      setDraft(''); setPending('')
      return
    }
    setAdding(true)
    try {
      await addKeywords(toSend)
      if (setAside) setAddNotice(n => n ? { ...n, text: `${n.text} ${setAside}` } : { tone: 'neutral', text: setAside })
      setDraft(''); setPending('')
      setShowAdd(false)
    } catch (e) {
      setAddNotice({ tone: 'error', text: e instanceof Error ? `Couldn’t add: ${e.message}` : 'Couldn’t add those' })
    } finally {
      setAdding(false)
    }
  }, [addKeywords, draft, pending, inUse, tracked])

  /** Add one search from the evidence. Its row shows the progress; the list above shows the result. */
  const addFromEvidence = useCallback(async (term: string) => {
    const key = term.toLowerCase()
    setRowAdds(m => new Map(m).set(key, { state: 'adding' }))
    setAddNotice(null)
    try {
      await addKeywords([term])
      setRowAdds(m => { const n = new Map(m); n.delete(key); return n })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Couldn’t add this'
      setRowAdds(m => new Map(m).set(key, { state: 'error', error: msg }))
      setAddNotice({ tone: 'error', text: `Couldn’t add “${term}”: ${msg}` })
    }
  }, [addKeywords])

  /** Look for new ideas. Replaces the unchosen; anything in use survives. */
  const research = useCallback(async () => {
    setBusy(true); setResearchNotice(null)
    try {
      const res = await fetch('/api/admin/content/keyword-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, force: true }),
      })
      const body = await res.json().catch(() => ({})) as { error?: string; ok?: boolean; reason?: string; discovered?: number }
      if (!res.ok) {
        // 403 for a viewer, 429 within the hour after the last run: the server's sentence says
        // which. The second is a wait, not a failure.
        setResearchNotice({ tone: res.status === 429 ? 'warning' : 'error', text: body.error ?? `Couldn’t look for new keywords (HTTP ${res.status}).` })
        return
      }
      if (body.ok === false) {
        // Nothing new was stored — over budget, no connection, a failed write — and the pool was
        // left as it was, so there is nothing to reload. This is not success.
        setResearchNotice({ tone: 'warning', text: body.reason ?? 'Nothing new was stored.' })
        return
      }
      const n = body.discovered ?? 0
      setResearchNotice(n > 0
        ? { tone: 'success', text: `Found ${n.toLocaleString()} new keyword${n === 1 ? '' : 's'}.` }
        : { tone: 'neutral', text: 'No new keywords this time.' })
      setReload(v => v + 1)
      onResearchRun?.()
    } catch (e) {
      setResearchNotice({ tone: 'error', text: e instanceof Error ? e.message : 'Couldn’t look for new keywords' })
    } finally {
      setBusy(false)
    }
  }, [clientId, onResearchRun])

  // ── What the summary says ────────────────────────────────────────────────
  const ticked    = inUse.size
  const available = data ? Math.max(data.poolTotal ?? 0, data.researched.length) : 0
  const lastRun   = fmtDay(data?.lastResearchAt)
  const nextRun   = useMemo(() => {
    if (!data?.lastResearchAt) return null
    const d = new Date(data.lastResearchAt)
    if (Number.isNaN(d.getTime())) return null
    d.setDate(d.getDate() + RESEARCH_EVERY_DAYS)
    return d
  }, [data?.lastResearchAt])
  const nextLabel = nextRun
    ? (nextRun.getTime() <= Date.now() ? 'Due now — the daily check picks it up within a day or two.' : `Looks again by itself around ${fmtDay(nextRun)}.`)
    : 'The daily check runs it within a few days.'
  const emptyServiceHint = hasDfs
    ? (nextRun && nextRun.getTime() > Date.now() ? `Research looks for more around ${fmtDay(nextRun)}, or add your own.` : 'Research looks for more once a month, or add your own.')
    : 'Add your own, or add one from the evidence below.'

  return (
    <div className="kw-page">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="kw-head">
        <div>
          <h3 className="kw-title">Keywords</h3>
          <p className="kw-lede">
            The searches this client’s blog posts are written for. Tick them in the list; the data
            further down helps you choose.
          </p>
        </div>
        <div className="kw-head-actions">
          {refreshNote && (
            <span role="status" className={`kw-head-note${refreshNote.error ? ' kw-head-note--error' : ''}`}>{refreshNote.text}</span>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={reloadAll}
            disabled={refreshing}
            title="Re-read everything on this tab from the last sync. Doesn’t contact Google or spend anything."
          >
            <RefreshIcon spinning={refreshing} />
            {refreshing ? 'Reloading…' : 'Reload'}
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="kw-alert">
          <p>
            Couldn&apos;t load the keywords ({error}).
            {data ? ' What you see is from the last time it loaded.' : ' The list you tick from appears once it loads.'}
          </p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReload(v => v + 1)}>
            Retry
          </button>
        </div>
      )}

      {/* ── Where this client stands ───────────────────────────────────── */}
      {!(data === null && error) && (
        <section className="card kw-strip" aria-label="Where this client stands">
          <div className="kw-stat">
            <div className="kw-stat-label">Ticked for blog topics</div>
            {data === null ? <StatSkeleton /> : (
              <>
                <div className="kw-stat-value">
                  {ticked.toLocaleString()}
                  {available > 0 && <> <small>of {available.toLocaleString()}</small></>}
                </div>
                <p className={`kw-stat-sub${ticked === 0 || dirty ? ' kw-stat-sub--warn' : ''}`}>
                  {dirty
                    ? 'You have unsaved changes in the list below.'
                    : ticked === 0
                      ? (available ? 'None yet. Tick some below to steer new topics.' : 'Nothing to choose from yet.')
                      : 'New topics favour these, alongside what Search Console and rankings show.'}
                </p>
              </>
            )}
          </div>

          <div className="kw-stat">
            <div className="kw-stat-label">Market</div>
            {data === null ? <StatSkeleton /> : (
              <>
                <div className="kw-stat-value">{place ?? (hasDfs ? 'Whole country' : 'Not measured')}</div>
                <p className="kw-stat-sub">
                  {place
                    ? 'Search counts are for this area, read from the service areas.'
                    : hasDfs
                      ? 'No service area matched a place Google knows, so search counts are national. Put a city or county first.'
                      : 'Search counts come with DataForSEO research.'}
                </p>
              </>
            )}
          </div>

          <div className="kw-stat">
            <div className="kw-stat-label">Research</div>
            {data === null ? <StatSkeleton /> : hasDfs ? (
              <>
                <div className="kw-stat-value">{lastRun ? <>Looked {lastRun}</> : 'Not run yet'}</div>
                <p className="kw-stat-sub">{nextLabel}</p>
                {confirmResearch && !dirty ? (
                  <div className="kw-confirm" role="group" aria-label="Confirm looking for new keywords">
                    This buys a fresh search from DataForSEO, which costs money. Unticked keywords
                    are replaced; saved ticks stay.
                    <span className="kw-inline-actions">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmResearch(false)}>Cancel</button>
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => { setConfirmResearch(false); void research() }}>Look now</button>
                    </span>
                  </div>
                ) : (
                  <div className="kw-stat-action">
                    {/* Not while ticks are unsaved: a run replaces every keyword that isn't saved as
                        ticked, and those rows — with the ticks on them — would go with it. */}
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setConfirmResearch(true)}
                      disabled={busy || adding || dirty}
                      aria-describedby={dirty ? `kw-research-hold-${clientId}` : undefined}
                      title="Asks DataForSEO for new keyword ideas now. Costs money; saved ticks stay."
                    >
                      <RefreshIcon spinning={busy} />
                      {busy ? 'Looking…' : 'Find new keywords'}
                    </button>
                    {dirty && !busy && (
                      <span id={`kw-research-hold-${clientId}`} className="kw-stat-sub kw-stat-sub--warn" style={{ margin: 0 }}>
                        Save your picks first.
                      </span>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="kw-stat-value">Not set up</div>
                {/* States a fact about the CONNECTION, not a claim about the rows in the list:
                    a client that had DataForSEO when research last ran keeps those numbers. A
                    run from here could only report that there is no connection, so this says it
                    up front instead of offering a button that can do nothing else. */}
                <p className="kw-stat-sub">
                  Finding keywords by itself needs a DataForSEO connection. Add your own below, or add
                  them straight from the evidence.
                </p>
              </>
            )}
          </div>
        </section>
      )}
      <NoticeLine notice={researchNotice} />

      {/* ── What we write about ────────────────────────────────────────── */}
      {!(data === null && error) && (
        <section className="card kw-pick-card" aria-labelledby={`kw-pick-${clientId}`}>
          <div className="kw-card-head">
            <div>
              <h3 id={`kw-pick-${clientId}`} className="kw-card-title">What we write about</h3>
              <p className="kw-card-desc">
                Tick the keywords new blog topics should favour. Of the keywords research finds, only
                ticked ones are used; topics also draw on Search Console and rankings. Changes count
                once saved.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => { setShowAdd(v => !v); setAddNotice(null) }}
              disabled={adding || busy}
              aria-expanded={showAdd}
            >
              {showAdd ? 'Cancel' : (<><PlusIcon /> Add your own</>)}
            </button>
          </div>

          <div className="kw-card-body">
            {showAdd && (
              <div className="kw-add-box">
                <KeywordChipInput
                  value={draft}
                  onChange={setDraft}
                  onPending={setPending}
                  disabled={adding}
                  max={30}
                  ariaLabel="Keywords to add"
                  placeholder="permanent Christmas lights, soffit lighting installers…"
                />
                <div className="kw-add-row">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => void addTyped()}
                    disabled={adding || !splitPhrases([draft, pending].filter(Boolean).join(', ')).length}
                  >
                    {adding ? 'Adding…' : 'Add'}
                  </button>
                  <span className="kw-add-note">
                    {hasDfs
                      ? 'Added ticked, with search counts where Google reports them. Separate several with commas.'
                      : 'Added ticked, straight into the list. Separate several with commas.'}
                  </span>
                </div>
              </div>
            )}

            {/* The result of the last add, where the button that caused it is — not at the bottom
                of a scrolled page, which is why adding a keyword used to look like it did nothing. */}
            <NoticeLine notice={addNotice} />

            {data === null ? (
              <div className="kw-list" aria-busy="true" aria-label="Loading the keywords"><SkeletonRows rows={7} /></div>
            ) : (
              <KeywordResearchPanel
                clientId={clientId}
                keywords={data.researched}
                services={data.services}
                geoWords={geoWords}
                place={place}
                total={data.poolTotal}
                lastResearchAt={data.lastResearchAt}
                hideSummary
                onChanged={reloadSources}
                onDirtyChange={setDirty}
                emptyHint={hasDfs
                  ? 'Research fills this by itself once a month, or use Find new keywords above. You can also add your own.'
                  : 'Add your own with the button above, or add them from the evidence below.'}
                emptyServiceHint={emptyServiceHint}
                // A forced run replaces the unchosen half of the pool, so a save racing it would
                // write ticks against rows that are about to go. Adding by hand reloads the list too.
                busy={busy || adding}
              />
            )}
          </div>
        </section>
      )}

      {/* ── What the data says ─────────────────────────────────────────── */}
      <KeywordEvidence
        gsc={gscData}
        sources={evidence}
        sourcesLoading={loading}
        sourcesError={error}
        ranks={ranks}
        insights={insights}
        ownDomains={ownDomains}
        hasDataForSeo={hasDfs}
        inUse={inUse}
        tracked={tracked}
        adds={rowAdds}
        onAdd={data ? (t => void addFromEvidence(t)) : undefined}
      />
    </div>
  )
}

function StatSkeleton() {
  return (
    <div aria-hidden>
      <span className="skeleton" style={{ display: 'block', width: 90, height: 22, marginTop: 8 }} />
      <span className="skeleton" style={{ display: 'block', width: '70%', height: 10, marginTop: 9 }} />
    </div>
  )
}
