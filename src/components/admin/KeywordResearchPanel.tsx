'use client'

// Choosing which keywords topics are chosen from.
//
// Mounted twice: in the setup wizard for a first run, and in the Keywords tab so the list can be
// revisited. Curation is ongoing work — a wizard is the wrong place to lock it away.
//
// WHAT THE LIST IS
//
// Three questions were being answered by a paragraph above the table: what are these, where did
// they come from, and which ones count. They are answered by the list itself now.
//
//   What is in use       — the ticked keywords sit in a tray above the list, as chips. With a few
//                          hundred rows the decision itself was the one thing you could not see:
//                          ticks were scattered through groups you had to scroll. Unsaved changes
//                          show on the chips too, so "what will Save do" is answered before you press it.
//   Grouped by service   — when the caller knows the client's services, the list reads service by
//                          service, in the client's own order, each with how many were found and
//                          how many are ticked. Every service matters equally to the owner, and a
//                          service with three keywords beside one with a hundred and twenty is the
//                          imbalance worth seeing. An empty service says what will fill it.
//   Grouped by source    — "Added by hand", "DataForSEO", "Ahrefs", "Google Ads": the platform that
//                          reported each keyword, which is the thing to go and check when a number
//                          looks wrong. Still one click away, with the same sources as filter chips.
//   Grouped by theme     — a real run for a Los Angeles lighting installer returned eight
//                          variations of "christmas lights" at the top by volume, burying
//                          landscape lighting and security lighting. The strongest of each theme
//                          leads, variants one click away. Nothing is discarded.
//
// COLUMNS ARE NOT FIXED
//
// A client without DataForSEO has no search volume and no difficulty for any row, and two columns
// of "–" all the way down say less than no columns at all. Each numeric column appears only when
// something in the list fills it. Leads is the column that carries those clients: some of their
// keywords came from converting ad terms.
//
// Nothing here is used until it is ticked and saved: of the researched keywords, topic selection
// reads only the chosen ones. (It also reads Search Console and rankings, which this list is not.)
// Nothing in this panel spends money; looking for new keywords is the caller's control.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { groupKeywords, type GroupedKeyword } from '@/lib/content/keywordGrouping'
import { Caret, Difficulty, Explained, HELP, HelpTip, fmtCount, fmtDay, fmtLeads } from '@/components/admin/KeywordUi'

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
  /** The client service this keyword is about, or null when it matches none. */
  service?:      string | null
}

/** Local volume when the market is known, national otherwise. The number the ranking is by. */
const strengthOf = (k: ResearchKeyword) => k.local_volume ?? k.volume ?? 0

/**
 * The origin buckets, in the order they are worth reading.
 *
 * Yours first because you put them there. Then the ones built out of what this business sells,
 * then its own footprint, then its rivals' — nearest to the business outwards. Each header says who
 * found it, and its help says how.
 */
const ORIGINS = [
  { key: 'manual',     label: 'Added by hand', hint: 'Typed in on this page, or added from the evidence. In use from the moment it was added.' },
  { key: 'dataforseo', label: 'DataForSEO',    hint: 'Keyword research: what people search around this client’s services, what their own site ranks for, and what competitors rank for.' },
  { key: 'ahrefs',     label: 'Ahrefs',        hint: 'Searches Ahrefs reports this client’s own site showing up for.' },
  { key: 'google_ads', label: 'Google Ads',    hint: 'Paid searches that brought leads. Research no longer adds these — these rows are from before that changed.' },
  { key: 'topic',      label: 'From a topic',  hint: 'Attached to a topic the generator produced.' },
  { key: 'other',      label: 'Other',         hint: 'From an earlier run, before the source was recorded.' },
] as const

/**
 * Group by the platform that reported the keyword, not by what the run was looking for.
 *
 * It used to group on metadata.found_via — "what you sell", "your site", "competitors" — which
 * described the SEARCH rather than the source: one bucket could hold rows from two systems, and
 * when a number looked wrong there was no way to tell which integration to go and check.
 */
const originOf = (k: ResearchKeyword): string => {
  const v = k.source === 'manual' ? 'manual' : k.source
  return ORIGINS.some(o => o.key === v) ? (v as string) : 'other'
}

/** A set of lower-cased keywords as one comparable string. */
const keyOf = (list: Iterable<string>) => Array.from(list).sort().join('\n')

const OTHER_SERVICE = '\u0000other'
const CHIPS_SHOWN = 18
const NO_GEO: string[] = []
const NO_SERVICES: string[] = []

type GroupBy = 'service' | 'source'

interface Section {
  key:    string
  label:  string
  hint?:  string
  count:  number
  ticked: number
  groups: GroupedKeyword<ResearchKeyword>[]
}

export default function KeywordResearchPanel({
  clientId, keywords, geoWords = NO_GEO, onChanged, onDirtyChange, place, busy,
  total, cap, lastResearchAt, services = NO_SERVICES, hideSummary = false, emptyHint,
  emptyServiceHint,
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
  /** Candidates in the pool behind the ones shown, so "60 found" is not read as the whole pool. */
  total?:     number | null
  /**
   * The most rows the caller's read returns, when it does not know the total. A list that reaches
   * it is the strongest slice of a bigger pool, and says so rather than "60 found".
   */
  cap?:       number
  /** When research last ran, so the list can say how old it is. */
  lastResearchAt?: string | null
  /** The client's services in its own order. When given, the list can be read service by service. */
  services?:  string[]
  /** The caller shows the counts, market and last run itself (the Keywords tab's summary). */
  hideSummary?: boolean
  /** What to do when there is nothing to choose from — said under "No keywords to choose from yet." */
  emptyHint?: ReactNode
  /** Said in a service group research has found nothing for yet. */
  emptyServiceHint?: string
}) {
  // What the server says is chosen, and which rows exist, each as one comparable key.
  const serverChosen = useMemo(
    () => new Set(keywords.filter(k => k.chosen).map(k => k.keyword.toLowerCase())), [keywords])
  const inList = useMemo(() => new Set(keywords.map(k => k.keyword.toLowerCase())), [keywords])
  const serverKey = keyOf(serverChosen)
  const listKey   = keyOf(inList)
  /** The keyword as written, for a lower-cased key. */
  const display = useMemo(() => new Map(keywords.map(k => [k.keyword.toLowerCase(), k.keyword])), [keywords])

  const [chosen, setChosen]   = useState<Set<string>>(() => new Set(serverChosen))
  // The server state `chosen` was last reconciled with.
  const [synced, setSynced]   = useState({ chosen: serverKey, list: listKey })
  const [expanded, setExpand] = useState<Set<string>>(new Set())
  const [folded, setFolded]   = useState<Set<string>>(new Set())
  const [saving, setSaving]   = useState(false)
  const [msg, setMsg]         = useState<{ text: string; error: boolean } | null>(null)
  const [filter, setFilter]   = useState('')
  /** Which origin the list is narrowed to, or 'all'. Source view only. */
  const [origin, setOrigin]   = useState<string>('all')
  /** Which service the list is narrowed to, or 'all'. Service view only. */
  const [svc, setSvc]         = useState<string>('all')
  const [allChips, setAllChips] = useState(false)

  const hasServices = services.length > 0
  const [groupBy, setGroupBy] = useState<GroupBy>(hasServices ? 'service' : 'source')
  // Services can arrive after the first render (a refetch); fall back when they go away.
  const view: GroupBy = hasServices ? groupBy : 'source'

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
  const q = filter.trim().toLowerCase()
  const visible = useMemo(
    () => q ? keywords.filter(k => k.keyword.toLowerCase().includes(q)) : keywords,
    [keywords, q])

  const originCounts = useMemo(() => ORIGINS
    .map(o => ({ key: o.key as string, label: o.label, n: visible.filter(k => originOf(k) === o.key).length }))
    .filter(o => o.n > 0), [visible])

  // A chip for an origin that has just been filtered away would otherwise stay selected and show
  // an empty list with no way back except clearing the text filter.
  useEffect(() => {
    if (origin !== 'all' && !originCounts.some(o => o.key === origin)) setOrigin('all')
  }, [originCounts, origin])

  const serviceKey = useMemo(() => {
    const byLower = new Map(services.map(s => [s.trim().toLowerCase(), s]))
    return (k: ResearchKeyword) => (k.service && byLower.get(k.service.trim().toLowerCase())) || OTHER_SERVICE
  }, [services])

  /**
   * Every service with how many keywords it has and how many are ticked — the chips above the list.
   *
   * These are what make an uneven pool visible at a glance: a hundred and twenty keywords for one
   * service beside three for another, without scrolling a list to find out. A service with none has
   * no chip: one line above the list names those instead (emptyServices), so a client with one
   * keyword is not a wall of zeros.
   */
  const serviceCounts = useMemo(() => [...services, OTHER_SERVICE].map(key => {
    const mine = visible.filter(k => serviceKey(k) === key)
    return {
      key, label: key === OTHER_SERVICE ? 'Other' : capitalise(key),
      n: mine.length, ticked: mine.filter(k => chosen.has(k.keyword.toLowerCase())).length,
    }
  }).filter(s => s.n > 0), [services, visible, serviceKey, chosen])

  /** Services with no keywords at all (before any text filter), named once above the list. */
  const emptyServices = useMemo(
    () => services.filter(s => !keywords.some(k => serviceKey(k) === s)).map(capitalise),
    [services, keywords, serviceKey])

  // Same rule as the origin chips: a service narrowed to, then filtered away, lets go.
  useEffect(() => {
    if (svc !== 'all' && !serviceCounts.some(s => s.key === svc)) setSvc('all')
  }, [serviceCounts, svc])

  const shown = useMemo(() => {
    if (view === 'source') return origin !== 'all' ? visible.filter(k => originOf(k) === origin) : visible
    return svc !== 'all' ? visible.filter(k => serviceKey(k) === svc) : visible
  }, [visible, origin, view, svc, serviceKey])

  // Which columns have anything in them. A client without DataForSEO has no volume and no
  // difficulty at all, and two columns of "–" across the whole table say less than no columns do.
  const anyVolume = useMemo(() => keywords.some(k => (k.local_volume ?? k.volume) != null), [keywords])
  const anyDiff   = useMemo(() => keywords.some(k => k.difficulty != null), [keywords])
  const anyLeads  = useMemo(() => keywords.some(k => k.leads != null), [keywords])

  /** Themes inside a bucket, chosen themes first — keyed off the SAVED flag, so a row does not jump away as you tick it. */
  const themed = useCallback((mine: ResearchKeyword[]) => {
    const all = groupKeywords(mine, k => k.keyword, strengthOf, geoWords)
      // A saved choice leads its theme, so what is in use is never folded away under "3 similar"
      // — a keyword added from the evidence has no search count and would otherwise sit behind a
      // stronger variant. Keyed off the saved flag too, so ticking a variant does not move it.
      .map(g => ({ ...g, members: [...g.members.filter(m => m.chosen), ...g.members.filter(m => !m.chosen)] }))
    const isChosen = (g: typeof all[number]) => g.members.some(m => m.chosen)
    return [...all.filter(isChosen), ...all.filter(g => !isChosen(g))]
  }, [geoWords])

  /** The buckets the list is drawn in, for whichever view is on. */
  const sections = useMemo<Section[]>(() => {
    const tickedIn = (list: ResearchKeyword[]) => list.filter(k => chosen.has(k.keyword.toLowerCase())).length
    if (view === 'service') {
      const buckets = [...services.map(s => ({ key: s, label: s })), { key: OTHER_SERVICE, label: 'Other keywords' }]
        .filter(b => svc === 'all' || b.key === svc)
      return buckets.map(b => {
        const mine = shown.filter(k => serviceKey(k) === b.key)
        return {
          key: b.key, label: b.label, count: mine.length, ticked: tickedIn(mine), groups: themed(mine),
          hint: b.key === OTHER_SERVICE
            ? 'Keywords that don’t belong to one service: typed in by hand, or searches the site already shows up for.'
            : undefined,
        }
      })
        // Empty services are named in one line above the list rather than as empty sections.
        .filter(s => s.count > 0)
    }
    return ORIGINS.map(o => {
      const mine = shown.filter(k => originOf(k) === o.key)
      return { key: o.key, label: o.label, hint: o.hint, count: mine.length, ticked: tickedIn(mine), groups: themed(mine) }
    }).filter(s => s.count > 0)
  }, [view, services, shown, serviceKey, themed, chosen, svc])

  // Bars are measured against the largest bucket overall, so narrowing to one service does not
  // stretch its bar to full and hide how it compares.
  const biggest = Math.max(1, ...(view === 'service' ? serviceCounts.map(s => s.n) : sections.map(s => s.count)))

  const toggle = useCallback((keyword: string) => {
    setMsg(null)
    setChosen(prev => {
      const next = new Set(prev)
      const key = keyword.toLowerCase()
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }, [])

  const toggleIn = (set: 'expand' | 'fold', key: string) => {
    const apply = (prev: Set<string>) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n }
    if (set === 'expand') setExpand(apply); else setFolded(apply)
  }

  const dirty = keyOf(chosen) !== serverKey
  const addedHere   = useMemo(() => Array.from(chosen).filter(k => !serverChosen.has(k)), [chosen, serverChosen])
  const removedHere = useMemo(() => Array.from(serverChosen).filter(k => !chosen.has(k)), [chosen, serverChosen])

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
      setMsg({ text: remove.length ? `Saved. ${remove.length} typed-in keyword${remove.length === 1 ? '' : 's'} removed.` : 'Saved.', error: false })
      onChanged?.()
    } catch (e) {
      setMsg({ text: e instanceof Error ? `Couldn’t save: ${e.message}` : 'Couldn’t save', error: true })
    } finally {
      setSaving(false)
    }
  }

  if (!keywords.length) {
    return (
      <div className="kw-empty">
        <p className="kw-empty-title">No keywords to choose from yet.</p>
        {emptyHint && <p className="kw-empty-hint">{emptyHint}</p>}
      </div>
    )
  }

  // What the count above the list says. A known total says how much is behind the rows shown; a
  // read that stops at `cap` without one says the list is the strongest slice, not the whole pool.
  const countLabel = total && total > keywords.length
    ? `showing ${keywords.length} of ${total.toLocaleString()} found`
    : cap && keywords.length >= cap
      ? `the strongest ${keywords.length} shown`
      : `${keywords.length} found`

  // The tray: everything ticked right now, saved or not. Unsaved additions are marked, and an
  // unsaved un-tick stays visible, struck through, until it is saved or taken back.
  const trayKeys = [
    ...keywords.map(k => k.keyword.toLowerCase()).filter(k => chosen.has(k) || serverChosen.has(k)),
  ]
  const trayShown = allChips ? trayKeys : trayKeys.slice(0, CHIPS_SHOWN)

  return (
    <div className="kw-pick" data-kw-pick>
      {!hideSummary && (
        <div className="kw-pick-meta">
          <span
            title={total && total > keywords.length
              ? `Research found ${total.toLocaleString()} candidates. The strongest ${keywords.length}, plus everything in use, are shown.`
              : cap && keywords.length >= cap
                ? 'Research holds more than this. The Keywords tab shows the whole list.'
                : undefined}
          >
            {countLabel}
          </span>
          {place && <span>measured in {place}</span>}
          {fmtDay(lastResearchAt) && <span>last looked {fmtDay(lastResearchAt)}</span>}
        </div>
      )}

      {/* ── In use ───────────────────────────────────────────────────────── */}
      <div className="kw-tray" aria-label="Keywords in use">
        <span className="kw-tray-label">
          In use <span className="kw-tray-count">{chosen.size}</span>
        </span>
        {trayKeys.length === 0 ? (
          <span className="kw-tray-empty">
            Nothing ticked yet. Tick keywords in the list below to steer new blog topics toward them.
          </span>
        ) : (
          <>
            {trayShown.map(k => {
              const isNew  = chosen.has(k) && !serverChosen.has(k)
              const isGone = !chosen.has(k) && serverChosen.has(k)
              const word = display.get(k) ?? k
              return (
                <span key={k} className={`kw-chip${isNew ? ' kw-chip--new' : ''}${isGone ? ' kw-chip--gone' : ''}`}>
                  <span className="kw-chip-text">{word}</span>
                  {isNew && <span className="sr-only"> (ticked, not saved)</span>}
                  {isGone && <span className="sr-only"> (unticked, not saved)</span>}
                  <button
                    type="button"
                    className="kw-chip-x"
                    onClick={() => toggle(word)}
                    aria-label={isGone ? `Tick “${word}” again` : `Untick “${word}”`}
                    title={isGone ? 'Tick again' : 'Untick'}
                  >
                    {isGone ? '↺' : '×'}
                  </button>
                </span>
              )
            })}
            {trayKeys.length > CHIPS_SHOWN && (
              <button type="button" className="kw-linkbtn" onClick={() => setAllChips(v => !v)} aria-expanded={allChips}>
                {allChips ? 'Show fewer' : `+${trayKeys.length - CHIPS_SHOWN} more`}
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Filter and view ──────────────────────────────────────────────── */}
      <div className="kw-toolbar">
        <label className="kw-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="input"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            aria-label="Filter the keyword list"
            placeholder="Filter keywords…"
          />
        </label>
        {hasServices && (
          <div className="kw-seg" role="group" aria-label="Group the list">
            {(['service', 'source'] as const).map(g => (
              <button key={g} type="button" aria-pressed={view === g} onClick={() => setGroupBy(g)}>
                {g === 'service' ? 'By service' : 'By source'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Where each keyword came from, as a filter rather than only as a section heading. Only
          origins actually present are offered, so this is never a row of dead buttons. */}
      {view === 'service' && (
        <div className="cal-filter-tabs kw-origins" role="group" aria-label="Show one service">
          {[{ key: 'all', label: 'All services', n: visible.length, ticked: 0 }, ...serviceCounts].map(s => {
            // Few keywords for a service is the imbalance worth noticing; none is worth more.
            const thin = s.key !== 'all' && s.key !== OTHER_SERVICE && s.n < 5
            return (
              <button
                key={s.key}
                type="button"
                className={`cal-filter-tab${svc === s.key ? ' active' : ''}`}
                onClick={() => setSvc(s.key)}
                aria-pressed={svc === s.key}
                title={thin ? (s.n === 0 ? 'Nothing found for this service yet' : 'Only a few keywords for this service so far') : undefined}
              >
                {s.label} <span className={`kw-chip-n${thin ? ' kw-chip-n--thin' : ''}`}>{s.n}</span>
                {s.ticked > 0 && <span className="kw-chip-ticked"> · {s.ticked} ticked</span>}
              </button>
            )
          })}
        </div>
      )}

      {view === 'source' && originCounts.length > 1 && (
        <div className="cal-filter-tabs kw-origins">
          {[{ key: 'all', label: 'All', n: visible.length }, ...originCounts].map(o => (
            <button
              key={o.key}
              type="button"
              className={`cal-filter-tab${origin === o.key ? ' active' : ''}`}
              onClick={() => setOrigin(o.key)}
              aria-pressed={origin === o.key}
            >
              {o.label} <span className="kw-chip-n">{o.n}</span>
            </button>
          ))}
        </div>
      )}

      <div className="kw-list" role="group" aria-label="Keywords to choose from" data-kw-list>
        {/* Column headers, once. */}
        <div className="kw-list-head">
          <span className="kw-col-check" />
          <span className="kw-col-kw">Keyword</span>
          {anyLeads  && <span className="kw-num kw-col-leads"><Explained name="Leads" help={HELP.leads}>Leads</Explained></span>}
          {anyVolume && <span className="kw-num kw-col-vol"><Explained name="Searches a month" help={HELP.searches}>Searches<span className="kw-hide-narrow"> a month</span></Explained></span>}
          {anyDiff   && <span className="kw-num kw-col-diff"><Explained name="Difficulty" help={HELP.difficulty}>Difficulty</Explained></span>}
        </div>

        {view === 'service' && svc === 'all' && !q && emptyServices.length > 0 && (
          <p className="kw-list-note kw-list-note--quiet">
            No keywords yet for {emptyServices.length === 1 ? emptyServices[0] : <>
              {emptyServices.length} services: {emptyServices.slice(0, 8).join(', ')}
              {emptyServices.length > 8 && <span title={emptyServices.slice(8).join(', ')}> and {emptyServices.length - 8} more</span>}
            </>}.{emptyServiceHint ? ` ${emptyServiceHint}` : ''}
          </p>
        )}

        {sections.length === 0 && q && (
          <p className="kw-list-note">Nothing matches &ldquo;{filter}&rdquo;.</p>
        )}

        {sections.map(section => {
          const closed = folded.has(section.key)
          const bodyId = `kw-grp-${clientId}-${section.key.replace(/[^a-z0-9]+/gi, '-')}`
          return (
            <div key={section.key} className="kw-group">
              <div className="kw-group-head">
                <button
                  type="button"
                  className="kw-group-toggle"
                  aria-expanded={!closed}
                  aria-controls={bodyId}
                  onClick={() => toggleIn('fold', section.key)}
                >
                  <Caret className={`kw-caret${closed ? ' kw-caret--closed' : ''}`} />
                  <span className="kw-group-name">{view === 'service' ? capitalise(section.label) : section.label}</span>
                </button>
                {section.hint && <HelpTip label={`About “${section.label}”`}>{section.hint}</HelpTip>}
                <span className="kw-group-meta">
                  {section.count > 0 && (
                    <span className="kw-bar" aria-hidden><span style={{ width: `${Math.max(4, (section.count / biggest) * 100)}%` }} /></span>
                  )}
                  <span className="kw-group-count">
                    {section.count === 0 ? 'none found' : `${section.count} found`}
                    {section.ticked > 0 && <span className="kw-group-ticked"> · {section.ticked} ticked</span>}
                  </span>
                </span>
              </div>

              {!closed && (
                <div id={bodyId}>
                  {section.groups.map(group => {
                    const [lead, ...rest] = group.members
                    const gKey = `${section.key}::${group.label}`
                    const open = expanded.has(gKey)
                    return (
                      <div key={group.label} className="kw-theme">
                        <Row k={lead} checked={chosen.has(lead.keyword.toLowerCase())} onToggle={toggle}
                          showVolume={anyVolume} showDiff={anyDiff} showLeads={anyLeads} showSource={view === 'service'} />
                        {rest.length > 0 && (
                          <>
                            <button
                              type="button"
                              className="kw-similar"
                              aria-expanded={open}
                              // Starts with the visible words, so a voice command naming them still works.
                              aria-label={open ? `Hide similar to ${lead.keyword}` : `${rest.length} similar to ${lead.keyword}`}
                              onClick={() => toggleIn('expand', gKey)}
                            >
                              <Caret className={`kw-caret${open ? '' : ' kw-caret--closed'}`} />
                              {open ? 'Hide similar' : `${rest.length} similar`}
                              {!open && rest.some(m => chosen.has(m.keyword.toLowerCase())) && (
                                <span className="kw-similar-ticked">
                                  · {rest.filter(m => chosen.has(m.keyword.toLowerCase())).length} ticked
                                </span>
                              )}
                            </button>
                            {open && rest.map(k => (
                              <Row key={k.keyword} k={k} checked={chosen.has(k.keyword.toLowerCase())} onToggle={toggle} indented
                                showVolume={anyVolume} showDiff={anyDiff} showLeads={anyLeads} showSource={view === 'service'} />
                            ))}
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="kw-savebar">
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving || busy || !dirty}>
          {saving ? 'Saving…' : 'Save selection'}
        </button>
        {msg ? (
          <span role="status" className={msg.error ? 'kw-save-msg kw-save-msg--error' : 'kw-save-msg'}>{msg.text}</span>
        ) : dirty && !saving ? (
          <>
            <span className="kw-save-msg kw-save-msg--pending">
              {[
                addedHere.length ? `${addedHere.length} ticked` : '',
                removedHere.length ? `${removedHere.length} unticked` : '',
              ].filter(Boolean).join(', ')} — not saved yet
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setChosen(new Set(serverChosen)); setMsg(null) }}>
              Undo changes
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}

/** "permanent Christmas lights" → "Permanent Christmas lights", without touching the rest. */
function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

const SOURCE_TAG: Record<string, string> = { manual: 'Added by hand', ahrefs: 'Ahrefs', google_ads: 'Google Ads' }

function Row({ k, checked, onToggle, indented, showVolume, showDiff, showLeads, showSource }: {
  k: ResearchKeyword; checked: boolean; onToggle: (kw: string) => void; indented?: boolean
  showVolume: boolean; showDiff: boolean; showLeads: boolean
  /** In the service view, say where a row came from when it is not ordinary research. */
  showSource?: boolean
}) {
  const vol = k.local_volume ?? k.volume
  const tag = showSource ? SOURCE_TAG[originOf(k)] : undefined
  return (
    <label className={`kw-row${indented ? ' kw-row--indented' : ''}`} data-checked={checked}>
      <input type="checkbox" checked={checked} onChange={() => onToggle(k.keyword)} />
      {/* Full text, wrapping — a truncated keyword cannot be judged. */}
      <span className="kw-row-kw">
        {k.keyword}
        {tag && <span className="kw-row-tag">{tag}</span>}
        {/* The same numbers as the columns, as one line under the keyword — shown instead of the
            columns when the list is phone-width. */}
        {(showLeads && k.leads != null) || (showVolume && vol != null) || (showDiff && k.difficulty != null) ? (
          <span className="kw-row-sub">
            {showLeads && k.leads != null && <span className="kw-leads-sub">{fmtLeads(k.leads)} lead{k.leads === 1 ? '' : 's'}</span>}
            {showVolume && vol != null && <span>{fmtCount(vol)} a month</span>}
            {showDiff && k.difficulty != null && <Difficulty value={k.difficulty} />}
          </span>
        ) : null}
      </span>
      {showLeads && (
        <span className={`kw-num kw-col-leads${k.leads != null ? ' kw-leads' : ' kw-muted'}`}
          title={k.leads != null ? `${fmtLeads(k.leads)} lead${k.leads === 1 ? '' : 's'} from paid search in the last 90 days` : undefined}>
          {fmtLeads(k.leads)}
        </span>
      )}
      {showVolume && (
        <span className={`kw-num kw-col-vol${vol == null ? ' kw-muted' : ''}`}>{fmtCount(vol)}</span>
      )}
      {showDiff && (
        <span className="kw-num kw-col-diff"><Difficulty value={k.difficulty} /></span>
      )}
    </label>
  )
}
