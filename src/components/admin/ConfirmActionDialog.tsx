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
// Shell matches RegenerateDialog and StockImageLightbox: same overlay, radius, border and
// focus behaviour, so the review surface has one modal language rather than three.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react'

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
  /** The post being acted on. Shown truncated under the title. */
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
  const dialogRef = useRef<HTMLDivElement>(null)
  const firstRef  = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  // Opener captured BEFORE focus moves into the dialog; restored on unmount only, so a
  // re-render mid-request cannot yank focus. Same fix as StockImageLightbox.
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
      const f = root.querySelectorAll<HTMLElement>('button:not([disabled])')
      if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, busy])

  return (
    <div
      role="dialog" aria-modal="true" aria-label={title}
      onClick={() => { if (!busy) onCancel() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        ref={dialogRef}
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-elevated, #fff)', borderRadius: 10, width: 'min(460px, 100%)',
          border: '1px solid var(--border)', boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)' }}>
          <strong style={{ fontSize: '0.95rem', color: 'var(--text-primary)' }}>{title}</strong>
          {subtitle && (
            <div style={{
              fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {subtitle}
            </div>
          )}
        </div>

        <div style={{ padding: '16px 18px' }}>
          <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.55, color: 'var(--text-secondary)' }}>
            {body}
          </p>
        </div>

        <div style={{
          padding: '12px 18px 16px', display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          {choices.map((c, i) => (
            <button
              key={c.id}
              ref={i === 0 ? firstRef : undefined}
              type="button"
              disabled={busy}
              onClick={() => onChoose(c.id)}
              className={`btn ${c.tone === 'destructive' ? 'btn-secondary' : 'btn-primary'}`}
              style={{
                width: '100%', justifyContent: 'center', padding: '0.55rem',
                fontSize: '0.8125rem', flexDirection: 'column', gap: 2,
                ...(c.tone === 'destructive'
                  ? { background: '#7f1d1d', borderColor: '#7f1d1d', color: '#fff' }
                  : {}),
                ...(i > 0 && c.tone !== 'destructive'
                  ? { background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)' }
                  : {}),
                opacity: busy ? 0.6 : 1,
              }}
            >
              <span style={{ fontWeight: 600 }}>{c.label}</span>
              {c.hint && (
                <span style={{ fontSize: '0.7rem', fontWeight: 400, opacity: 0.85 }}>{c.hint}</span>
              )}
            </button>
          ))}

          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="btn btn-secondary"
            style={{ width: '100%', justifyContent: 'center', padding: '0.5rem', fontSize: '0.8125rem' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
