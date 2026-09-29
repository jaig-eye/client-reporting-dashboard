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

interface Payload {
  researched:        ResearchKeyword[]
  researchLocation?: string | null
}

export default function KeywordsTab({ clientId, isActive, epoch, sites = [], onResearchRun }: {
  clientId: string
  isActive: boolean
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
  // What Google returns for these keywords. It lived under the Analytics tables, which is where
  // you go to see how things are doing — this is about the keywords themselves.
  const [insights, setInsights] = useState<SerpInsightRow[] | null>(null)

  useEffect(() => {
    if (!isActive) return
    let cancelled = false
    setError(null)
    fetch(`/api/admin/content/keyword-sources?client_id=${clientId}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => { if (!cancelled) setData({ researched: d.researched ?? [], researchLocation: d.researchLocation ?? null }) })
      .catch(e => { if (!cancelled) { setError(e instanceof Error ? e.message : 'Could not load'); setData({ researched: [] }) } })
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
          What this client should be found for. Only the ones you pick reach the writer.
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
              Added in use, with search volume where Google reports it.
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
            onChanged={() => setReload(v => v + 1)}
            onRefresh={() => void refresh()}
            refreshing={busy}
          />
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <SerpInsightsSection
          rows={insights} loading={insights === null} search=""
          ownDomains={sites.map(s => s.siteUrl)}
        />
      </div>

      {notice && (
        <p className="text-xs" style={{ margin: '10px 0 0', color: /could not|error|http/i.test(notice) ? 'var(--red)' : 'var(--text-muted)' }}>
          {notice}
        </p>
      )}
    </div>
  )
}
