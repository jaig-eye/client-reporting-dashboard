'use client'

// The Keywords tab: deciding what this client should be found for.
//
// This used to live at the bottom of Analytics, under the read-only source tables. Analytics is
// where you go to see how things are doing; choosing keywords is a decision that shapes what gets
// written. It is an input, not a report, and as a footnote on a reporting screen it read like one.
//
// The panel itself is shared with the setup wizard, so there is one implementation of choosing and
// it behaves the same wherever you meet it.

import { useCallback, useEffect, useState } from 'react'
import KeywordResearchPanel, { type ResearchKeyword } from '@/components/admin/KeywordResearchPanel'
import KeywordChipInput, { splitPhrases } from '@/components/admin/KeywordChipInput'

interface Payload {
  researched:       ResearchKeyword[]
  researchLocation?: string | null
}

export default function KeywordsTab({ clientId, isActive, epoch }: {
  clientId: string
  isActive: boolean
  /** Bumped when research reruns elsewhere, so this refetches rather than showing a stale list. */
  epoch:    number
}) {
  const [data, setData]   = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Local refetch counter, so adding or researching from here refreshes the list without waiting
  // for the parent's epoch — which only moves when research runs somewhere else.
  const [reload, setReload] = useState(0)

  const [draft,     setDraft]     = useState('')
  const [adding,    setAdding]    = useState(false)
  const [busy,      setBusy]      = useState(false)
  const [notice,    setNotice]    = useState<string | null>(null)
  const [confirmRerun, setConfirmRerun] = useState(false)

  useEffect(() => {
    if (!isActive) return
    let cancelled = false
    setError(null)
    fetch(`/api/admin/content/keyword-sources?client_id=${clientId}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => { if (!cancelled) setData({ researched: d.researched ?? [], researchLocation: d.researchLocation ?? null }) })
      .catch(e => { if (!cancelled) { setError(e instanceof Error ? e.message : 'Could not load'); setData({ researched: [] }) } })
    return () => { cancelled = true }
  }, [clientId, isActive, epoch, reload])

  /** Add what is in the box to the pool, already chosen. */
  const addTyped = useCallback(async () => {
    const list = splitPhrases(draft)
    if (!list.length) return
    setAdding(true); setNotice(null)
    try {
      const res = await fetch('/api/admin/content/keyword-research', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, add: list }),
      })
      const body = await res.json().catch(() => ({})) as {
        error?: string; added?: number; rechosen?: number; snapshot?: { captured?: number }
      }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      const parts = [
        body.added    ? `Added ${body.added}`                          : '',
        body.rechosen ? `${body.rechosen} already here, now selected`  : '',
      ].filter(Boolean)
      setNotice(parts.join(' · ') || 'Nothing new to add.')
      setDraft('')
      setReload(n => n + 1)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not add those')
    } finally {
      setAdding(false)
    }
  }, [clientId, draft])

  /** Look for new ideas without leaving the tab. */
  const runResearch = useCallback(async () => {
    setBusy(true); setNotice(null); setConfirmRerun(false)
    try {
      const res = await fetch('/api/admin/content/keyword-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, force: true }),
      })
      const body = await res.json().catch(() => ({})) as { error?: string; reason?: string; keywords?: unknown[] }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setNotice(
        body.keywords?.length
          ? `Found ${body.keywords.length} keyword ideas.`
          : body.reason ?? 'Nothing new came back.',
      )
      setReload(n => n + 1)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not run the research')
    } finally {
      setBusy(false)
    }
  }, [clientId])

  const place = data?.researchLocation ? data.researchLocation.split(',')[0] : null

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          Keywords
        </h3>
        <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-muted)', maxWidth: '68ch', lineHeight: 1.5 }}>
          Search terms this business could realistically win{place ? `, measured in ${place}` : ''}. Pick the
          ones worth pursuing — only those are shown to the writer when it chooses what to write next.
          Everything else stays here for another time.
        </p>
      </div>

      {error && (
        <p style={{ fontSize: '0.8125rem', color: 'var(--red, #b91c1c)', marginBottom: 12 }}>
          Couldn&apos;t load the keyword list ({error}). Try reloading.
        </p>
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
          />
        )}
      </div>

      {/* ── Adding to the list ──────────────────────────────────────────────
          Two ways in, side by side, because they answer different questions: "I already know the
          term" and "show me what else is out there". Both land in the same pool. */}
      <div className="card p-5" style={{ marginTop: 16 }}>
        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
          Add your own
          <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}> — selected as soon as you add them</span>
        </label>
        <KeywordChipInput
          value={draft}
          onChange={setDraft}
          disabled={adding}
          placeholder="permanent Christmas lights, landscape lighting near me…"
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
          <p className="text-xs" style={{ color: 'var(--text-faint)', margin: 0, flex: 1, minWidth: 220, lineHeight: 1.5 }}>
            For terms research would not find on its own — a new product line, or the words
            customers actually use. Search volume is filled in where we can.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            style={{ fontSize: '0.8125rem', padding: '0.375rem 0.75rem', whiteSpace: 'nowrap' }}
            onClick={() => void addTyped()}
            disabled={adding || busy || !splitPhrases(draft).length}
          >
            {adding ? 'Adding…' : 'Add to list'}
          </button>
        </div>

        <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '14px 0' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <p className="text-xs" style={{ color: 'var(--text-faint)', margin: 0, flex: 1, minWidth: 220, lineHeight: 1.5 }}>
            Looking again searches the market from this client&apos;s services and replaces the
            unselected ideas. Anything selected stays selected.
          </p>
          {confirmRerun ? (
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '0.8125rem', color: 'var(--text-primary)' }}>
              Replace the unselected ideas?
              <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8125rem', padding: '0.375rem 0.75rem' }} onClick={() => setConfirmRerun(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" style={{ fontSize: '0.8125rem', padding: '0.375rem 0.75rem' }} onClick={() => void runResearch()}>Yes, look again</button>
            </span>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '0.8125rem', padding: '0.375rem 0.75rem', whiteSpace: 'nowrap' }}
              onClick={() => setConfirmRerun(true)}
              disabled={busy || adding}
            >
              {busy ? 'Looking…' : 'Look for more'}
            </button>
          )}
        </div>

        {notice && (
          <p className="text-xs" style={{ margin: '10px 0 0', color: /could not|error|http/i.test(notice) ? 'var(--red)' : 'var(--text-muted)' }}>
            {notice}
          </p>
        )}
      </div>

      <p style={{ margin: '12px 0 0', fontSize: '0.75rem', color: 'var(--text-faint)', lineHeight: 1.5 }}>
        Picking more here widens what the writer can choose from; it does not schedule anything on
        its own.
      </p>
    </div>
  )
}
