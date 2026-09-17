'use client'

// The reasoning behind a post, opened properly.
//
// These briefs are written for us: keyword difficulty, SERP composition, which cluster the piece
// belongs to, which internal links it should carry. Several hundred words of it, in one
// unbroken block. Inline it was a wall; folded into a disclosure it was a wall you had to scroll.
//
// So it gets a dialog of its own, and the wall gets taken apart on the way in: the facts that have
// a shape — the search, how many people make it, how contested it is, what it points at — come out
// as a list, and the prose is split into paragraphs at its own sentence boundaries so there is
// somewhere for the eye to rest.
//
// A native <dialog>, so focus trapping, Escape and the backdrop are the platform's job rather than
// ours.

import { useRef } from 'react'
import { X, MagnifyingGlass, ArrowBendUpRight, ChartBar, Users } from '@phosphor-icons/react'

export interface BriefFacts {
  keyword:    string | null
  searches:   number | null
  difficulty: number | null
  supports:   string | null
}

/**
 * Sentences, grouped a couple at a time.
 *
 * Deliberately blunt: split after a full stop that is followed by a space and a capital. It leaves
 * the odd abbreviation attached to the next sentence, which costs nothing, and it never drops a
 * word — every character of the original ends up in exactly one paragraph.
 */
function paragraphs(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  const sentences = clean.split(/(?<=[.!?])\s+(?=[A-Z("'])/)
  const out: string[] = []
  for (let i = 0; i < sentences.length; i += 2) {
    out.push(sentences.slice(i, i + 2).join(' ').trim())
  }
  return out.filter(Boolean)
}

/** Google's difficulty score, said the way a client would say it. */
function competition(kd: number | null): string | null {
  if (kd == null) return null
  if (kd <= 20) return 'Not much competition'
  if (kd <= 40) return 'Moderate competition'
  return 'A competitive search'
}

export default function BriefModal({
  title, reason, facts,
}: {
  title:  string
  reason: string
  facts:  BriefFacts
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const blocks = paragraphs(reason)
  const comp = competition(facts.difficulty)

  return (
    <>
      <button type="button" className="cp__why" onClick={() => ref.current?.showModal()}>
        Why we wrote this
      </button>

      <dialog
        ref={ref}
        className="cp-modal"
        // The backdrop is the dialog itself; a click that lands on it rather than on the panel
        // inside means the person clicked outside, so close.
        onClick={e => { if (e.target === ref.current) ref.current?.close() }}
      >
        <div className="cp-modal__panel">
          <header className="cp-modal__head">
            <div>
              <p className="cp-modal__eyebrow">Why we wrote this</p>
              <h2 className="cp-modal__title">{title}</h2>
            </div>
            <button
              type="button" className="cp-modal__close"
              onClick={() => ref.current?.close()} aria-label="Close"
            >
              <X size={16} weight="bold" aria-hidden />
            </button>
          </header>

          {(facts.keyword || facts.searches || comp || facts.supports) && (
            <ul className="cp-modal__facts">
              {facts.keyword && (
                <li>
                  <MagnifyingGlass size={14} weight="bold" aria-hidden />
                  <span className="cp-modal__fact-label">The search</span>
                  <span className="cp-modal__fact-value">{facts.keyword}</span>
                </li>
              )}
              {facts.searches != null && facts.searches > 0 && (
                <li>
                  <Users size={14} weight="bold" aria-hidden />
                  <span className="cp-modal__fact-label">People searching</span>
                  <span className="cp-modal__fact-value">{facts.searches.toLocaleString()} a month</span>
                </li>
              )}
              {comp && (
                <li>
                  <ChartBar size={14} weight="bold" aria-hidden />
                  <span className="cp-modal__fact-label">How contested</span>
                  <span className="cp-modal__fact-value">{comp}</span>
                </li>
              )}
              {facts.supports && (
                <li>
                  <ArrowBendUpRight size={14} weight="bold" aria-hidden />
                  <span className="cp-modal__fact-label">Points readers to</span>
                  <span className="cp-modal__fact-value">{facts.supports}</span>
                </li>
              )}
            </ul>
          )}

          <div className="cp-modal__body">
            {blocks.map((b, i) => <p key={i}>{b}</p>)}
          </div>
        </div>
      </dialog>
    </>
  )
}
