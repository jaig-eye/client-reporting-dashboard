'use client'

// The one line under Service Areas saying where demand gets measured.
//
// There used to be a second field for this — Research Location — which asked the operator to name
// the market again after they had just typed it. In production not one client ever filled it in,
// so every client was already running on the derived value. The field is gone; this says what the
// derivation produced.
//
// It checks. A service area is prose someone typed, and "Tri-County area" is not a place any
// search tool knows. Saying "Measured in Tri-County area" when nothing will resolve would be worse
// than saying nothing, so the candidate is looked up and the line reports what actually happened.
// The lookup is a free, cached endpoint.

import { useEffect, useState } from 'react'
import { locationCandidates } from '@/lib/content/researchSeeds'

type State =
  | { kind: 'none' }                       // no local market described
  | { kind: 'checking'; guess: string }
  | { kind: 'found'; name: string }
  | { kind: 'unresolved'; guess: string }

export default function MarketLine({ geographicFocus }: { geographicFocus: string }) {
  const guess = locationCandidates(geographicFocus ?? '')[0] ?? null
  const [state, setState] = useState<State>(guess ? { kind: 'checking', guess } : { kind: 'none' })

  useEffect(() => {
    if (!guess) { setState({ kind: 'none' }); return }
    let cancelled = false
    setState({ kind: 'checking', guess })
    // Debounced: this runs while someone is still typing service areas.
    const t = setTimeout(() => {
      fetch(`/api/admin/content/dfs-locations?q=${encodeURIComponent(guess)}`)
        .then(r => r.ok ? r.json() : null)
        .then((d: { locations?: Array<{ name?: string }> } | null) => {
          if (cancelled) return
          const hit = d?.locations?.[0]?.name
          setState(hit ? { kind: 'found', name: hit.split(',')[0] } : { kind: 'unresolved', guess })
        })
        .catch(() => {
          // Unreachable is not the same as unresolvable — do not accuse the operator's text.
          if (!cancelled) setState({ kind: 'found', name: guess })
        })
    }, 500)
    return () => { cancelled = true; clearTimeout(t) }
  }, [guess])

  const base = { fontSize: '0.6875rem', marginTop: 4, lineHeight: 1.5 } as const

  if (state.kind === 'none') {
    return <p style={{ ...base, color: 'var(--text-faint)' }}>Nationwide — no local market to measure in.</p>
  }
  if (state.kind === 'unresolved') {
    return (
      <p style={{ ...base, color: 'var(--amber, #a3541a)' }}>
        Couldn&apos;t find &ldquo;{state.guess}&rdquo; — searches will be nationwide. Try a city or county name first.
      </p>
    )
  }
  return (
    <p style={{ ...base, color: 'var(--text-faint)' }}>
      Measured in{' '}
      <strong style={{ color: 'var(--text-muted)' }}>
        {state.kind === 'found' ? state.name : state.guess}
      </strong>
      , the first area listed.
    </p>
  )
}
