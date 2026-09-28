'use client'

// Choosing which researched keywords the writer gets to see.
//
// Mounted twice: once in the setup wizard for a first run, and once in a client's Analytics tab so
// the list can be revisited without walking back through setup. Curation is ongoing work — a
// wizard is the wrong place to lock it away.
//
// WHAT CHANGED AND WHY
//
// A run returns a few hundred candidates. Everything used to feed the writer and the only control
// was dismissing the bad ones, which at 240 a run is a list nobody polices. So nothing is used
// until it is chosen.
//
// And the list is grouped. A real run for a Los Angeles lighting installer returned eight
// variations of "christmas lights" at the top by volume, pushing landscape lighting, permanent
// outdoor lighting and security lighting below the fold. Grouping shows the strongest of each
// theme first, with the variants one click away — breadth first, depth on request. Nothing is
// discarded.
//
// No provider names and no costs appear here. Which vendor answered and what it cost are our
// concerns, not the operator's.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { groupKeywords } from '@/lib/content/keywordGrouping'

export interface ResearchKeyword {
  keyword:       string
  volume:        number | null
  difficulty:    number | null
  intent:        string | null
  source:        string | null
  score:         number | null
  local_volume:  number | null
  chosen:        boolean
}

/** Local volume when the market is known, national otherwise. The number the ranking is by. */
const strengthOf = (k: ResearchKeyword) => k.local_volume ?? k.volume ?? 0

const difficultyTone = (d: number | null) =>
  d == null ? 'var(--text-faint)' : d <= 30 ? 'var(--green, #16794a)' : d <= 60 ? 'var(--amber, #a3541a)' : 'var(--red, #b91c1c)'

export default function KeywordResearchPanel({
  clientId, keywords, geoWords = [], onChanged, place, busy,
}: {
  clientId:   string
  keywords:   ResearchKeyword[]
  /** Parts of the client's market, so "los angeles" does not become the theme of everything. */
  geoWords?:  string[]
  /** Called after a successful save so the caller can refetch. */
  onChanged?: () => void
  /** The market these numbers describe, when one is set. */
  place?:     string | null
  busy?:      boolean
}) {
  const [chosen, setChosen]   = useState<Set<string>>(new Set())
  const [expanded, setExpand] = useState<Set<string>>(new Set())
  const [saving, setSaving]   = useState(false)
  const [msg, setMsg]         = useState<string | null>(null)
  const [filter, setFilter]   = useState('')

  // Server state is the starting point; a save reconciles back to it.
  useEffect(() => {
    setChosen(new Set(keywords.filter(k => k.chosen).map(k => k.keyword.toLowerCase())))
  }, [keywords])

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? keywords.filter(k => k.keyword.toLowerCase().includes(q)) : keywords
  }, [keywords, filter])

  const groups = useMemo(
    () => groupKeywords(visible, k => k.keyword, strengthOf, geoWords),
    [visible, geoWords],
  )

  const toggle = useCallback((keyword: string) => {
    setChosen(prev => {
      const next = new Set(prev)
      const key = keyword.toLowerCase()
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }, [])

  const dirty = useMemo(() => {
    const was = new Set(keywords.filter(k => k.chosen).map(k => k.keyword.toLowerCase()))
    if (was.size !== chosen.size) return true
    for (const k of Array.from(chosen)) if (!was.has(k)) return true
    return false
  }, [keywords, chosen])

  async function save() {
    setSaving(true); setMsg(null)
    try {
      const was  = new Set(keywords.filter(k => k.chosen).map(k => k.keyword.toLowerCase()))
      const add  = Array.from(chosen).filter(k => !was.has(k))
      const drop = Array.from(was).filter(k => !chosen.has(k))
      for (const [list, isChosen] of [[add, true], [drop, false]] as const) {
        if (!list.length) continue
        const res = await fetch('/api/admin/content/keyword-research', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, keywords: list, chosen: isChosen }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }
      }
      setMsg(`Saved — ${chosen.size} keyword${chosen.size === 1 ? '' : 's'} in use.`)
      onChanged?.()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  if (!keywords.length) {
    return (
      <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', margin: 0 }}>
        No keyword ideas yet. Run the research to find some.
      </p>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <strong style={{ fontSize: '0.875rem', color: 'var(--text-primary)' }}>
          {chosen.size} of {keywords.length} in use
        </strong>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Only the ones you pick are shown to the writer — the rest stay here for next time.
          {place ? ` Demand measured in ${place}.` : ''}
        </span>
        <input
          className="input"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter…"
          style={{ marginLeft: 'auto', maxWidth: 200, fontSize: '0.8125rem', padding: '0.3rem 0.55rem' }}
        />
      </div>

      <div style={{ border: '1px solid var(--border)', borderRadius: 10, maxHeight: 440, overflowY: 'auto' }}>
        {groups.map(group => {
          const [lead, ...rest] = group.members
          const open = expanded.has(group.label)
          return (
            <div key={group.label} style={{ borderBottom: '1px solid var(--border-subtle, var(--border))' }}>
              <Row k={lead} checked={chosen.has(lead.keyword.toLowerCase())} onToggle={toggle} />
              {rest.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setExpand(prev => {
                      const n = new Set(prev); if (n.has(group.label)) n.delete(group.label); else n.add(group.label); return n
                    })}
                    style={{
                      border: 'none', background: 'transparent', cursor: 'pointer',
                      fontSize: '0.72rem', color: 'var(--text-faint)', padding: '2px 0 6px 36px',
                    }}
                  >
                    {open ? '▾ hide' : `▸ ${rest.length} similar`}
                  </button>
                  {open && rest.map(k => (
                    <Row key={k.keyword} k={k} checked={chosen.has(k.keyword.toLowerCase())} onToggle={toggle} indented />
                  ))}
                </>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
        <button className="btn btn-primary" onClick={save} disabled={saving || busy || !dirty}>
          {saving ? 'Saving…' : 'Save selection'}
        </button>
        {msg && <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{msg}</span>}
      </div>
    </div>
  )
}

function Row({ k, checked, onToggle, indented }: {
  k: ResearchKeyword; checked: boolean; onToggle: (kw: string) => void; indented?: boolean
}) {
  const vol = k.local_volume ?? k.volume
  return (
    <label
      style={{
        display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
        padding: `6px 10px 6px ${indented ? 36 : 10}px`,
      }}
    >
      <input type="checkbox" checked={checked} onChange={() => onToggle(k.keyword)} style={{ flexShrink: 0 }} />
      {/* Full text, wrapping — a truncated keyword cannot be judged. */}
      <span style={{ flex: 1, fontSize: '0.8125rem', color: 'var(--text-primary)', lineHeight: 1.35 }}>
        {k.keyword}
      </span>
      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {vol == null ? '—' : `${vol.toLocaleString()}/mo`}
      </span>
      <span style={{ fontSize: '0.75rem', color: difficultyTone(k.difficulty), fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', minWidth: 58, textAlign: 'right' }}>
        {k.difficulty == null ? '' : `KD ${k.difficulty}`}
      </span>
    </label>
  )
}
