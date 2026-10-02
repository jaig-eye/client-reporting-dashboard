'use client'

// ─────────────────────────────────────────────────────────────────────────────
// One confirmation dialog for the review actions that reach a client's live site.
//
// Approve and Reject both used to fire on a single click. Approve PUSHES to the client's
// WordPress or BigCommerce site — with whatever status the post carries, so a post whose
// scheduled date has passed goes live the moment it is clicked — and Reject takes a post out
// of the plan. Neither is a "meh, undo it" action, and both sit next to each other under the
// same thumb.
//
// The unsaved-changes case is the one worth the extra thought. Approving a dirty drawer used
// to silently save first, which is the right guess most of the time but is invisible when it
// is wrong: the reviewer's half-finished edit went to the client's site without them ever
// agreeing to it. So a dirty drawer gets a THIRD option rather than a scarier warning —
// push with the edits, push without them, or go back — and a clean drawer never sees it.
//
// Built on the shared Dialog, like every other admin modal: focus, Escape, the phone sheet.
// ─────────────────────────────────────────────────────────────────────────────

import { useRef } from 'react'
import Dialog from '@/components/ui/Dialog'

export type ConfirmTone = 'primary' | 'destructive'

export interface ConfirmChoice {
  /** Returned to the caller so it can branch — e.g. 'save' vs 'discard' on a dirty drawer. */
  id:      string
  label:   string
  tone?:   ConfirmTone
  /** One line under the label, for choices whose consequence is not obvious from the verb. */
  hint?:   string
}

interface Props {
  title:    string
  /** The post being acted on. Shown under the title. */
  subtitle?: string | null
  /** The consequence, in a sentence. Say what happens, not "are you sure". */
  body:     string
  choices:  ConfirmChoice[]
  busy?:    boolean
  onCancel: () => void
  onChoose: (id: string) => void
}

export default function ConfirmActionDialog({
  title, subtitle, body, choices, busy, onCancel, onChoose,
}: Props) {
  const firstRef = useRef<HTMLButtonElement>(null)
  const destructive = choices.some(c => c.tone === 'destructive')

  return (
    <Dialog
      open
      onClose={onCancel}
      title={title}
      description={subtitle ?? undefined}
      size="sm"
      role={destructive ? 'alertdialog' : 'dialog'}
      busy={busy}
      initialFocus={firstRef}
      footer={
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
      }
    >
      <p className="ui-dialog-text">{body}</p>
      <div className="ui-actions-stack">
        {choices.map((c, i) => (
          <button
            key={c.id}
            ref={i === 0 ? firstRef : undefined}
            type="button"
            disabled={busy}
            onClick={() => onChoose(c.id)}
            className={`btn ${c.tone === 'destructive' ? 'btn-danger-solid' : i === 0 ? 'btn-primary' : 'btn-secondary'}`}
          >
            <span>{c.label}</span>
            {c.hint && <small>{c.hint}</small>}
          </button>
        ))}
      </div>
    </Dialog>
  )
}
