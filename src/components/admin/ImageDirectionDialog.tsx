'use client'

// Regenerate a post's featured image with a chosen look (photo, illustration, …) and an optional
// note on the treatment. Built on the shared Dialog.

import { useRef, useState } from 'react'
import Dialog from '@/components/ui/Dialog'
import Field from '@/components/ui/Field'
import { IMAGE_DIRECTIONS, DEFAULT_DIRECTION, type ImageDirectionId } from '@/lib/content/imageDirections'

export interface ImageDirectionRequest {
  direction: ImageDirectionId
  notes:     string
}

interface Props {
  postTitle?: string | null
  busy?:      boolean
  onCancel:   () => void
  onConfirm:  (req: ImageDirectionRequest) => void
}

export default function ImageDirectionDialog({ postTitle, busy, onCancel, onConfirm }: Props) {
  const [direction, setDirection] = useState<ImageDirectionId>(DEFAULT_DIRECTION)
  const [notes,     setNotes]     = useState('')
  const firstRef = useRef<HTMLButtonElement>(null)
  const chosen = IMAGE_DIRECTIONS.find(d => d.id === direction)

  return (
    <Dialog
      open
      onClose={onCancel}
      title="Regenerate the image"
      description={postTitle ?? undefined}
      busy={busy}
      initialFocus={firstRef}
      bodyClassName="ui-stack-sm"
      footer={<>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onConfirm({ direction, notes: notes.trim() })}>
          {busy ? 'Generating…' : 'Generate image'}
        </button>
      </>}
    >
      <div>
        <p className="ui-label" id="img-look-label">Look</p>
        <div className="ui-picks" role="group" aria-labelledby="img-look-label">
          {IMAGE_DIRECTIONS.map((d, i) => (
            <button
              key={d.id}
              ref={i === 0 ? firstRef : undefined}
              type="button"
              className="ui-pick"
              disabled={busy}
              title={d.hint}
              aria-pressed={direction === d.id}
              onClick={() => setDirection(d.id)}
            >
              {d.label}
            </button>
          ))}
        </div>
        {/* The hint for the chosen look, so the consequence is readable without hovering. */}
        {chosen && <p className="ui-hint">{chosen.hint}</p>}
      </div>

      <Field
        label="Anything to change (optional)"
        id="image-direction-notes"
        hint="Describe the treatment, not the subject: the post already supplies that. Text and people are left out of every image."
      >
        <textarea
          id="image-direction-notes"
          className="input"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          disabled={busy}
          rows={3}
          aria-describedby="image-direction-notes-hint"
          placeholder="e.g. wider shot, colder light, show the whole bay rather than a close-up"
          style={{ resize: 'vertical' }}
        />
      </Field>
    </Dialog>
  )
}
