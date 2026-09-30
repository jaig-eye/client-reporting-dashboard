'use client'

// The Keywords tab: deciding what this client should be found for.
//
// ONE PAGE, NOT THREE VIEWS
//
// This was briefly a tablist — Evidence, Rankings, Pick. It read as three places to go and it was
// really one subject, so the tabs cost a click to find out a view was empty and hid the rest of
// the page while you were in any one of them. Most clients have at least one empty view: no
// Google Ads, no Ahrefs, no DataForSEO, nothing published yet. Three tabs where two are blank is
// worse than one page that simply does not draw the blank parts.
//
// Everything is stacked now, in the order you would read it:
//
//   Evidence   what the data already says — converting ad terms, organic positions, Search Console
//   Rankings   how the posts that are live are actually doing
//   Pick       what to write next, which is the decision the rest of the page exists to inform
//
// Sections with nothing in them render nothing at all rather than an empty card, so a client with
// only Search Console sees a short page rather than a page of apologies.
//
// Research location is gone entirely. It was a second location field whose only job was to name
// the market, which the first service area already does; nobody had ever set it. The market is
// derived and shown, not asked for.
//
// "Add your own" is a disclosure rather than a card, because it is the rarer of the two ways in.

import { useCallback, useEffect, useState } from 'react'
import KeywordResearchPanel, { type ResearchKeyword } from '@/components/admin/KeywordResearchPanel'
import KeywordChipInput, { splitPhrases } from '@/components/admin/KeywordChipInput'
import SerpInsightsSection from '@/components/admin/SerpInsightsSection'
import type { SerpInsightRow } from '@/lib/content/serpInsights'
import type { SiteOption } from '@/lib/content/types'
import { AnalyticsTab } from '@/components/admin/KeywordEvidence'
import type { GscData } from '@/components/admin/ClientContentTabPanel'

interface Payload {
  researched:        ResearchKeyword[]
  researchLocation?: string | null
  /** Candidates in the pool behind the ones shown. */
  poolTotal?:        number | null
  /** When research last ran. */
  lastResearchAt?:   string | null
  /** Whether this client has a DataForSEO connection — without one nothing can be researched. */
  hasDataForSeo?:    boolean
}

export default function KeywordsTab({ clientId, isActive, epoch, sites = [], gscData, isEcom = false, onResearchRun }: {
  clientId: string
  isActive: boolean
  /** Search Console rows, for the Evidence view. */
  gscData:  GscData
  isEcom?:  boolean
  /** The client's own sites, so their own line is marked in a list of competitors. */
  sites?:   SiteOption[]
  /** Bumped when research reruns elsewhere, so this refetches rather than showing a stale list. */
  epoch:    number
  /** After research runs here, so the Analytics tab drops its cached copy too. */
  onResearchRun?: () => void
}) {
  const [data,   setData]   = useState<Payload | null>(null)
  const [error,  setError]  = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  const [showAdd, setShowAdd] = useState(false)
  const [draft,   setDraft]   = useState('')
  // Text typed into the chip box but not yet turned into a chip. Without it the Add button stays
  // disabled until you press Enter, so typing a phrase and clicking Add does nothing.
  const [pending, setPending] = useState('')
  const [adding,  setAdding]  = useState(false)
  const [busy,    setBusy]    = useState(false)
  const [notice,  setNotice]  = useState<string | null>(null)
  // What Google actually returns for the keywords in use — the talking points the writer is
  // handed. Sits with the picking list, since it describes the keywords that were picked.
  const [insights, setInsights] = useState<SerpInsightRow[] | null>(null)

  useEffect(() => {
    if (!isActive) return
    let cancelled = false
    setError(null)
    fetch(`/api/admin/content/keyword-sources?client_id=${clientId}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => { if (!cancelled) setData({
        researched:       d.researched ?? [],
        researchLocation: d.researchLocation ?? null,
        poolTotal:        d.poolTotal ?? null,
        lastResearchAt:   d.lastResearchAt ?? null,
        hasDataForSeo:    d.hasDataForSeo !== false,
      }) })
      .catch(e => { if (!cancelled) { setError(e instanceof Error ? e.message : 'Could not load'); setData({ researched: [], hasDataForSeo: true }) } })
    fetch(`/api/admin/content/serp-insights?client_id=${clientId}`)
      .then(r => r.ok ? r.json() : { insights: [] })
      .then(d => { if (!cancelled) setInsights((d as { insights?: SerpInsightRow[] }).insights ?? []) })
      .catch(() => { if (!cancelled) setInsights([]) })
    return () => { cancelled = true }
  }, [clientId, isActive, epoch, reload])

  /** Add what is in the box to the pool, already chosen. */
  const addTyped = useCallback(async () => {
    const list = splitPhrases([draft, pending].filter(Boolean).join(', '))
    if (!list.length) return
    setAdding(true); setNotice(null)
    try {
      const res = await fetch('/api/admin/content/keyword-research', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, add: list }),
      })
      const body = await res.json().catch(() => ({})) as { error?: string; added?: number; rechosen?: number }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      const n = (body.added ?? 0) + (body.rechosen ?? 0)
      setNotice(n ? `Added ${n}` : 'Nothing new to add')
      setDraft(''); setPending('')
      setShowAdd(false)
      setReload(v => v + 1)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not add those')
    } finally {
      setAdding(false)
    }
  }, [clientId, draft, pending])

  /** Look for new ideas. Replaces the unchosen; anything in use survives. */
  const refresh = useCallback(async () => {
    setBusy(true); setNotice(null)
    try {
      const res = await fetch('/api/admin/content/keyword-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, force: true }),
      })
      const body = await res.json().catch(() => ({})) as { error?: string; reason?: string; keywords?: unknown[] }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setNotice(body.keywords?.length ? `Found ${body.keywords.length}` : body.reason ?? 'Nothing new')
      setReload(v => v + 1)
      onResearchRun?.()
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not refresh')
    } finally {
      setBusy(false)
    }
  }, [clientId, onResearchRun])

  const place = data?.researchLocation ? data.researchLocation.split(',')[0] : null

  return (
    <div>
      <style>{'@keyframes ccSpin { to { transform: rotate(360deg) } }'}</style>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          Keywords
        </h3>
        <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          What this client should be found for.
        </p>
      </div>

      {/* Evidence, then Rankings. Empty sections draw nothing — see AnalyticsTab. */}
      <AnalyticsTab
        data={gscData} isEcom={isEcom} clientId={clientId}
        isActive={isActive} epoch={epoch}
        view="all"
        hasDataForSeo={data?.hasDataForSeo !== false}
        onRefreshed={() => setReload(v => v + 1)}
      />

      {/* What Google returns for the keywords in use — the talking points the writer gets. It
          describes the picks, so it leads into the picking list rather than sitting among the
          Search Console tables. */}
      <div style={{ marginTop: 16 }}>
        <SerpInsightsSection
          rows={insights} loading={insights === null} search=""
          ownDomains={sites.map(s => s.siteUrl)}
        />
      </div>

      {/* ── Pick: the decision the rest of the page exists to inform ──────── */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', margin: '28px 0 10px' }}>
        <h4 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          Pick what to write about
        </h4>
        <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          Only the ones you tick reach the writer.
        </p>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginLeft: 'auto', fontSize: '0.8125rem', padding: '0.3rem 0.7rem', whiteSpace: 'nowrap' }}
          onClick={() => setShowAdd(v => !v)}
          disabled={adding || busy}
        >
          {showAdd ? 'Cancel' : 'Add your own'}
        </button>
      </div>

      {error && (
        <p style={{ fontSize: '0.8125rem', color: 'var(--red, #b91c1c)', marginBottom: 12 }}>
          Couldn&apos;t load the keywords ({error}).
        </p>
      )}

      {/* The result of the last add or refresh, where the button that caused it is — not at the
          bottom of a scrolled page, which is where it used to appear and why adding a keyword
          looked like it had done nothing. */}
      {notice && (
        <p role="status" className="text-xs" style={{ margin: '0 0 12px', color: /could not|error|http|nothing/i.test(notice) ? 'var(--red)' : 'var(--green, #16794a)' }}>
          {notice}
        </p>
      )}

      {/* Research still runs without DataForSEO — it reads the client's own converting Google Ads
          search terms and any Ahrefs rows, both free and already in the database. What it cannot
          do is put a number on any of it, or look beyond the client's own footprint. So this says
          what is missing from THIS list and nothing else: the first version claimed "what Google
          shows" was missing too, which was wrong twice over, because those snapshots have their
          own section above and are bought when a keyword is picked. */}
      {data && data.hasDataForSeo === false && (
        <div
          role="note"
          style={{
            marginBottom: 12, padding: '10px 12px', borderRadius: 8,
            display: 'flex', alignItems: 'flex-start', gap: 9,
            background: 'var(--amber-subtle, #fffbeb)',
            border: '1px solid var(--amber, #d97706)',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--amber, #d97706)" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0, marginTop: 1 }}>
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          {/* States a fact about the CONNECTION, not a claim about the rows below it.
              The earlier wording said "these came from converting ad terms — which is why they have
              leads but no search volume", which was wrong in both directions: it described an empty
              list on a client with no pool at all, and it denied the volumes on a client that had
              DataForSEO connected when research last ran and has since been disconnected. */}
          <p style={{ margin: 0, fontSize: '0.8125rem', lineHeight: 1.45, color: 'var(--text-primary)' }}>
            <strong style={{ fontWeight: 600 }}>DataForSEO is not connected for this client.</strong>{' '}
            <span style={{ color: 'var(--text-muted)' }}>
              Research can only draw on Ahrefs rows already synced — no keyword discovery, search
              volume, difficulty, competitor keywords or rank tracking. You can still add keywords
              by hand, and topics are still generated from Search Console.
            </span>
          </p>
        </div>
      )}

      {showAdd && (
        <div className="card p-4" style={{ marginBottom: 12 }}>
          <KeywordChipInput
            value={draft}
            onChange={setDraft}
            onPending={setPending}
            disabled={adding}
            max={30}
            placeholder="permanent Christmas lights, soffit lighting installers…"
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ fontSize: '0.8125rem', padding: '0.35rem 0.75rem' }}
              onClick={() => void addTyped()}
              disabled={adding || !splitPhrases([draft, pending].filter(Boolean).join(', ')).length}
            >
              {adding ? 'Adding…' : 'Add'}
            </button>
            <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
              {data?.hasDataForSeo === false
                ? 'Added in use, straight into the list below.'
                : 'Added in use, with search volume where Google reports it.'}
            </span>
          </div>
        </div>
      )}

      <div className="card p-5">
        {data === null ? (
          <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-faint)' }}>Loading…</p>
        ) : (
          <KeywordResearchPanel
            clientId={clientId}
            keywords={data.researched}
            geoWords={place ? [place] : []}
            place={place}
            total={data.poolTotal}
            lastResearchAt={data.lastResearchAt}
            onChanged={() => setReload(v => v + 1)}
            /* Offered with or without DataForSEO: a run against the free database sources alone
               is what a client like 5 Star Tuning gets, and it finds real keywords. */
            onRefresh={() => void refresh()}
            refreshing={busy}
            // A forced run replaces the unchosen half of the pool, so a save racing it would
            // write ticks against rows that are about to go. Adding by hand reloads the list too.
            busy={busy || adding}
          />
        )}
      </div>
    </div>
  )
}
