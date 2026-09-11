'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Steering for a regenerated featured image.
//
// The old control was a bare "Generate with AI" button: one shot, no input, and if the
// result was wrong the only recourse was pressing it again and hoping. That is the same
// problem RegenerateDialog solved for article text, so this mirrors it — a preset choice
// plus optional free text — rather than inventing a second vocabulary for the same idea.
//
// The presets exist because of how people misuse an open prompt box: they describe the
// SUBJECT ("a truck in a garage"), which the model already knows from the post, when what
// it actually lacks is a TREATMENT. Naming the treatments turns the text box into what it
// should be — a modifier on a chosen look — and puts the good ones one click away.
//
// Both are optional. Confirming with neither regenerates on the client's default look,
// which is exactly what the old button did.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react'
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

  const dialogRef = useRef<HTMLDivElement>(null)
  const firstRef  = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  // Opener captured before focus moves in; restored on unmount only, so a re-render while
  // the request is in flight cannot pull focus out of the dialog.
  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null
    firstRef.current?.focus()
    return () => { openerRef.current?.focus?.() }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (!busy) onCancel(); return }
      if (e.key !== 'Tab') return
      const root = dialogRef.current
      if (!root) return
      const f = root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, busy])

  const pillStyle = (active: boolean): React.CSSProperties => ({
    padding: '5px 11px',
    borderRadius: 999,
    fontSize: '0.75rem',
    fontWeight: active ? 700 : 500,
    cursor: busy ? 'default' : 'pointer',
    border: `1px solid ${active ? 'var(--blue)' : 'var(--border)'}`,
    background: active ? 'rgba(37,99,235,0.08)' : 'var(--bg-base)',
    color: active ? 'var(--blue)' : 'var(--text-secondary)',
    transition: 'background 0.12s ease, border-color 0.12s ease',
  })

  const chosen = IMAGE_DIRECTIONS.find(d => d.id === direction)

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Regenerate the featured image"
      onClick={() => { if (!busy) onCancel() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1150, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        ref={dialogRef}
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-elevated, #fff)', borderRadius: 10, width: 'min(560px, 100%)',
          border: '1px solid var(--border)', boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
          maxHeight: '85vh', overflowY: 'auto',
        }}
      >
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)' }}>
          <strong style={{ fontSize: '0.95rem', color: 'var(--text-primary)' }}>Regenerate image</strong>
          {postTitle && (
            <div style={{
              fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {postTitle}
            </div>
          )}
        </div>

        <div style={{ padding: 18 }}>
          <label style={{
            display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.04em', color: 'var(--text-faint)', marginBottom: 8,
          }}>
            Look
          </label>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {IMAGE_DIRECTIONS.map((d, i) => (
              <button
                key={d.id}
                ref={i === 0 ? firstRef : undefined}
                type="button"
                disabled={busy}
                title={d.hint}
                aria-pressed={direction === d.id}
                onClick={() => setDirection(d.id)}
                style={pillStyle(direction === d.id)}
              >
                {d.label}
              </button>
            ))}
          </div>

          {/* The hint for the CHOSEN pill, so the consequence of the click is readable
              without hovering every option to find out what they mean. */}
          {chosen && (
            <p style={{ margin: '8px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {chosen.hint}
            </p>
          )}

          <label
            htmlFor="image-direction-notes"
            style={{
              display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.04em', color: 'var(--text-faint)', margin: '16px 0 4px',
            }}
          >
            Anything to change (optional)
          </label>
          <textarea
            id="image-direction-notes"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            disabled={busy}
            rows={3}
            className="input"
            placeholder="e.g. wider shot, colder light, show the whole bay rather than a close-up"
            style={{ width: '100%', resize: 'vertical', fontSize: '0.8125rem' }}
          />
          <p style={{ margin: '4px 0 0', fontSize: '0.7rem', color: 'var(--text-faint)', lineHeight: 1.5 }}>
            Describe the treatment, not the subject — the post already supplies that. Text and
            people are excluded from every image by rule, so no need to ask.
          </p>
        </div>

        <div style={{
          padding: '12px 18px 16px', display: 'flex', gap: 8, justifyContent: 'flex-end',
          borderTop: '1px solid var(--border)',
        }}>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onCancel} style={{ fontSize: '0.8125rem' }}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => onConfirm({ direction, notes: notes.trim() })}
            style={{ fontSize: '0.8125rem' }}
          >
            {busy ? 'Generating…' : 'Generate image'}
          </button>
        </div>
      </div>
    </div>
  )
}
