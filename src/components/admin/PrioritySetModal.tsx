'use client'

// Adding or editing a set of priority topics.
//
// This modal used to ask for nine things, five of them from an older hub-and-spoke model that
// nothing here uses any more: a target keyword, whether a hub page "already exists", a priority
// tier, and a cluster-keyword editor with its own titles, statuses and arrows. The one field that
// decides what gets written — the keyword list — sat between them with no more weight than the rest.
// It asks for three now: what the batch is about, the keywords (each one a post), and optional notes
// for the writer. The main page sits under Advanced, because setting one changes how the set behaves
// and most sets want none. The legacy columns are left alone in the database.
//
// "Link these posts to each other" is gone too. For a set without a main page it changed one
// sentence of the topic prompt, topics carry no links, and the writer never saw it: each post is
// written on its own with the client's usual internal links. Offering it as a choice promised
// behaviour that does not exist, so the modal says what does happen instead, and the column keeps
// its default.
//
// Editing covers the name, the notes and Advanced. Keywords are added and removed on the set's card,
// where you can see which ones are already written. Built on the shared Dialog (a form: Enter saves).

import { useId, useState } from 'react'
import Dialog from '@/components/ui/Dialog'
import { MAX_KEYWORDS, MAX_NOTES, parseKeywordLines, type PrioritySet } from '@/components/admin/priorityTopics'

export interface SetDraft {
  name:     string
  keywords: string
  notes:    string
  hubUrl:   string
  hubTitle: string
}

export function draftFrom(set: PrioritySet | null): SetDraft {
  return {
    name:     set?.name ?? '',
    keywords: '',
    notes:    set?.description ?? '',
    hubUrl:   set?.hub_page_url ?? '',
    hubTitle: set?.hub_page_title ?? '',
  }
}

export default function PrioritySetModal({ mode, initial, saving, error, onCancel, onSave }: {
  mode:     'create' | 'edit'
  initial:  SetDraft
  saving:   boolean
  /** What went wrong on the last save, said here rather than in a toast behind the modal. */
  error:    string | null
  onCancel: () => void
  onSave:   (draft: SetDraft) => void
}) {
  const [draft, setDraft] = useState<SetDraft>(initial)
  // Open on edit when a main page is already set, so it is not hidden from the person changing it.
  const [advanced, setAdvanced] = useState(!!(initial.hubUrl || initial.hubTitle))
  const ids = useId()

  const { keywords, repeats } = parseKeywordLines(draft.keywords)
  const kept = Math.min(keywords.length, MAX_KEYWORDS)
  const hubOn = !!draft.hubUrl.trim()
  const canSave = !!draft.name.trim() && !saving
  const set = <K extends keyof SetDraft>(k: K, v: SetDraft[K]) => setDraft(d => ({ ...d, [k]: v }))

  const saveLabel = saving
    ? 'Saving…'
    : mode === 'edit'
      ? 'Save changes'
      : kept > 0 ? `Add ${kept} topic${kept === 1 ? '' : 's'}` : 'Add set'

  return (
    <Dialog
      open
      onClose={onCancel}
      title={mode === 'create' ? 'Add priority topics' : `Edit “${initial.name}”`}
      description={mode === 'create'
        ? 'Each keyword becomes one post. They go next in the queue: the next open publish dates, ahead of the usual topic picks, in the order you list them.'
        : 'Keywords are added and removed on the set itself, where you can see which are already written.'}
      busy={saving}
      onSubmit={() => { if (canSave) onSave(draft) }}
      bodyClassName="pt-modal-body"
      footer={<>
        {error && <p className="ui-dialog-error" role="alert">{error}</p>}
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={!canSave}>{saveLabel}</button>
      </>}
    >
          <div className="pt-field">
            <label htmlFor={`${ids}-name`} className="pt-label">What’s this batch about?</label>
            <input
              id={`${ids}-name`}
              className="input"
              value={draft.name}
              maxLength={120}
              onChange={e => set('name', e.target.value)}
              placeholder="e.g. Commercial landscaping"
            />
            <p className="pt-help">A name for the team. It also shows on the topics and posts this set produces.</p>
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
              {!advanced && hubOn && <span className="pt-adv-note">main page set</span>}
            </button>
            {!advanced && (
              <p className="pt-help">
                Each keyword becomes its own post. Posts aren’t linked to each other unless you set a
                main page under Advanced.
              </p>
            )}

            {advanced && (
              <div id={`${ids}-adv`} className="pt-adv-body">
                <div className="pt-field">
                  <span className="pt-label">Main page these support <span className="pt-optional">optional</span></span>
                  <p className="pt-help pt-help--above">
                    Set this to build the batch around one page. Each keyword is still one post, and
                    each post links to that page and to the set’s earlier live posts. As posts go live,
                    the set lists the links for you to add back by hand — on this page and on the
                    previous post. Without one, the posts aren’t linked to each other.
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
              </div>
            )}
          </div>
    </Dialog>
  )
}
