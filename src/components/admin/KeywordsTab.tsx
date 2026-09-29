'use client'

// The Keywords tab: deciding what this client should be found for.
//
// The page is the list. Everything that was explaining the list — where we measure, what we search
// for, what "look again" replaces — either moved into the list itself (origin sections, the counts
// strip) or stopped being a decision the operator has to make.
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

/**
 * The three questions this tab answers, in the order you ask them.
 *
 * Pick and Evidence used to be separate tabs, which split one decision across two screens: the
 * pool was here and everything that should inform choosing from it — converting paid terms, the
 * near-miss positions, the Search Console opportunities — was over there. Rankings is the one part
 * that really was a report, so it keeps its own view rather than padding the other two.
 *
 * Picking comes last because it is the only one that depends on something being connected, and
 * because it is the conclusion: you look at what Search Console reports, then at how the posts
 * that are live are doing, and only then decide what to write next. Landing on it first meant a
 * client without DataForSEO opened this tab on an empty box.
 */
const VIEWS = [
  { key: 'evidence', label: 'Evidence', hint: 'What the data suggests' },
  { key: 'rankings', label: 'Rankings', hint: 'How the published posts are doing' },
  { key: 'pick',     label: 'Pick',     hint: 'Choose what to write about' },
] as const
type View = typeof VIEWS[number]['key']

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
  const [view,   setView]   = useState<View>('evidence')

  const [showAdd, setShowAdd] = useState(false)
  const [draft,   setDraft]   = useState('')
  // Text typed into the chip box but not yet turned into a chip. Without it the Add button stays
  // disabled until you press Enter, so typing a phrase and clicking Add does nothing.
  const [pending, setPending] = useState('')
  const [adding,  setAdding]  = useState(false)
  const [busy,    setBusy]    = useState(false)
  const [notice,  setNotice]  = useState<string | null>(null)
  // What Google actually returns for the chosen keywords. This is evidence about the keywords —
  // the same kind of thing as the Search Console tables — so it sits under Evidence rather than
  // between the picking list and the Save button, where it pushed the decision off the screen.
  const [insights, setInsights] = useState<SerpInsightRow[] | null>(null)

  useEffect(() => {
    if (!isActive || view !== 'pick') return
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
    return () => { cancelled = true }
  }, [clientId, isActive, epoch, reload, view])

  useEffect(() => {
    if (!isActive || view !== 'evidence') return
    let cancelled = false
    fetch(`/api/admin/content/serp-insights?client_id=${clientId}`)
      .then(r => r.ok ? r.json() : { insights: [] })
      .then(d => { if (!cancelled) setInsights((d as { insights?: SerpInsightRow[] }).insights ?? []) })
      .catch(() => { if (!cancelled) setInsights([]) })
    return () => { cancelled = true }
  }, [clientId, isActive, epoch, reload, view])

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
          What this client should be found for. Only the ones you pick reach the writer.
        </p>
        {view === 'pick' && (
          <button
            type="button"
            className="btn btn-secondary"
            style={{ marginLeft: 'auto', fontSize: '0.8125rem', padding: '0.3rem 0.7rem', whiteSpace: 'nowrap' }}
            onClick={() => setShowAdd(v => !v)}
            disabled={adding || busy}
          >
            {showAdd ? 'Cancel' : 'Add your own'}
          </button>
        )}
      </div>

      <div role="tablist" aria-label="Keyword views" style={{ display: 'inline-flex', gap: 2, padding: 2, marginBottom: 14, borderRadius: 10, background: 'var(--bg-subtle)', border: '1px solid var(--border)' }}>
        {VIEWS.map(v => {
          const on = view === v.key
          return (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={on}
              title={v.hint}
              onClick={() => setView(v.key)}
              style={{
                border: 'none', cursor: 'pointer', borderRadius: 8,
                padding: '5px 12px', fontSize: '0.8125rem',
                fontWeight: on ? 600 : 500,
                background: on ? 'var(--bg-surface)' : 'transparent',
                color: on ? 'var(--text-primary)' : 'var(--text-muted)',
                boxShadow: on ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
              }}
            >
              {v.label}
            </button>
          )
        })}
      </div>

      {view !== 'pick' && (
        <AnalyticsTab
          data={gscData} isEcom={isEcom} clientId={clientId}
          isActive={isActive} epoch={epoch}
          view={view === 'evidence' ? 'evidence' : 'rankings'}
        />
      )}

      {/* What Google actually returns for the chosen keywords — evidence about the keywords, so
          it sits with the rest of the evidence rather than under the picking list. */}
      {view === 'evidence' && (
        <div style={{ marginTop: 16 }}>
          <SerpInsightsSection
            rows={insights} loading={insights === null} search=""
            ownDomains={sites.map(s => s.siteUrl)}
          />
        </div>
      )}

      {view === 'pick' && (<>

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
          do is put a number on any of it, or look outside the client's own footprint. Saying
          "research needs DataForSEO" would be wrong; saying nothing leaves a list of keywords with
          every number blank and no explanation. */}
      {data && data.hasDataForSeo === false && (
        <div
          className="card"
          style={{ marginBottom: 12, padding: '10px 14px', display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', borderLeft: '3px solid var(--amber, #a3541a)' }}
        >
          <strong style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
            No DataForSEO here
          </strong>
          <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            These come from this client&apos;s own converting ad terms. Connect DataForSEO on the
            Connections tab for search volume, difficulty, what competitors rank for, and what Google shows.
          </span>
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
          />
        )}
      </div>

      </>)}
    </div>
  )
}
