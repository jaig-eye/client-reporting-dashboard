'use client'

import { useEffect, useRef, useState } from 'react'
import { LockSimple } from '@phosphor-icons/react'

/** Auto-hide again after this long, so a revealed password does not sit on screen. */
const AUTO_HIDE_MS = 30_000

/**
 * Entry field for a stored credential.
 *
 * Deliberately never receives the existing value: an edit form that pre-fills a
 * password would put it in the DOM (and in the browser's autofill store) every
 * time someone opened the note to change something unrelated. Leaving it blank
 * means "keep what is stored"; typing replaces it; the Clear button removes it.
 */
export function NoteSecretInput({
  hasSecret,
  value,
  onChange,
  onClear,
}: {
  hasSecret: boolean
  value:     string
  onChange:  (v: string) => void
  onClear?:  () => void
}) {
  const [show, setShow] = useState(false)

  return (
    <div className="note-secret">
      <div className="note-secret__head">
        <LockSimple size={12} weight="bold" aria-hidden />
        <span className="note-secret__label">Password · encrypted</span>
        {hasSecret && (
          <span className="note-secret__sub">One is stored — leave blank to keep it</span>
        )}
      </div>

      <div className="note-secret__row">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          autoComplete="new-password"
          spellCheck={false}
          onChange={e => onChange(e.target.value)}
          placeholder={hasSecret ? '•••••••• (unchanged)' : 'Optional'}
          aria-label="Password"
          className="note-field__input note-secret__input"
        />
        <button type="button" onClick={() => setShow(s => !s)} className="note-btn note-btn--ghost">
          {show ? 'Hide' : 'Show'}
        </button>
        {hasSecret && onClear && (
          <button type="button" onClick={onClear} className="note-btn note-btn--ghost note-btn--danger">
            Clear
          </button>
        )}
      </div>

      <p className="note-secret__fine">
        Encrypted before it is saved and only shown again through a recorded unlock. Anyone who can run
        code on the server can still decrypt it — don&apos;t store banking or payment logins here.
      </p>
    </div>
  )
}

/**
 * Read side: shows that a credential exists and fetches it on demand.
 *
 * The value arrives only from the audited reveal endpoint, is held in component
 * state, and clears itself after 30 seconds so it does not linger on a screen
 * someone walked away from.
 */
export function NoteSecretReveal({
  clientId,
  noteId,
  hasSecret,
}: {
  clientId:  string
  noteId:    string
  hasSecret: boolean
}) {
  const [secret,  setSecret]  = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [copied,  setCopied]  = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  if (!hasSecret) return null

  async function reveal() {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/notes/${noteId}/reveal`, { method: 'POST' })
      const body = await res.json().catch(() => ({})) as { secret?: string; error?: string }
      if (!res.ok) { setError(body.error ?? 'Could not unlock this credential'); return }
      setSecret(body.secret ?? '')
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setSecret(null), AUTO_HIDE_MS)
    } catch {
      setError('Could not reach the server')
    } finally {
      setLoading(false)
    }
  }

  function hide() {
    if (timer.current) clearTimeout(timer.current)
    setSecret(null)
  }

  async function copy() {
    if (!secret) return
    try {
      await navigator.clipboard.writeText(secret)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard blocked — the value is on screen anyway */ }
  }

  return (
    <div className="note-secret note-secret--reveal">
      <div className="note-secret__row note-secret__row--wrap">
        <LockSimple size={13} weight="bold" className="note-secret__icon" aria-hidden />
        <span className="note-secret__label">Password</span>

        {secret === null ? (
          <>
            <code className="note-secret__mask" aria-label="Hidden password">••••••••••</code>
            <button onClick={reveal} disabled={loading} className="note-btn note-btn--amber note-secret__push">
              {loading ? 'Unlocking…' : 'Unlock'}
            </button>
          </>
        ) : (
          <>
            <code className="note-secret__value">{secret}</code>
            <div className="note-secret__push note-secret__btns">
              <button onClick={copy} className="note-btn note-btn--ghost">
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button onClick={hide} className="note-btn note-btn--ghost">
                Hide
              </button>
            </div>
          </>
        )}
      </div>

      {error && <p className="note-secret__error">{error}</p>}
      {secret !== null && !error && (
        <p className="note-secret__fine">Hides again in 30 seconds. This unlock was recorded.</p>
      )}
    </div>
  )
}
