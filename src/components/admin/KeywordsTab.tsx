'use client'

// The Keywords tab: deciding what this client should be found for.
//
// This used to live at the bottom of Analytics, under the read-only source tables. Analytics is
// where you go to see how things are doing; choosing keywords is a decision that shapes what gets
// written. It is an input, not a report, and as a footnote on a reporting screen it read like one.
//
// The panel itself is shared with the setup wizard, so there is one implementation of choosing and
// it behaves the same wherever you meet it.

import { useEffect, useState } from 'react'
import KeywordResearchPanel, { type ResearchKeyword } from '@/components/admin/KeywordResearchPanel'

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

  useEffect(() => {
    if (!isActive) return
    let cancelled = false
    setError(null)
    fetch(`/api/admin/content/keyword-sources?client_id=${clientId}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => { if (!cancelled) setData({ researched: d.researched ?? [], researchLocation: d.researchLocation ?? null }) })
      .catch(e => { if (!cancelled) { setError(e instanceof Error ? e.message : 'Could not load'); setData({ researched: [] }) } })
    return () => { cancelled = true }
  }, [clientId, isActive, epoch])

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

      <p style={{ margin: '12px 0 0', fontSize: '0.75rem', color: 'var(--text-faint)', lineHeight: 1.5 }}>
        New ideas come from the research, which runs from Settings → Brand DNA. Picking more here
        widens what the writer can choose from; it does not schedule anything on its own.
      </p>
    </div>
  )
}
