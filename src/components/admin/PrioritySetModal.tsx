'use client'

// Adding or editing a set of priority topics.
//
// This modal used to ask for nine things, five of them from an older hub-and-spoke model that
// nothing here uses any more: a target keyword, whether a hub page "already exists", a priority
// tier, and a cluster-keyword editor with its own titles, statuses and arrows. The one field that
// decides what gets written — the keyword list — sat between them with no more weight than the rest.
// It asks for three now: what the batch is about, the keywords (each one a post), and optional notes
// for the writer. The main page and cross-linking sit under Advanced, because changing either changes
// how the set behaves and most sets want neither. The legacy columns are left alone in the database.
//
// Editing covers the name, the notes and Advanced. Keywords are added and removed on the set's card,
// where you can see which ones are already written.

import { useEffect, useId, useRef, useState } from 'react'
import { MAX_KEYWORDS, MAX_NOTES, parseKeywordLines, type PrioritySet } from '@/components/admin/priorityTopics'

export interface SetDraft {
  name:                string
  keywords:            string
  notes:               string
  hubUrl:              string
  hubTitle:            string
  linkTogether:        boolean
}

export function draftFrom(set: PrioritySet | null): SetDraft {
  return {
    name:         set?.name ?? '',
    keywords:     '',
    notes:        set?.description ?? '',
    hubUrl:       set?.hub_page_url ?? '',
    hubTitle:     set?.hub_page_title ?? '',
    linkTogether: set ? set.inject_internal_links !== false : true,
  }
}

export default function PrioritySetModal({ mode, initial, platform, saving, error, onCancel, onSave }: {
  mode:     'create' | 'edit'
  initial:  SetDraft
  platform: 'wordpress' | 'bigcommerce'
  saving:   boolean
  /** What went wrong on the last save, said here rather than in a toast behind the modal. */
  error:    string | null
  onCancel: () => void
  onSave:   (draft: SetDraft) => void
}) {
  const [draft, setDraft] = useState<SetDraft>(initial)
  // Open on edit when either advanced setting is already in use, so it is not hidden from the
  // person changing the set.
  const [advanced, setAdvanced] = useState(!!(initial.hubUrl || initial.hubTitle) || !initial.linkTogether)
  const ids = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => { nameRef.current?.focus() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, saving])

  const { keywords, repeats } = parseKeywordLines(draft.keywords)
  const kept = Math.min(keywords.length, MAX_KEYWORDS)
  const hubOn = !!draft.hubUrl.trim()
  const canSave = !!draft.name.trim() && !saving
  const set = <K extends keyof SetDraft>(k: K, v: SetDraft[K]) => setDraft(d => ({ ...d, [k]: v }))

  const titleId = `${ids}-title`
  const saveLabel = saving
    ? 'Saving…'
    : mode === 'edit'
      ? 'Save changes'
      : kept > 0 ? `Add ${kept} topic${kept === 1 ? '' : 's'}` : 'Add set'

  return (
    <div className="pt-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !saving) onCancel() }}>
      <div ref={dialogRef} className="pt-modal card" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="pt-modal-head">
          <div>
            <h3 id={titleId} className="pt-modal-title">
              {mode === 'create' ? 'Add priority topics' : `Edit “${initial.name}”`}
            </h3>
            <p className="pt-modal-lede">
              {mode === 'create'
                ? 'Each keyword becomes one post. They take the next open publish dates, ahead of the usual topic picks, in the order you list them.'
                : 'Keywords are added and removed on the set itself, where you can see which are already written.'}
            </p>
          </div>
          <button type="button" className="pt-icon-btn" onClick={onCancel} aria-label="Close" disabled={saving}>×</button>
        </div>

        <form
          className="pt-modal-body"
          id={`${ids}-form`}
          onSubmit={e => { e.preventDefault(); if (canSave) onSave(draft) }}
        >
          <div className="pt-field">
            <label htmlFor={`${ids}-name`} className="pt-label">What’s this batch about?</label>
            <input
              ref={nameRef}
              id={`${ids}-name`}
              className="input"
              value={draft.name}
              maxLength={120}
              onChange={e => set('name', e.target.value)}
              placeholder="e.g. Commercial landscaping"
            />
            <p className="pt-help">A name for the team. It also shows on the topics this set produces.</p>
          </div>

          {mode === 'create' && (
            <div className="pt-field">
              <label htmlFor={`${ids}-kws`} className="pt-label">Keywords</label>
              <p className="pt-help pt-help--above" id={`${ids}-kws-help`}>One per line. Each becomes one post, written in this order.</p>
              <textarea
                id={`${ids}-kws`}
                aria-describedby={`${ids}-kws-help ${ids}-kws-count`}
                className="input pt-textarea"
                rows={6}
                value={draft.keywords}
                onChange={e => set('keywords', e.target.value)}
                placeholder={'hoa landscaping contracts\ncommercial lawn care cost\noffice park landscaping ideas'}
              />
              <p className="pt-help pt-count" id={`${ids}-kws-count`} aria-live="polite">
                {keywords.length === 0
                  ? 'None yet — you can add keywords to the set later too.'
                  : <>
                      <strong>{kept} post{kept === 1 ? '' : 's'}</strong>
                      {repeats > 0 && ` · ${repeats} repeat${repeats === 1 ? '' : 's'} left out`}
                      {keywords.length > MAX_KEYWORDS && ` · only the first ${MAX_KEYWORDS} are kept`}
                    </>}
              </p>
            </div>
          )}

          <div className="pt-field">
            <label htmlFor={`${ids}-notes`} className="pt-label">Notes for the writer <span className="pt-optional">optional</span></label>
            <p className="pt-help pt-help--above" id={`${ids}-notes-help`}>Read when each topic is picked and when each post is written.</p>
            <textarea
              id={`${ids}-notes`}
              aria-describedby={`${ids}-notes-help`}
              className="input pt-textarea"
              rows={3}
              maxLength={MAX_NOTES}
              value={draft.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="e.g. Aim at HOA boards and property managers. Mention our maintenance plans."
            />
            <p className="pt-help pt-count">{draft.notes.length.toLocaleString()} / {MAX_NOTES.toLocaleString()}</p>
          </div>

          <div className="pt-advanced">
            <button
              type="button"
              className="pt-disclosure"
              aria-expanded={advanced}
              aria-controls={`${ids}-adv`}
              onClick={() => setAdvanced(v => !v)}
            >
              <svg className="pt-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polyline points="9 6 15 12 9 18" />
              </svg>
              Advanced
              {!advanced && (hubOn || !draft.linkTogether) && (
                <span className="pt-adv-note">{[hubOn && 'main page set', !draft.linkTogether && 'linking off'].filter(Boolean).join(', ')}</span>
              )}
            </button>

            {advanced && (
              <div id={`${ids}-adv`} className="pt-adv-body">
                <div className="pt-field">
                  <span className="pt-label" id={`${ids}-hub-label`}>Main page these support <span className="pt-optional">optional</span></span>
                  <p className="pt-help pt-help--above">
                    Set this only to build around one page. The set then stops writing one post per
                    keyword: topics are planned around the page instead, every post links back to it, and
                    it keeps going until you archive it.
                  </p>
                  <div className="pt-two">
                    <input
                      className="input"
                      aria-label="Main page address"
                      value={draft.hubUrl}
                      onChange={e => set('hubUrl', e.target.value)}
                      placeholder="https://…"
                      inputMode="url"
                    />
                    <input
                      className="input"
                      aria-label="Main page title"
                      value={draft.hubTitle}
                      onChange={e => set('hubTitle', e.target.value)}
                      placeholder="e.g. Commercial Landscaping Services"
                    />
                  </div>
                </div>

                <div className="pt-field">
                  <label className="pt-check">
                    <input type="checkbox" checked={draft.linkTogether} onChange={e => set('linkTogether', e.target.checked)} />
                    <span>Link these posts to each other</span>
                  </label>
                  {draft.linkTogether && platform === 'bigcommerce' && (
                    <p className="pt-help pt-help--warn" role="note">
                      This client publishes to BigCommerce. Links only work once a post has its real
                      public address, and posts pushed before the permalink fix saved the store’s admin
                      address instead. Run the permalink backfill first, or leave this off for now.
                    </p>
                  )}
                  {!draft.linkTogether && (
                    <p className="pt-help">Each post is written on its own, with no links to the others in this set.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </form>

        <div className="pt-modal-foot">
          {error && <p className="pt-modal-error" role="alert">{error}</p>}
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
          <button type="submit" form={`${ids}-form`} className="btn btn-primary" disabled={!canSave}>{saveLabel}</button>
        </div>
      </div>
    </div>
  )
}
