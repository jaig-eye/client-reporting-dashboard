'use client'

// One set of priority topics: its keywords, how far through them it is, and when the next one is due.
//
// The old card answered none of the questions someone adding a batch actually has. Its count read
// "0/0 kw" for every keyword set (it counted a legacy column), a keyword with only a topic picked
// wore the same ✓ as one with a live post, statuses were raw database words ("for_review"), and
// nothing said when anything would be written. It reads in plain words now:
//
//   - "2 of 6 written", with a bar split into written and in progress
//   - for the set that takes the next date, when that date is and when its topic gets picked —
//     honestly: a set added today usually gets its first topic when the next date comes into the
//     client's planning window, weeks before it publishes, not today
//   - each keyword's state: waiting, topic picked, written, or live with a link — and ✓ only once a
//     post exists, because a written keyword is never used again
//   - an inline box to add more keywords at any time, and × to remove one that is still waiting

import { useState, type ReactNode } from 'react'
import {
  canPickNow, fmtPublishDay, isHub, linkTasksOf, parseKeywordLines, stateOf, takesDates,
  type KeywordState, type LinkTask, type NextSlot, type PrioritySet, type SetKeyword,
} from '@/components/admin/priorityTopics'

/** Keyword rows shown before "Show all", so a long batch does not push the calendar off the page. */
const FIRST_ROWS = 8

export interface CardNotice { tone: 'success' | 'warning' | 'error' | 'neutral'; text: string }

export default function PrioritySetCard({
  set, keywords, keywordsError, isNext, aheadOf, slot, picking, notice,
  onReloadKeywords, onAddKeywords, onRemoveKeyword, onPickNow, onEdit, onArchive, onLinkDone,
}: {
  set:            PrioritySet
  /** Null while loading. Only keywords in the queue — `selected` — as the counts and the topic run use. */
  keywords:       SetKeyword[] | null
  keywordsError:  string | null
  /** This set takes the client's next open date. */
  isNext:         boolean
  /** When another set is ahead of this one: its name and how many keywords it has left. */
  aheadOf:        { name: string; left: number } | null
  slot:           NextSlot | null
  picking:        boolean
  notice:         CardNotice | null
  onReloadKeywords: () => void
  onAddKeywords:  (keywords: string[]) => Promise<boolean>
  onRemoveKeyword: (k: SetKeyword) => void
  onPickNow:      () => void
  onEdit:         () => void
  onArchive:      () => void
  /** Mark one link from the "Finish linking" checklist added, or take that back. */
  onLinkDone:     (task: LinkTask, done: boolean) => void
}) {
  const [draft, setDraft]   = useState('')
  const [adding, setAdding] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const hub = isHub(set)
  // Service and regular page sets are made on demand from the page generator and never take a
  // publish date, so none of the scheduling language applies to them.
  const pages = !takesDates(set)

  const counts = { waiting: 0, picked: 0, written: 0, live: 0 } as Record<KeywordState, number>
  for (const k of keywords ?? []) counts[stateOf(k)]++
  const total   = keywords?.length ?? set.keywordTotal
  const written = counts.written + counts.live
  const waiting = keywords ? counts.waiting : set.keywordUnused
  const usedUp  = total > 0 && waiting === 0
  const allDone = usedUp && counts.picked === 0 && keywords !== null
  const empty   = total === 0
  const firstWaiting = keywords?.find(k => stateOf(k) === 'waiting')?.id ?? null
  const linkTasks = hub ? linkTasksOf(set) : []
  const linksOpen = linkTasks.filter(t => !t.doneAt).length

  // Done sets fold their list away; everything else shows it, because a batch someone just added is
  // the thing they came here to see.
  const [listOpen, setListOpen] = useState(!usedUp)
  const shown = keywords ? (showAll ? keywords : keywords.slice(0, FIRST_ROWS)) : []
  const pickNow = !pages && !usedUp && !empty && canPickNow(slot)

  const { keywords: toAdd } = parseKeywordLines(draft)
  async function add() {
    if (!toAdd.length) return
    setAdding(true)
    const ok = await onAddKeywords(toAdd)
    setAdding(false)
    if (ok) { setDraft(''); setListOpen(true) }
  }

  const status: { label: string; tone: string } =
    pages    ? { label: 'Service pages', tone: 'badge-gray' }
    : empty  ? { label: 'No keywords yet', tone: 'badge-amber' }
    : allDone ? { label: 'All written', tone: 'badge-green' }
    : usedUp ? { label: 'All picked', tone: 'badge-gray' }
    : isNext ? { label: 'Next up', tone: 'badge-blue' }
    : { label: 'Queued', tone: 'badge-gray' }

  return (
    <article className={`pt-set${isNext ? ' pt-set--next' : ''}${usedUp ? ' pt-set--done' : ''}`} data-pt-set={set.name} aria-label={set.name}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="pt-set-head">
        <div className="pt-set-title-row">
          <h4 className="pt-set-name">{set.name}</h4>
          <span className={`badge ${status.tone}`}>{status.label}</span>
        </div>
        <div className="pt-set-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit} aria-label={`Edit “${set.name}”`}>Edit</button>
          <button type="button" className="btn btn-ghost btn-sm pt-archive" onClick={onArchive} aria-label={`Archive “${set.name}”`}>Archive</button>
        </div>
      </header>

      {/* ── Progress ───────────────────────────────────────────────────── */}
      {total > 0 && (
        <div className="pt-progress-row">
          <div
            className="pt-progress"
            role="img"
            aria-label={`${written} of ${total} written${counts.picked ? `, ${counts.picked} in progress` : ''}`}
          >
            <span className="pt-progress-done" style={{ width: `${(written / total) * 100}%` }} />
            <span className="pt-progress-picked" style={{ width: `${(counts.picked / total) * 100}%` }} />
          </div>
          <span className="pt-progress-text">
            {keywords === null
              ? `${total - waiting} of ${total} used`
              : <><strong>{written} of {total}</strong> written{counts.picked > 0 && `, ${counts.picked} in progress`}</>}
            {linksOpen > 0 && <span className="pt-links-due"> · {linksOpen} link{linksOpen === 1 ? '' : 's'} to add</span>}
          </span>
        </div>
      )}

      {/* ── When ───────────────────────────────────────────────────────── */}
      <When
        pages={pages} isNext={isNext} aheadOf={aheadOf} slot={slot}
        usedUp={usedUp} allDone={allDone} empty={empty} inProgress={counts.picked}
      />
      {pickNow && (
        <div className="pt-pick">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onPickNow} disabled={picking}
            title="Fills the open dates in the planning window from this set now, instead of waiting for the next automatic run.">
            {picking ? 'Picking…' : 'Pick topics now'}
          </button>
          {/* With automatic topics off, the sentence above already says this is the only way. */}
          {slot?.autoGenerate !== false && <span className="pt-pick-note">Saves waiting for the next automatic run.</span>}
        </div>
      )}
      {notice && <p className={`pt-notice pt-notice--${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>}

      {set.description && <p className="pt-notes"><span>Notes</span> {set.description}</p>}

      {hub && (
        <p className="pt-hub">
          Main page:{' '}
          {set.hub_page_url
            ? <a href={set.hub_page_url} target="_blank" rel="noopener noreferrer">{set.hub_page_title || set.hub_page_url}<span aria-hidden> ↗</span></a>
            : set.hub_page_title}
          . Each post links to it and to this set’s earlier live posts; the links back are yours to add, listed below as posts go live.
        </p>
      )}
      {hub && linkTasks.length > 0 && <FinishLinking tasks={linkTasks} onDone={onLinkDone} />}

      {/* ── Keywords ───────────────────────────────────────────────────── */}
      {keywordsError ? (
        <p className="pt-notice pt-notice--error" role="alert">
          Couldn’t load this set’s keywords ({keywordsError}).{' '}
          <button type="button" className="pt-linkbtn" onClick={onReloadKeywords}>Try again</button>
        </p>
      ) : keywords === null ? (
        <div className="pt-kw-skeleton" aria-hidden>
          {[0, 1, 2].map(i => <span key={i} className="skeleton" style={{ height: 12, width: `${60 - i * 12}%` }} />)}
        </div>
      ) : keywords.length > 0 && (
        <>
          {usedUp && (
            <button type="button" className="pt-disclosure" aria-expanded={listOpen} onClick={() => setListOpen(v => !v)}>
              <svg className="pt-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polyline points="9 6 15 12 9 18" />
              </svg>
              {listOpen ? 'Hide keywords' : `Show ${keywords.length} keyword${keywords.length === 1 ? '' : 's'}`}
            </button>
          )}
          {listOpen && (
            <ol className="pt-kws" aria-label={`Keywords in ${set.name}`}>
              {shown.map(k => (
                <KeywordRow key={k.id} k={k} upNext={isNext && k.id === firstWaiting} slot={slot} onRemove={() => onRemoveKeyword(k)} />
              ))}
            </ol>
          )}
          {listOpen && keywords.length > FIRST_ROWS && (
            <button type="button" className="pt-linkbtn pt-showall" onClick={() => setShowAll(v => !v)} aria-expanded={showAll}>
              {showAll ? 'Show fewer' : `Show all ${keywords.length}`}
            </button>
          )}
        </>
      )}

      {/* ── Add more ───────────────────────────────────────────────────── */}
      {keywords !== null && (
        <div className="pt-add">
          <label className="sr-only" htmlFor={`pt-add-${set.id}`}>Add keywords to {set.name}, one per line</label>
          <textarea
            id={`pt-add-${set.id}`}
            className="input pt-textarea pt-add-input"
            rows={toAdd.length > 1 ? Math.min(6, toAdd.length + 1) : 1}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void add() } }}
            placeholder={empty ? 'Keywords, one per line' : usedUp ? 'Add more, one per line' : 'Add keywords, one per line'}
            aria-label={`Add keywords to ${set.name}, one per line`}
          />
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void add()} disabled={adding || toAdd.length === 0}>
            {adding ? 'Adding…' : toAdd.length > 1 ? `Add ${toAdd.length}` : 'Add'}
          </button>
        </div>
      )}
    </article>
  )
}

/** The sentence that says when this set's next post happens — or why it isn't happening. */
function When({ pages, isNext, aheadOf, slot, usedUp, allDone, empty, inProgress }: {
  pages: boolean; isNext: boolean; aheadOf: { name: string; left: number } | null
  slot: NextSlot | null; usedUp: boolean; allDone: boolean; empty: boolean; inProgress: number
}) {
  let text: ReactNode
  let tone = ''
  if (pages) {
    text = 'Service and regular pages are made from the page generator when someone runs it. They don’t take publish dates.'
  } else if (empty) {
    text = 'Add keywords below and this set starts taking publish dates — one post per keyword.'
  } else if (usedUp) {
    text = allDone
      ? 'Every keyword here is written. Add more below to keep it going, or archive it.'
      : `Every keyword has a topic; ${inProgress === 1 ? 'one is' : `${inProgress} are`} still being written. Add more below to keep it going.`
  } else if (!isNext && aheadOf) {
    text = <>Starts once “{aheadOf.name}” runs out — it has {aheadOf.left} keyword{aheadOf.left === 1 ? '' : 's'} left.</>
  } else if (!slot) {
    text = 'There’s no open publish date to fill right now. Check the client’s schedule in Settings.'
  } else if (!slot.autoGenerate) {
    tone = ' pt-when--warn'
    text = <>Automatic topics are off for this client, so its next post — for <strong>{fmtPublishDay(slot.date)}</strong> — is only picked when someone does it here.</>
  } else if (slot.picksOn === null) {
    text = <>Next post: <strong>{fmtPublishDay(slot.date)}</strong>. Its topic is picked within the next couple of hours, then one more on each publish date after that.</>
  } else {
    text = <>Next post: <strong>{fmtPublishDay(slot.date)}</strong>. Its topic gets picked on <strong>{fmtPublishDay(slot.picksOn)}</strong>, when that date comes into the planning window — then one on each publish date after that.</>
  }
  return <p className={`pt-when${tone}`}>{text}</p>
}

const STATE_LABEL: Record<KeywordState, string> = {
  waiting: 'Waiting',
  picked:  'Topic picked',
  written: 'Written',
  live:    'Live',
}

function KeywordRow({ k, upNext, slot, onRemove }: { k: SetKeyword; upNext: boolean; slot: NextSlot | null; onRemove: () => void }) {
  const state = stateOf(k)
  let detail: ReactNode = null
  if (state === 'live' && k.post) {
    detail = <a href={k.post.published_url!} target="_blank" rel="noopener noreferrer" className="pt-kw-link">{k.post.title || 'View post'}<span aria-hidden> ↗</span></a>
  } else if (state === 'written' && k.post) {
    detail = <>{k.post.title || 'Untitled post'}{k.post.target_publish_date && <span className="pt-kw-date"> · for {fmtPublishDay(k.post.target_publish_date)}</span>}</>
  } else if (state === 'picked') {
    const s = k.topic?.status
    const day = k.topic?.target_publish_date
    detail = <>
      {k.topic?.topic ?? 'Topic picked'}
      {day && <span className="pt-kw-date"> · for {fmtPublishDay(day)}</span>}
      {s === 'pending' && <span className="pt-kw-date"> · waiting for approval</span>}
      {s === 'generating' && <span className="pt-kw-date"> · being written now</span>}
    </>
  } else if (upNext && slot) {
    detail = <span className="pt-kw-date">Up next · for {fmtPublishDay(slot.date)}</span>
  }

  return (
    <li className={`pt-kw pt-kw--${state}`}>
      <StateIcon state={state} />
      <div className="pt-kw-main">
        <span className="pt-kw-text">{k.keyword}</span>
        <span className="pt-kw-detail">
          <span className="pt-kw-state">{STATE_LABEL[state]}</span>
          {detail && <> · {detail}</>}
        </span>
      </div>
      {state === 'waiting' && (
        <button type="button" className="pt-icon-btn pt-kw-remove" onClick={onRemove} aria-label={`Remove “${k.keyword}”`} title="Remove — it hasn’t been used yet">×</button>
      )}
    </li>
  )
}

function StateIcon({ state }: { state: KeywordState }) {
  if (state === 'written' || state === 'live') {
    return (
      <svg className="pt-kw-icon pt-kw-icon--done" width="16" height="16" viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="10" fill="currentColor" />
        <polyline points="7.5 12.5 10.5 15.5 16.5 9" fill="none" stroke="var(--bg-surface)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (state === 'picked') {
    return (
      <svg className="pt-kw-icon pt-kw-icon--picked" width="16" height="16" viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M12 3 A9 9 0 0 1 12 21 Z" fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg className="pt-kw-icon pt-kw-icon--waiting" width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

// ─── Finish linking ───────────────────────────────────────────────────────────

/**
 * The links the team adds by hand once a post from a main-page set goes live: one on the main page,
 * and one in the set's previous live post. Nothing edits a live page automatically, so each task says
 * exactly which page to open, what to link to and with what words, and the team ticks it off.
 */
function FinishLinking({ tasks, onDone }: { tasks: LinkTask[]; onDone: (task: LinkTask, done: boolean) => void }) {
  const open = tasks.filter(t => !t.doneAt)
  const done = tasks.filter(t => t.doneAt)
  const [showDone, setShowDone] = useState(false)

  return (
    <section className="pt-links" aria-label="Finish linking">
      <div className="pt-links-head">
        <span className="pt-links-title">Finish linking</span>
        <span className="pt-links-count">
          {open.length > 0 ? `${open.length} to add` : 'All links added'}
        </span>
      </div>

      {open.length > 0 ? (
        <ul className="pt-links-list">
          {open.map(t => <LinkTaskRow key={`${t.kind}-${t.url}-${t.addedAt}`} task={t} onDone={onDone} />)}
        </ul>
      ) : (
        <p className="pt-links-alldone">Every link from this set’s live posts is in place.</p>
      )}

      {done.length > 0 && (
        <>
          <button type="button" className="pt-disclosure pt-links-donebtn" aria-expanded={showDone} onClick={() => setShowDone(v => !v)}>
            <svg className="pt-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="9 6 15 12 9 18" />
            </svg>
            {done.length} done
          </button>
          {showDone && (
            <ul className="pt-links-list pt-links-list--done">
              {done.map(t => (
                <li key={`${t.kind}-${t.url}-${t.addedAt}`} className="pt-link pt-link--done">
                  <span className="pt-link-what">
                    On <strong>{t.fromTitle}</strong>, linked to <strong>{t.title}</strong>
                  </span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDone(t, false)} aria-label={`Undo: the link to “${t.title}” on “${t.fromTitle}” isn’t added`}>
                    Undo
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

function LinkTaskRow({ task, onDone }: { task: LinkTask; onDone: (task: LinkTask, done: boolean) => void }) {
  return (
    <li className="pt-link">
      <p className="pt-link-what">
        On <PageLink url={task.fromUrl} title={task.fromTitle} />, add a link to <PageLink url={task.url} title={task.title} />
        {task.kind === 'previous' && <span className="pt-link-kind"> (the set’s previous post)</span>}
      </p>
      <p className="pt-link-anchor">Anchor text: <q>{task.anchor}</q></p>
      <div className="pt-link-actions">
        {task.url && <CopyButton text={task.url} label="Copy link" what={`the address of “${task.title}”`} />}
        <CopyButton text={task.anchor} label="Copy anchor" what="the anchor text" />
        <button type="button" className="btn btn-secondary btn-sm pt-link-done" onClick={() => onDone(task, true)}
          aria-label={`Done: the link to “${task.title}” is on “${task.fromTitle}”`}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Done
        </button>
      </div>
    </li>
  )
}

function PageLink({ url, title }: { url: string | null; title: string }) {
  return url
    ? <a href={url} target="_blank" rel="noopener noreferrer" className="pt-link-page"><strong>{title}</strong><span aria-hidden> ↗</span></a>
    : <strong>{title}</strong>
}

/** Copies text, and says so on the button for a moment. */
function CopyButton({ text, label, what }: { text: string; label: string; what: string }) {
  const [copied, setCopied] = useState<boolean | null>(null)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      setCopied(false)
    }
    setTimeout(() => setCopied(null), 1800)
  }
  return (
    <button type="button" className="btn btn-ghost btn-sm pt-copy" onClick={() => void copy()} aria-label={`Copy ${what}`}>
      <span aria-live="polite">{copied === true ? 'Copied' : copied === false ? 'Couldn’t copy' : label}</span>
    </button>
  )
}
