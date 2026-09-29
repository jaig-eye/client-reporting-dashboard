'use client'

// Choosing which keywords the writer gets to see.
//
// Mounted twice: in the setup wizard for a first run, and in the Keywords tab so the list can be
// revisited. Curation is ongoing work — a wizard is the wrong place to lock it away.
//
// WHAT THE LIST IS
//
// Three questions were being answered by a paragraph above the table: what are these, where did
// they come from, and which ones count. They are answered by the table itself now.
//
//   Grouped by origin    — "Yours", "From what you sell", "You already rank for", "Competitors
//                          rank for". Four words each, and the question stops being asked.
//   Grouped by theme     — a real run for a Los Angeles lighting installer returned eight
//                          variations of "christmas lights" at the top by volume, burying
//                          landscape lighting and security lighting. The strongest of each theme
//                          leads, variants one click away. Nothing is discarded.
//   Counted in the strip — "12 in use · 60 found · Los Angeles" instead of two sentences saying
//                          the same thing.
//
// Nothing is used until it is chosen. No provider names, no costs: which vendor answered and what
// it cost are our concerns, not the operator's.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { groupKeywords } from '@/lib/content/keywordGrouping'

export interface ResearchKeyword {
  keyword:       string
  volume:        number | null
  difficulty:    number | null
  intent:        string | null
  source:        string | null
  /** 'manual' | 'site' | 'competitor' | 'idea' — how research found it. */
  foundVia?:     string | null
  score:         number | null
  local_volume:  number | null
  chosen:        boolean
}

/** Local volume when the market is known, national otherwise. The number the ranking is by. */
const strengthOf = (k: ResearchKeyword) => k.local_volume ?? k.volume ?? 0

const difficultyTone = (d: number | null) =>
  d == null ? 'var(--text-faint)' : d <= 30 ? 'var(--green, #16794a)' : d <= 60 ? 'var(--amber, #a3541a)' : 'var(--red, #b91c1c)'

/**
 * The origin buckets, in the order they are worth reading.
 *
 * Yours first because you put them there. Then the ones built out of what this business sells,
 * then its own footprint, then its rivals' — nearest to the business outwards.
 *
 * The labels answer "where did these come from" outright, because the shorter ones did not. "Yours"
 * beside "From what you sell" read as two flavours of the same thing, and the list as a whole gave
 * no sign that anything had been researched rather than invented. Each header now says who found
 * it, and the tooltip says how.
 */
const ORIGINS = [
  { key: 'manual',     label: 'You added these',             hint: 'Typed in by hand. In use from the moment they were added.' },
  { key: 'idea',       label: 'Suggested for what you sell',  hint: 'Found by research — what people search around this client’s services, plus paid terms that actually converted.' },
  { key: 'site',       label: 'You already rank for these',   hint: 'Found by research — keywords this client’s own site is already showing up under.' },
  { key: 'competitor', label: 'Competitors rank for these',   hint: 'Found by research — keywords rival sites are showing up under in this market.' },
  { key: 'other',      label: 'Other',                        hint: 'From an earlier run, before origins were recorded.' },
] as const

const originOf = (k: ResearchKeyword): string => {
  const v = k.foundVia ?? (k.source === 'manual' ? 'manual' : null)
  return ORIGINS.some(o => o.key === v) ? (v as string) : 'other'
}

/** "Sep 26" for this year, "Sep 26, 2025" for an older run. Empty when we have no timestamp. */
function runLabel(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

export default function KeywordResearchPanel({
  clientId, keywords, geoWords = [], onChanged, place, busy, onRefresh, refreshing,
  total, lastResearchAt,
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
  /** When given, a refresh control appears in the strip. */
  onRefresh?: () => void
  refreshing?: boolean
  /** Candidates in the pool behind the ones shown, so "60 found" is not read as the whole pool. */
  total?:     number | null
  /** When research last ran, so the list can say how old it is. */
  lastResearchAt?: string | null
}) {
  const [chosen, setChosen]   = useState<Set<string>>(new Set())
  const [expanded, setExpand] = useState<Set<string>>(new Set())
  const [saving, setSaving]   = useState(false)
  const [msg, setMsg]         = useState<string | null>(null)
  const [filter, setFilter]   = useState('')
  const [confirmRefresh, setConfirmRefresh] = useState(false)

  // Server state is the starting point; a save reconciles back to it.
  useEffect(() => {
    setChosen(new Set(keywords.filter(k => k.chosen).map(k => k.keyword.toLowerCase())))
  }, [keywords])

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? keywords.filter(k => k.keyword.toLowerCase().includes(q)) : keywords
  }, [keywords, filter])

  /** Origin sections, each with its themes inside. Empty sections are not rendered. */
  const sections = useMemo(() => {
    return ORIGINS.map(origin => {
      const mine = visible.filter(k => originOf(k) === origin.key)
      if (!mine.length) return null
      const all = groupKeywords(mine, k => k.keyword, strengthOf, geoWords)
      // Chosen themes first within the section, keyed off the saved flag so a row does not jump
      // away as you tick it.
      const isChosen = (g: typeof all[number]) => g.members.some(m => m.chosen)
      return { ...origin, groups: [...all.filter(isChosen), ...all.filter(g => !isChosen(g))], count: mine.length }
    }).filter((s): s is NonNullable<typeof s> => s !== null)
  }, [visible, geoWords])

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
      // Newly picked keywords have their SERP looked up as part of the save, so this can take a
      // few seconds each. Say so rather than leaving a button spinning.
      if (add.length) setMsg(`Looking up what Google shows for ${add.length}…`)
      let captured = 0
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
        const body = await res.json().catch(() => ({})) as { snapshot?: { captured?: number } }
        captured += body.snapshot?.captured ?? 0
      }
      setMsg(`Saved${captured ? ` · ${captured} looked up` : ''}`)
      onChanged?.()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  if (!keywords.length) {
    return (
      <div style={{ padding: '28px 8px', textAlign: 'center' }}>
        <p style={{ margin: '0 0 10px', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          {onRefresh ? 'No keywords yet.' : 'No keywords yet — add your own to get started.'}
        </p>
        {onRefresh && (
          <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8125rem' }} onClick={onRefresh} disabled={refreshing}>
            {refreshing ? 'Looking…' : 'Find keywords'}
          </button>
        )}
      </div>
    )
  }

  return (
    <div>
      {/* ── Strip: the counts, the market, and the two controls ─────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <strong style={{ fontSize: '0.875rem', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
          {chosen.size} in use
        </strong>
        <Dot />
        <span
          style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}
          title={total && total > keywords.length
            ? `Research found ${total.toLocaleString()} candidates. The strongest ${keywords.length}, plus everything in use, are shown.`
            : 'Found by research — see the section headers for where each one came from.'}
        >
          {total && total > keywords.length
            ? `showing ${keywords.length} of ${total.toLocaleString()} researched`
            : `${keywords.length} researched`}
        </span>
        {place && (
          <>
            <Dot />
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }} title="Search volumes are measured in this market, taken from the first service area">
              measured in {place}
            </span>
          </>
        )}
        {runLabel(lastResearchAt) && (
          <>
            <Dot />
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-faint)' }} title="When research last looked for new keywords. Refresh looks again.">
              last run {runLabel(lastResearchAt)}
            </span>
          </>
        )}

        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <input
            className="input"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter…"
            style={{ maxWidth: 170, fontSize: '0.8125rem', padding: '0.3rem 0.55rem' }}
          />
          {onRefresh && (confirmRefresh ? (
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '0.8125rem' }}>
              <button type="button" className="btn btn-secondary" style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }} onClick={() => setConfirmRefresh(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }} onClick={() => { setConfirmRefresh(false); onRefresh() }}>Refresh</button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRefresh(true)}
              disabled={refreshing || busy}
              title="Refresh keywords — looks for new ideas. Anything in use stays."
              aria-label="Refresh keywords"
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 30, height: 30, borderRadius: 8, cursor: refreshing ? 'default' : 'pointer',
                border: '1px solid var(--border)', background: 'var(--bg-surface)',
                color: 'var(--text-muted)',
              }}
            >
              <RefreshIcon spinning={!!refreshing} />
            </button>
          ))}
        </span>
      </div>

      <div style={{ border: '1px solid var(--border)', borderRadius: 10, maxHeight: 480, overflowY: 'auto' }}>
        {/* Column headers, once. */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px',
          position: 'sticky', top: 0, zIndex: 1,
          background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)',
          fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.05em',
          textTransform: 'uppercase', color: 'var(--text-faint)',
        }}>
          <span style={{ width: 13, flexShrink: 0 }} />
          <span style={{ flex: 1 }}>Keyword</span>
          <span style={{ whiteSpace: 'nowrap' }}>Searches</span>
          <span style={{ minWidth: 58, textAlign: 'right' }}>Difficulty</span>
        </div>

        {sections.length === 0 && (
          <p style={{ margin: 0, padding: '18px 10px', fontSize: '0.8125rem', color: 'var(--text-faint)' }}>
            Nothing matches &ldquo;{filter}&rdquo;.
          </p>
        )}

        {sections.map(section => (
          <div key={section.key}>
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: 8,
              padding: '8px 10px 4px', background: 'var(--bg-subtle)',
              borderBottom: '1px solid var(--border)', borderTop: '1px solid var(--border)',
            }}>
              <span
                title={section.hint}
                style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)', cursor: 'help' }}
              >
                {section.label}
              </span>
              <span style={{ fontSize: '0.68rem', color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>
                {section.count}
              </span>
            </div>
            {section.groups.map(group => {
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
        ))}
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

function Dot() {
  return <span aria-hidden style={{ color: 'var(--text-faint)', fontSize: '0.7rem' }}>·</span>
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden
      style={spinning ? { animation: 'ccSpin 0.9s linear infinite' } : undefined}>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <polyline points="21 3 21 9 15 9" />
    </svg>
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
        {k.difficulty == null ? '—' : k.difficulty}
      </span>
    </label>
  )
}
