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
import ResearchLocationPicker, { readLocationValue, type ResearchLocationValue } from '@/components/admin/ResearchLocationPicker'
import ResearchSeedPreview from '@/components/admin/ResearchSeedPreview'
import { locationCandidates } from '@/lib/content/researchSeeds'
import { RESEARCH_LOCATION_HELP, RESEARCH_SEEDS_HELP } from '@/lib/content/researchCopy'

interface Payload {
  researched:       ResearchKeyword[]
  researchLocation?: string | null
}

/** The bits of the client profile this tab needs to say what it will search for, and where. */
interface Profile {
  services:         string
  geographic_focus: string
  /** Older clients only; still unioned into the seeds, no longer editable. */
  foundational:     string
}

export default function KeywordsTab({ clientId, isActive, epoch, onResearchRun }: {
  clientId: string
  isActive: boolean
  /** Bumped when research reruns elsewhere, so this refetches rather than showing a stale list. */
  epoch:    number
  /** After research runs here, so the Analytics tab drops its cached copy too. */
  onResearchRun?: () => void
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

  // Where and what we search. These moved here from Brand DNA with the rest of the research
  // controls: they describe measurement, not the business.
  const [profile,  setProfile]  = useState<Profile | null>(null)
  const [location, setLocation] = useState<ResearchLocationValue | null>(null)
  const [savingLocation, setSavingLocation] = useState(false)
  const [researchedAt, setResearchedAt] = useState<string | null>(null)

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

  // The profile and the last-run date. Both free reads.
  useEffect(() => {
    if (!isActive) return
    let cancelled = false
    fetch(`/api/admin/content/client-settings?client_id=${clientId}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: Record<string, unknown> | null) => {
        if (cancelled || !d) return
        setProfile({
          services:         String(d.services         ?? ''),
          geographic_focus: String(d.geographic_focus ?? ''),
          foundational:     Array.isArray(d.foundational_keywords) ? d.foundational_keywords.map(String).join(', ') : '',
        })
        setLocation(readLocationValue(d.research_location))
      })
      .catch(() => { /* the preview is context, not the point of the screen */ })
    fetch(`/api/admin/content/keyword-research?client_id=${clientId}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { researchedAt?: string | null } | null) => { if (!cancelled) setResearchedAt(d?.researchedAt ?? null) })
      .catch(() => { /* the date is a nicety */ })
    return () => { cancelled = true }
  }, [clientId, isActive, epoch, reload])

  /**
   * Save the research location on its own.
   *
   * Only this field is sent. The settings PUT writes just the fields present in the body, so a
   * save here cannot disturb anything someone is editing on the Brand DNA screen.
   */
  const saveLocation = useCallback(async (next: ResearchLocationValue | null) => {
    setLocation(next)
    setSavingLocation(true); setNotice(null)
    try {
      const res = await fetch('/api/admin/content/client-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, research_location: next }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setNotice(next ? `Now measuring in ${next.name}.` : 'Measuring from your first service area again.')
    } catch (e) {
      setNotice(e instanceof Error ? `Could not save the location (${e.message})` : 'Could not save the location')
    } finally {
      setSavingLocation(false)
    }
  }, [clientId])

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
      // Analytics shows the same pool; let it drop its cached copy too.
      onResearchRun?.()
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not run the research')
    } finally {
      setBusy(false)
    }
  }, [clientId, onResearchRun])

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

      {/* ── Adding to the list ──────────────────────────────────────────────
          Two ways in, side by side, because they answer different questions: "I already know the
          term" and "show me what else is out there". Both land in the same pool. */}
      <div className="card p-5" style={{ marginBottom: 16 }}>
        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
          Add your own
          <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}> — selected as soon as you add them</span>
        </label>
        {/* max matches the server's own ceiling, so the box cannot accept more than it will add. */}
        <KeywordChipInput
          value={draft}
          onChange={setDraft}
          disabled={adding}
          max={30}
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

        {/* Where we measure, and what we search for. Both used to sit in Brand DNA, which is about
            the business — these are about research, and research happens here. */}
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
              Measured in
              <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}> — primary market</span>
              <span
                title={RESEARCH_LOCATION_HELP}
                aria-label={RESEARCH_LOCATION_HELP}
                tabIndex={0}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 13, height: 13, marginLeft: 5, borderRadius: '50%', cursor: 'help',
                  border: '1px solid var(--border)', color: 'var(--text-faint)',
                  fontSize: '0.5625rem', fontWeight: 700, lineHeight: 1, verticalAlign: 'middle',
                }}
              >?</span>
            </label>
            <ResearchLocationPicker value={location} onChange={v => void saveLocation(v)} />
            {!location && (
              <p className="text-xs mt-1" style={{ color: 'var(--text-faint)', lineHeight: 1.5 }}>
                {(() => {
                  const first = locationCandidates(profile?.geographic_focus ?? '')[0]
                  return first
                    ? <>Measuring in <strong style={{ color: 'var(--text-muted)' }}>{first}</strong>, read from the first service area. Set one here to override.</>
                    : 'No local market in the service areas, so demand is measured nationwide.'
                })()}
              </p>
            )}
            {savingLocation && <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>Saving…</p>}
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
              What we search for
              <span
                title={RESEARCH_SEEDS_HELP}
                aria-label={RESEARCH_SEEDS_HELP}
                tabIndex={0}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 13, height: 13, marginLeft: 5, borderRadius: '50%', cursor: 'help',
                  border: '1px solid var(--border)', color: 'var(--text-faint)',
                  fontSize: '0.5625rem', fontWeight: 700, lineHeight: 1, verticalAlign: 'middle',
                }}
              >?</span>
            </label>
            <ResearchSeedPreview
              services={profile?.services ?? ''}
              location={location}
              geographicFocus={profile?.geographic_focus ?? ''}
              extra={profile?.foundational ?? ''}
            />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
          <p className="text-xs" style={{ color: 'var(--text-faint)', margin: 0, flex: 1, minWidth: 220, lineHeight: 1.5 }}>
            {researchedAt ? `Last looked ${new Date(researchedAt).toLocaleDateString()}. ` : ''}
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
          />
        )}
      </div>

      <p style={{ margin: '12px 0 0', fontSize: '0.75rem', color: 'var(--text-faint)', lineHeight: 1.5 }}>
        Picking more here widens what the writer can choose from; it does not schedule anything on
        its own.
      </p>
    </div>
  )
}
