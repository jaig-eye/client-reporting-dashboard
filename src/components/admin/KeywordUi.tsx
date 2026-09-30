'use client'

// Small shared pieces for the Keywords tab: one way to write each kind of number, the plain-word
// labels that stand in for SEO jargon, and the help popover every figure on the page can carry.
//
// The page used to format the same figure three ways — "3.1k", "3,100" and "3100/mo" for search
// counts, "#4", "4" and "4.0" for a position — depending on which table it sat in. It also leaned on
// words the people reading it do not use every day (KD, CTR, impressions, SERP), explained, when at
// all, in a hover title that a phone or a keyboard never shows. Everything here exists so each of
// those is said once, the same way, in plain words.

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// ─── Numbers ──────────────────────────────────────────────────────────────────

/** A count of searches, views or clicks: "940", "3,100", "12k". Empty is an en dash. */
export function fmtCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '–'
  if (Math.abs(n) >= 10_000) return `${Math.round(n / 1000).toLocaleString()}k`
  return Math.round(n).toLocaleString()
}

/**
 * Leads can be fractional (Google Ads splits credit between searches). On its own a whole number is
 * written whole; in a column (`fixed`) every row keeps one decimal, so the figures line up.
 */
export function fmtLeads(n: number | null | undefined, fixed = false): string {
  if (n == null || !Number.isFinite(n)) return '–'
  const r = Math.round(n * 10) / 10
  return fixed || !Number.isInteger(r) ? r.toFixed(1) : String(r)
}

export function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '–'
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '–'
  return `${(n * 100).toFixed(1)}%`
}

/** "Sep 3" this year, "Sep 3, 2025" otherwise. Null when there is no usable date. */
export function fmtDay(iso: string | Date | null | undefined): string | null {
  if (!iso) return null
  const d = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

// ─── Plain-word labels ────────────────────────────────────────────────────────

/** Help text for each figure, written once so every table explains it the same way. */
export const HELP = {
  searches:   'Roughly how many times a month people search this on Google.',
  difficulty: 'How hard it is to reach the first page of Google for this, from 0 to 100. Easy is under 30; hard is over 60.',
  spot:       'Where the site shows up in Google results for this search, on average. 1–10 is the first page; 11–20 is the second.',
  shown:      'How many times the site appeared in Google results for this search in the last few months.',
  clickRate:  'Of the times the site was shown, how often someone clicked it.',
  leads:      'Leads this exact search brought in through Google Ads in the last 90 days.',
} as const

type Tone = 'good' | 'mid' | 'far'

/** Page one is good, page two is the near miss, anything further is quiet. */
function spotTone(pos: number): Tone {
  return pos <= 10 ? 'good' : pos <= 20 ? 'mid' : 'far'
}

/**
 * A position in Google, as a pill whose colour says which page it is on and whose title says so in
 * words — colour is never the only signal.
 */
export function Spot({ pos, decimals = false }: { pos: number | null | undefined; decimals?: boolean }) {
  if (pos == null || !Number.isFinite(pos) || pos <= 0) return <span className="kw-muted">–</span>
  const tone = spotTone(pos)
  const page = pos <= 10 ? 'first page' : pos <= 20 ? 'second page' : 'past the second page'
  return (
    <span className={`kw-spot kw-spot--${tone}`} title={`On the ${page} of Google`}>
      {decimals ? pos.toFixed(1) : Math.round(pos)}
    </span>
  )
}

/** Difficulty as a word with its number: "Easy 12". The word is what someone new to SEO reads. */
export function Difficulty({ value, compact = false }: { value: number | null | undefined; compact?: boolean }) {
  if (value == null || !Number.isFinite(value)) return <span className="kw-muted">–</span>
  const v = Math.round(value)
  const [word, tone] = v <= 30 ? ['Easy', 'easy'] : v <= 60 ? ['Medium', 'medium'] : ['Hard', 'hard']
  return (
    <span className={`kw-diff kw-diff--${tone}`} title={`${word} to rank for (${v} out of 100)`}>
      <span className="kw-diff-dot" aria-hidden />
      {!compact && <span className="kw-diff-word">{word}</span>}
      <span className="kw-diff-num">{v}</span>
    </span>
  )
}

// ─── Help popover ─────────────────────────────────────────────────────────────

/**
 * A "?" beside a label that explains it — on hover, on keyboard focus and on tap.
 *
 * A `title` attribute was how these used to be explained, and a title never appears on a phone or
 * to someone tabbing through. The popover is drawn in a portal at a fixed position, because every
 * table here sits inside a horizontally scrolling box that would clip anything positioned inside it.
 * It closes on scroll rather than following the page, which is simpler and never leaves it stranded.
 */
export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const id = useId()

  const show = useCallback(() => {
    const r = btn.current?.getBoundingClientRect()
    if (!r) return
    const width = 260
    const left = Math.min(Math.max(8, r.left + r.width / 2 - width / 2), window.innerWidth - width - 8)
    const below = r.bottom + 6
    // Above the icon when there is no room below it.
    const top = below + 120 > window.innerHeight ? Math.max(8, r.top - 6 - 110) : below
    setPos({ top, left })
  }, [])
  const hide = useCallback(() => setPos(null), [])

  useEffect(() => {
    if (!pos) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPos(null) }
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      document.removeEventListener('keydown', onKey)
    }
  }, [pos, hide])

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="kw-help"
        aria-label={label}
        aria-describedby={pos ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        // Inside a <label> or a clickable header this must not also tick the box or toggle the section.
        onClick={e => { e.preventDefault(); e.stopPropagation(); if (pos) hide(); else show() }}
      >
        ?
      </button>
      {pos && typeof document !== 'undefined' && createPortal(
        <span role="tooltip" id={id} className="kw-tip" style={{ top: pos.top, left: pos.left }}>
          {children}
        </span>,
        document.body,
      )}
    </>
  )
}

/** A label with its help beside it, for column headers and stat labels. */
export function Explained({ children, help, name }: { children: ReactNode; help: string; name: string }) {
  return (
    <span className="kw-explained">
      {children}
      <HelpTip label={`What does “${name}” mean?`}>{help}</HelpTip>
    </span>
  )
}

// ─── Status line ──────────────────────────────────────────────────────────────

/**
 * The result of something just done here, in the tone it deserves.
 *
 * The colour used to come from a regex over the text, which painted "Nothing new to add" red and
 * would have painted a server sentence green unless it happened to contain "could not".
 */
export interface Notice { tone: 'success' | 'warning' | 'error' | 'neutral'; text: string }

export function NoticeLine({ notice }: { notice: Notice | null }) {
  if (!notice) return null
  return (
    <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`kw-notice kw-notice--${notice.tone}`}>
      {notice.text}
    </p>
  )
}

// ─── Evidence section ─────────────────────────────────────────────────────────

/**
 * One source of evidence: a header you can always read, and a body you open when you want it.
 *
 * The header carries the whole story in one line — what it is, where it came from, and a summary
 * ("3 on the second page") — so a closed section still tells you whether it is worth opening. A
 * source with nothing in it is one quiet line that says why, not an expandable empty box.
 */
export function EvidenceSection({
  id, title, source, summary, empty, open, onToggle, children, loading = false,
}: {
  id:        string
  title:     string
  source:    string
  summary?:  ReactNode
  /** Set when there is nothing to show: said in place of the summary, and the section cannot open. */
  empty?:    ReactNode
  open:      boolean
  onToggle:  () => void
  loading?:  boolean
  children?: ReactNode
}) {
  const bodyId = `kw-sec-${id}`
  if (empty && !loading) {
    return (
      <section className="card kw-sec kw-sec--empty" data-kw-section={id} aria-label={title}>
        <div className="kw-sec-head kw-sec-head--static">
          <span className="kw-sec-name">
            <span className="kw-sec-title">{title}</span>
            <span className="kw-sec-source">{source}</span>
          </span>
          <span className="kw-sec-empty">{empty}</span>
        </div>
      </section>
    )
  }
  return (
    <section className="card kw-sec" data-kw-section={id}>
      <h4 className="kw-sec-h">
        <button
          type="button"
          className="kw-sec-head"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <span className="kw-sec-name">
            <span className="kw-sec-title">{title}</span>
            <span className="kw-sec-source">{source}</span>
          </span>
          <span className="kw-sec-summary">
            {loading ? <span className="skeleton" style={{ display: 'inline-block', width: 90, height: 12 }} /> : summary}
          </span>
          <Caret />
        </button>
      </h4>
      {open && (
        <div id={bodyId} className="kw-sec-body">
          {children}
        </div>
      )}
    </section>
  )
}

export function Caret({ className = 'kw-caret' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

export function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
      strokeLinecap="round" aria-hidden>
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

export function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

export function RefreshIcon({ spinning = false }: { spinning?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden
      className={spinning ? 'kw-spin' : undefined}>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <polyline points="21 3 21 9 15 9" />
    </svg>
  )
}

// ─── Adding an evidence row to our own keywords ───────────────────────────────

export type AddState = 'adding' | 'error'

/**
 * The action at the end of an evidence row: add this search to the keywords we write about.
 *
 * Once it is in use the button gives way to a quiet "In use", so a row never offers to add what is
 * already there.
 */
export function AddTerm({ term, inUse, state, onAdd, error }: {
  term:   string
  inUse:  boolean
  state?: AddState
  error?: string
  onAdd?: (term: string) => void
}) {
  if (inUse) {
    return <span className="kw-inuse" title="Already one of the keywords we write about"><CheckIcon /> In use</span>
  }
  if (!onAdd) return null
  return (
    <button
      type="button"
      className={`btn btn-secondary btn-sm kw-add${state === 'error' ? ' kw-add--error' : ''}`}
      onClick={() => onAdd(term)}
      disabled={state === 'adding'}
      aria-label={`Add “${term}” to the keywords we write about`}
      title={state === 'error' ? (error ?? 'Couldn’t add this. Try again.') : 'Add to the keywords we write about, ticked'}
    >
      {state === 'adding' ? 'Adding…' : state === 'error' ? 'Try again' : (<><PlusIcon /><span className="kw-add-label">Add</span></>)}
    </button>
  )
}

/** Placeholder lines while a list loads, so the page does not jump when it arrives. */
export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-hidden className="kw-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="kw-skeleton-row">
          <span className="skeleton" style={{ width: 14, height: 14 }} />
          <span className="skeleton" style={{ flex: 1, maxWidth: `${55 - (i % 3) * 12}%`, height: 12 }} />
          <span className="skeleton" style={{ width: 48, height: 12, marginLeft: 'auto' }} />
        </div>
      ))}
    </div>
  )
}
