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
  | { kind: 'unresolved'; guess: string }  // the lookup answered, and knows no such place
  | { kind: 'unchecked'; guess: string }   // the lookup could not answer at all

export default function MarketLine({ geographicFocus }: { geographicFocus: string }) {
  const guess = locationCandidates(geographicFocus ?? '')[0] ?? null
  const [state, setState] = useState<State>(guess ? { kind: 'checking', guess } : { kind: 'none' })

  useEffect(() => {
    if (!guess) { setState({ kind: 'none' }); return }
    let cancelled = false
    setState({ kind: 'checking', guess })
    // Debounced: this runs while someone is still typing service areas.
    // Unreachable is not the same as unresolvable. A failed request, a non-2xx, or an answer that
    // carries an error (no DataForSEO credentials, say — the route then returns an empty list
    // WITH an error) all mean the place was never looked up. Only an answer with no error and no
    // match means the text names no place; reading the others that way told the operator that
    // searches would be nationwide when nothing had been checked.
    const t = setTimeout(() => {
      fetch(`/api/admin/content/dfs-locations?q=${encodeURIComponent(guess)}`)
        .then(async r => {
          const d = await r.json().catch(() => null) as { locations?: Array<{ name?: string }>; error?: string } | null
          if (cancelled) return
          if (!r.ok || !d || d.error) { setState({ kind: 'unchecked', guess }); return }
          const hit = d.locations?.[0]?.name
          setState(hit ? { kind: 'found', name: hit.split(',')[0] } : { kind: 'unresolved', guess })
        })
        .catch(() => { if (!cancelled) setState({ kind: 'unchecked', guess }) })
    }, 500)
    return () => { cancelled = true; clearTimeout(t) }
  }, [guess])

  const base = { fontSize: '0.6875rem', marginTop: 4, lineHeight: 1.5 } as const

  if (state.kind === 'none') {
    return <p style={{ ...base, color: 'var(--text-faint)' }}>Nationwide — no local market to measure in.</p>
  }
  if (state.kind === 'unresolved') {
    return (
      <p style={{ ...base, color: 'var(--amber)' }}>
        Couldn&apos;t find &ldquo;{state.guess}&rdquo; — searches will be nationwide. Try a city or county name first.
      </p>
    )
  }
  if (state.kind === 'unchecked') {
    return (
      <p style={{ ...base, color: 'var(--text-faint)' }}>
        Measured in <strong style={{ color: 'var(--text-muted)' }}>{state.guess}</strong>, the first
        area listed — the place couldn&apos;t be checked just now.
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
