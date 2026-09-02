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
// would be silently ignored.

import { useState, useEffect, useRef } from 'react'

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
  const dialogRef = useRef<HTMLDivElement>(null)
  const firstRef  = useRef<HTMLButtonElement>(null)

  useEffect(() => { firstRef.current?.focus() }, [])

  // Escape closes and Tab is trapped — aria-modal claims the background is inert, and
  // behind this dialog sit Approve, Reject and Save Changes.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCancel(); return }
      if (e.key !== 'Tab') return
      const root = dialogRef.current
      if (!root) return
      const f = root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); previouslyFocused?.focus?.() }
  }, [onCancel])

  const optionStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, textAlign: 'left', padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
    border: `1px solid ${active ? 'var(--blue)' : 'var(--border)'}`,
    background: active ? 'rgba(37,99,235,0.06)' : 'var(--bg-base)',
  })

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Regenerate this post"
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        ref={dialogRef}
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-card, #fff)', borderRadius: 10, width: 'min(560px, 100%)',
          border: '1px solid var(--border)', boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
          maxHeight: '85vh', overflowY: 'auto',
        }}
      >
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)' }}>
          <strong style={{ fontSize: '0.95rem' }}>Regenerate</strong>
          {postTitle && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {postTitle}
            </div>
          )}
        </div>

        <div style={{ padding: 18 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <button
              ref={firstRef}
              type="button" onClick={() => setScope('rewrite')}
              style={optionStyle(scope === 'rewrite')}
              aria-pressed={scope === 'rewrite'}
            >
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>Rewrite content</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.35 }}>
                Keeps the topic, keyword and publish date. Rewrites the article.
              </div>
            </button>
            <button
              type="button" onClick={() => setScope('new_topic')}
              style={optionStyle(scope === 'new_topic')}
              aria-pressed={scope === 'new_topic'}
            >
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>New topic &amp; article</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.35 }}>
                Picks a fresh topic and writes it. The old topic is rejected. Not undoable.
              </div>
            </button>
          </div>

          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
            Direction <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>— optional</span>
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={scope === 'rewrite'
              ? 'e.g. Less sales-y, add a short cost table, keep it under 1200 words'
              : 'e.g. Something seasonal, aimed at first-time buyers'}
            style={{
              width: '100%', padding: '7px 10px', borderRadius: 6, resize: 'vertical',
              border: '1px solid var(--border)', background: 'var(--bg-base)',
              color: 'var(--text-primary)', fontSize: '0.82rem', marginBottom: 12,
            }}
          />

          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
            Target keyword <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>— optional</span>
          </label>
          <input
            value={steerKeyword}
            onChange={e => setSteerKeyword(e.target.value)}
            maxLength={200}
            disabled={scope === 'rewrite'}
            placeholder={scope === 'rewrite'
              ? 'Only applies when picking a new topic'
              : 'e.g. commercial awning installation'}
            style={{
              width: '100%', padding: '7px 10px', borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--bg-base)',
              color: 'var(--text-primary)', fontSize: '0.82rem',
              opacity: scope === 'rewrite' ? 0.5 : 1,
            }}
          />
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 5 }}>
            {scope === 'rewrite'
              ? 'The topic is already fixed for a rewrite, so there is nothing for a keyword to steer.'
              : 'Steers which topic is chosen. Topics already covered for this client stay excluded.'}
          </div>
        </div>

        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8rem' }} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button" className="btn btn-primary" style={{ fontSize: '0.8rem' }}
            disabled={busy}
            onClick={() => onConfirm({ scope, notes: notes.trim(), steerKeyword: steerKeyword.trim() })}
          >
            {busy ? 'Starting…' : scope === 'rewrite' ? 'Rewrite article' : 'Pick new topic & write'}
          </button>
        </div>
      </div>
    </div>
  )
}
