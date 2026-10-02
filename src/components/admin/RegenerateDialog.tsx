'use client'

// One dialog for both regeneration actions, used by the review drawer and the monthly
// review card so the two entry points cannot drift apart.
//
// The two scopes are genuinely different operations and the copy says so, because the
// distinction was previously buried in a footnote under two similarly-named buttons:
//
//   REWRITE   keeps the topic, the keyword and the slot, and rewrites the article. Cheap,
//             reversible in effect, and the right choice when the angle is fine but the
//             execution is not.
//   NEW TOPIC discards the topic entirely, picks a fresh one, and writes a new article.
//             The old topic is marked rejected and its silo keyword returned to the
//             queue. Not undoable.
//
// The keyword field only steers NEW TOPIC — for a rewrite the topic is already fixed, so
// there is nothing for it to steer. The UI says that rather than accepting input that
// would be silently ignored. Built on the shared Dialog.

import { useRef, useState } from 'react'
import Dialog from '@/components/ui/Dialog'
import Field from '@/components/ui/Field'

export type RegenerateScope = 'rewrite' | 'new_topic'

export interface RegenerateRequest {
  scope: RegenerateScope
  /** Free-text direction for the writer. Applies to both scopes. */
  notes: string
  /** Keyword or angle to steer topic selection. Only meaningful for 'new_topic'. */
  steerKeyword: string
}

interface Props {
  /** Shown in the header so the reviewer knows which post they are acting on. */
  postTitle?: string | null
  /** True while the request is in flight. */
  busy?: boolean
  onCancel: () => void
  onConfirm: (req: RegenerateRequest) => void
}

export default function RegenerateDialog({ postTitle, busy, onCancel, onConfirm }: Props) {
  const [scope,        setScope]        = useState<RegenerateScope>('rewrite')
  const [notes,        setNotes]        = useState('')
  const [steerKeyword, setSteerKeyword] = useState('')
  const firstRef = useRef<HTMLButtonElement>(null)

  return (
    <Dialog
      open
      onClose={onCancel}
      title="Regenerate"
      description={postTitle ?? undefined}
      busy={busy}
      initialFocus={firstRef}
      bodyClassName="ui-stack-sm"
      footer={<>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button
          type="button" className="btn btn-primary" disabled={busy}
          onClick={() => onConfirm({ scope, notes: notes.trim(), steerKeyword: steerKeyword.trim() })}
        >
          {busy ? 'Starting…' : scope === 'rewrite' ? 'Rewrite the article' : 'Pick a new topic and write it'}
        </button>
      </>}
    >
      <div className="ui-choices" role="group" aria-label="What to regenerate">
        <button ref={firstRef} type="button" className="ui-choice" onClick={() => setScope('rewrite')} aria-pressed={scope === 'rewrite'}>
          <span className="ui-choice-title">Rewrite the content</span>
          <span className="ui-choice-text">Keeps the topic, keyword and publish date. Rewrites the article.</span>
        </button>
        <button type="button" className="ui-choice" onClick={() => setScope('new_topic')} aria-pressed={scope === 'new_topic'}>
          <span className="ui-choice-title">New topic and article</span>
          <span className="ui-choice-text">Picks a fresh topic and writes it. The old topic is rejected. Can’t be undone.</span>
        </button>
      </div>

      <Field label="Direction (optional)" id="regen-notes">
        <textarea
          id="regen-notes"
          className="input"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder={scope === 'rewrite'
            ? 'e.g. Less sales-y, add a short cost table, keep it under 1200 words'
            : 'e.g. Something seasonal, aimed at first-time buyers'}
          style={{ resize: 'vertical' }}
        />
      </Field>

      <Field
        label="Target keyword (optional)"
        id="regen-keyword"
        hint={scope === 'rewrite'
          ? 'The topic is already fixed for a rewrite, so there is nothing for a keyword to steer.'
          : 'Steers which topic is chosen. Topics already covered for this client stay excluded.'}
      >
        <input
          id="regen-keyword"
          className="input"
          value={steerKeyword}
          onChange={e => setSteerKeyword(e.target.value)}
          maxLength={200}
          disabled={scope === 'rewrite'}
          aria-describedby="regen-keyword-hint"
          placeholder={scope === 'rewrite' ? 'Only applies when picking a new topic' : 'e.g. commercial awning installation'}
        />
      </Field>
    </Dialog>
  )
}
