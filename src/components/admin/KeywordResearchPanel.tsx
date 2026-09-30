'use client'

// Choosing which keywords topics are chosen from.
//
// Mounted twice: in the setup wizard for a first run, and in the Keywords tab so the list can be
// revisited. Curation is ongoing work — a wizard is the wrong place to lock it away.
//
// WHAT THE LIST IS
//
// Three questions were being answered by a paragraph above the table: what are these, where did
// they come from, and which ones count. They are answered by the table itself now.
//
//   Grouped by source    — "Added by hand", "DataForSEO", "Ahrefs", "Google Ads": the platform
//                          that reported each keyword, which is the thing to go and check when a
//                          number looks wrong. The same sources are offered as filter chips.
//   Grouped by theme     — a real run for a Los Angeles lighting installer returned eight
//                          variations of "christmas lights" at the top by volume, burying
//                          landscape lighting and security lighting. The strongest of each theme
//                          leads, variants one click away. Nothing is discarded.
//   Counted in the strip — "12 in use · 241 researched · measured in Los Angeles · last run
//                          Sep 29" instead of two sentences saying the same thing.
//
// COLUMNS ARE NOT FIXED
//
// A client without DataForSEO has no search volume and no difficulty for any row, and two columns
// of "—" all the way down say less than no columns at all. Each numeric column appears only when
// something in the list fills it. Leads is the column that carries those clients: their keywords
// came from converting ad terms, and how many leads a term produced is a better reason to write
// about it than search volume ever was.
//
// Nothing is used until it is ticked and saved: topic selection reads only chosen keywords. The
// one control here that spends money — Find new — says so before it runs.

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
  /** Leads this term produced in paid search. The only number a client without DataForSEO has. */
  leads?:        number
}

/**
 * The numeric columns, sized once and shared by the header and every row.
 *
 * The header and the rows used to declare their own widths — "Searches" had none at all — so a
 * column whose values were mostly "—" collapsed to a couple of pixels under an eight-character
 * heading, and the numbers sat nowhere near the words describing them. Fixed widths on both is the
 * only way a flex row lines up as a table.
 */
const COL_LEADS = 54, COL_SEARCHES = 74, COL_DIFFICULTY = 66
const NUM_COL: React.CSSProperties = { flexShrink: 0, textAlign: 'right', whiteSpace: 'nowrap' }

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
  { key: 'manual',     chip: 'Added by hand', label: 'Added by hand',  hint: 'Typed in on this page. In use from the moment it was added.' },
  { key: 'dataforseo', chip: 'DataForSEO',    label: 'DataForSEO',     hint: 'Keyword research: what people search around this client’s services, what their own site ranks for, and what competitors rank for.' },
  { key: 'ahrefs',     chip: 'Ahrefs',        label: 'Ahrefs',         hint: 'Organic positions Ahrefs reports for this client’s own site.' },
  { key: 'google_ads', chip: 'Google Ads',    label: 'Google Ads',     hint: 'Converting paid search terms. No longer added by research — these are rows from before that changed.' },
  { key: 'topic',      chip: 'Topics',        label: 'From a topic',   hint: 'Attached to a topic the generator produced.' },
  { key: 'other',      chip: 'Other',         label: 'Other',          hint: 'From an earlier run, before the source was recorded.' },
] as const

/**
 * Group by the platform that reported the keyword, not by what the run was looking for.
 *
 * It used to group on metadata.found_via — "what you sell", "your site", "competitors" — which
 * described the SEARCH rather than the source. Two problems with that: a single bucket could hold
 * rows from two different systems (Ahrefs and DataForSEO both report "your site"), and when a
 * number looked wrong there was no way to tell which integration to go and check. The platform is
 * the thing you act on.
 */
const originOf = (k: ResearchKeyword): string => {
  const v = k.source === 'manual' ? 'manual' : k.source
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

/** A set of lower-cased keywords as one comparable string. */
const keyOf = (list: Iterable<string>) => Array.from(list).sort().join('\n')

const NO_GEO: string[] = []

export default function KeywordResearchPanel({
  clientId, keywords, geoWords = NO_GEO, onChanged, onDirtyChange, place, busy, onRefresh, refreshing,
  total, lastResearchAt,
}: {
  clientId:   string
  keywords:   ResearchKeyword[]
  /** Parts of the client's market, so "los angeles" does not become the theme of everything. */
  geoWords?:  string[]
  /** Called after a successful save so the caller can refetch. */
  onChanged?: () => void
  /** Whether there are ticks that have not been saved, so a caller can warn before leaving. */
  onDirtyChange?: (dirty: boolean) => void
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
  // What the server says is chosen, and which rows exist, each as one comparable key.
  const serverChosen = useMemo(
    () => new Set(keywords.filter(k => k.chosen).map(k => k.keyword.toLowerCase())), [keywords])
  const inList = useMemo(() => new Set(keywords.map(k => k.keyword.toLowerCase())), [keywords])
  const serverKey = keyOf(serverChosen)
  const listKey   = keyOf(inList)

  const [chosen, setChosen]   = useState<Set<string>>(() => new Set(serverChosen))
  // The server state `chosen` was last reconciled with.
  const [synced, setSynced]   = useState({ chosen: serverKey, list: listKey })
  const [expanded, setExpand] = useState<Set<string>>(new Set())
  const [saving, setSaving]   = useState(false)
  const [msg, setMsg]         = useState<{ text: string; error: boolean } | null>(null)
  const [filter, setFilter]   = useState('')
  /** Which origin the list is narrowed to, or 'all'. */
  const [origin, setOrigin]   = useState<string>('all')
  const [confirmRefresh, setConfirmRefresh] = useState(false)

  // Server state is the starting point, and only a real change to it moves the ticks.
  //
  // This used to reset `chosen` whenever the keywords array changed identity. The wizard rebuilt
  // that array on every render and the Keywords tab refetches it on every reload, so ticks nobody
  // had saved were wiped by a keystroke elsewhere on the page. Now only what the server changed
  // since the last sync is applied — additions ticked, removals unticked — and anything ticked
  // or unticked here and not yet saved is left as it was. Keys no longer in the list are dropped
  // so the count and the save only ever describe rows that exist.
  if (serverKey !== synced.chosen || listKey !== synced.list) {
    const before = new Set(synced.chosen ? synced.chosen.split('\n') : [])
    const next = new Set(Array.from(chosen).filter(k => inList.has(k)))
    serverChosen.forEach(k => { if (!before.has(k)) next.add(k) })
    before.forEach(k => { if (!serverChosen.has(k)) next.delete(k) })
    setSynced({ chosen: serverKey, list: listKey })
    setChosen(next)
  }

  // Text filter first; the origin chips are counted against that result, so the numbers on the
  // chips always describe what clicking one would actually show.
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? keywords.filter(k => k.keyword.toLowerCase().includes(q)) : keywords
  }, [keywords, filter])

  const originCounts = useMemo(() => ORIGINS
    .map(o => ({ key: o.key as string, label: o.chip, n: visible.filter(k => originOf(k) === o.key).length }))
    .filter(o => o.n > 0), [visible])

  // A chip for an origin that has just been filtered away would otherwise stay selected and show
  // an empty list with no way back except clearing the text filter.
  useEffect(() => {
    if (origin !== 'all' && !originCounts.some(o => o.key === origin)) setOrigin('all')
  }, [originCounts, origin])

  const shown = useMemo(
    () => origin === 'all' ? visible : visible.filter(k => originOf(k) === origin),
    [visible, origin])

  // Which columns have anything in them. A client without DataForSEO has no volume and no
  // difficulty at all, and two columns of "—" across the whole table say less than no columns do.
  const anyVolume = useMemo(() => keywords.some(k => (k.local_volume ?? k.volume) != null), [keywords])
  const anyLeads  = useMemo(() => keywords.some(k => k.leads != null), [keywords])

  /** Origin sections, each with its themes inside. Empty sections are not rendered. */
  const sections = useMemo(() => {
    return ORIGINS.map(origin => {
      const mine = shown.filter(k => originOf(k) === origin.key)
      if (!mine.length) return null
      const all = groupKeywords(mine, k => k.keyword, strengthOf, geoWords)
      // Chosen themes first within the section, keyed off the saved flag so a row does not jump
      // away as you tick it.
      const isChosen = (g: typeof all[number]) => g.members.some(m => m.chosen)
      return { ...origin, groups: [...all.filter(isChosen), ...all.filter(g => !isChosen(g))], count: mine.length }
    }).filter((s): s is NonNullable<typeof s> => s !== null)
  }, [shown, geoWords])

  const toggle = useCallback((keyword: string) => {
    setMsg(null)
    setChosen(prev => {
      const next = new Set(prev)
      const key = keyword.toLowerCase()
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }, [])

  const dirty = keyOf(chosen) !== serverKey

  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  // Unmounted, there is nothing left unsaved here to warn about.
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  async function save() {
    setSaving(true); setMsg(null)
    try {
      const was  = serverChosen
      const add  = Array.from(chosen).filter(k => !was.has(k))
      const drop = Array.from(was).filter(k => !chosen.has(k))
      // A hand-typed keyword that is un-ticked leaves the list altogether.
      //
      // It is only in the pool because someone typed it, so un-ticking it is the whole of the
      // decision — there is no "keep it as a candidate" to fall back to, and leaving it sitting
      // unchosen under "Added by hand" forever reads as the save having failed. Discovered
      // candidates are different: un-ticking one means "not this time", and it stays available.
      const manual = new Set(keywords.filter(k => originOf(k) === 'manual').map(k => k.keyword.toLowerCase()))
      const remove = drop.filter(k => manual.has(k))
      // Saving is now just a write. Picking a keyword no longer buys a SERP snapshot, so there is
      // nothing slow to apologise for and nothing looked up to report.
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
      // Runs after the un-choose above, so a failure here leaves the row unchosen rather than
      // half-removed.
      if (remove.length) {
        const res = await fetch('/api/admin/content/keyword-research', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, dismiss: remove }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }
      }
      setMsg({ text: ['Saved', remove.length ? `${remove.length} removed` : ''].filter(Boolean).join(' · '), error: false })
      onChanged?.()
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Could not save', error: true })
    } finally {
      setSaving(false)
    }
  }

  // The one control here that spends, so it asks first — from the empty state as much as from the
  // strip. The empty state's button used to fire straight away, and it is also what showed when
  // the list merely failed to load.
  const refreshConfirm = onRefresh && (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <button type="button" className="btn btn-secondary" style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem', whiteSpace: 'nowrap' }} onClick={() => setConfirmRefresh(false)}>Cancel</button>
      <button type="button" className="btn btn-primary" style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem', whiteSpace: 'nowrap' }} onClick={() => { setConfirmRefresh(false); onRefresh() }}>Look now</button>
    </span>
  )

  if (!keywords.length) {
    return (
      <div style={{ padding: '28px 8px', textAlign: 'center' }}>
        <p style={{ margin: '0 0 10px', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          {confirmRefresh
            ? 'This asks DataForSEO for keyword ideas and spends credit. Go ahead?'
            : 'No keywords yet. Look for some, or add your own.'}
        </p>
        {onRefresh && (confirmRefresh ? refreshConfirm : (
          <button
            type="button" className="btn btn-secondary" style={{ fontSize: '0.8125rem' }}
            onClick={() => setConfirmRefresh(true)} disabled={refreshing || busy}
            title="Asks DataForSEO for keyword ideas. Costs money."
          >
            {refreshing ? 'Looking…' : 'Find keywords'}
          </button>
        ))}
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
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-faint)' }} title="When research last looked for new keywords. It looks again by itself once a month; Find new looks now.">
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
          {/* Named for what it does, not for the arrow it used to wear. This is the one control on
              the page that goes out to DataForSEO and spends, so it says so before it runs rather
              than hiding behind a circular arrow that looked like the reload button above it. */}
          {onRefresh && (confirmRefresh ? refreshConfirm : (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setConfirmRefresh(true)}
              disabled={refreshing || busy}
              title="Asks DataForSEO for new keyword ideas. Costs money, and anything already in use stays."
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', fontSize: '0.8125rem', padding: '0.3rem 0.65rem' }}
            >
              <RefreshIcon spinning={!!refreshing} />
              {refreshing ? 'Looking…' : 'Find new'}
            </button>
          ))}
        </span>
      </div>

      {/* Where each keyword came from, as a filter rather than only as a section heading. With a
          few hundred rows the headings scroll out of sight, and "show me only what competitors
          rank for" was a question the list could not answer. Only origins actually present are
          offered, so this is never a row of dead buttons. */}
      {originCounts.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {[{ key: 'all', label: 'All', n: visible.length }, ...originCounts].map(o => {
            const on = origin === o.key
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => setOrigin(o.key)}
                aria-pressed={on}
                style={{
                  cursor: 'pointer', borderRadius: 7, padding: '3px 9px',
                  fontSize: '0.75rem', fontWeight: on ? 600 : 500,
                  border: `1px solid ${on ? 'var(--blue)' : 'var(--border)'}`,
                  background: on ? 'var(--blue-subtle, rgba(37,99,235,0.12))' : 'var(--bg-surface)',
                  color: on ? 'var(--blue)' : 'var(--text-muted)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {o.label} <span style={{ opacity: 0.7 }}>{o.n}</span>
              </button>
            )
          })}
        </div>
      )}

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
          {anyLeads  && <span style={{ ...NUM_COL, width: COL_LEADS }} title="Leads this term produced in paid search over the last 90 days">Leads</span>}
          {anyVolume && <span style={{ ...NUM_COL, width: COL_SEARCHES }}>Searches</span>}
          {anyVolume && <span style={{ ...NUM_COL, width: COL_DIFFICULTY }}>Difficulty</span>}
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
                  <Row k={lead} checked={chosen.has(lead.keyword.toLowerCase())} onToggle={toggle} showVolume={anyVolume} showLeads={anyLeads} />
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
                        <Row key={k.keyword} k={k} checked={chosen.has(k.keyword.toLowerCase())} onToggle={toggle} indented showVolume={anyVolume} showLeads={anyLeads} />
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
        {msg && (
          <span role="status" style={{ fontSize: '0.8125rem', color: msg.error ? 'var(--red)' : 'var(--text-muted)' }}>
            {msg.text}
          </span>
        )}
        {!msg && dirty && !saving && (
          <span style={{ fontSize: '0.8125rem', color: 'var(--text-faint)' }}>Not saved yet</span>
        )}
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

function Row({ k, checked, onToggle, indented, showVolume, showLeads }: {
  k: ResearchKeyword; checked: boolean; onToggle: (kw: string) => void; indented?: boolean
  showVolume: boolean; showLeads: boolean
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
      {showLeads && (
        <span
          title={k.leads != null ? `${k.leads} lead${k.leads === 1 ? '' : 's'} from paid search in the last 90 days` : undefined}
          style={{
            ...NUM_COL, width: COL_LEADS, fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums',
            fontWeight: k.leads != null ? 600 : 400,
            color: k.leads != null ? 'var(--green, #16794a)' : 'var(--text-faint)',
          }}
        >
          {k.leads == null ? '—' : k.leads}
        </span>
      )}
      {showVolume && (
        <span style={{ ...NUM_COL, width: COL_SEARCHES, fontSize: '0.75rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {vol == null ? '—' : `${vol.toLocaleString()}/mo`}
        </span>
      )}
      {showVolume && (
        <span style={{ ...NUM_COL, width: COL_DIFFICULTY, fontSize: '0.75rem', color: difficultyTone(k.difficulty), fontVariantNumeric: 'tabular-nums' }}>
          {k.difficulty == null ? '—' : k.difficulty}
        </span>
      )}
    </label>
  )
}
