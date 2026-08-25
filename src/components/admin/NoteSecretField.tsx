'use client'

import { useEffect, useRef, useState } from 'react'

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
    <div style={{
      padding: '0.5rem 0.6rem', borderRadius: 6,
      background: 'var(--bg-subtle)',
      border: '1px solid rgba(245,158,11,0.35)',
      borderLeft: '2px solid #f59e0b',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{
          fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.03em',
          textTransform: 'uppercase', color: '#b45309',
        }}>
          Password (encrypted)
        </span>
        {hasSecret && (
          <span style={{ fontSize: '0.6rem', color: 'var(--text-faint)' }}>
            — one is stored; leave blank to keep it
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 5 }}>
        <input
          type={show ? 'text' : 'password'}
          value={value}
          autoComplete="new-password"
          spellCheck={false}
          onChange={e => onChange(e.target.value)}
          placeholder={hasSecret ? '•••••••• (unchanged)' : 'Leave blank to store only the vault pointer'}
          style={{
            flex: 1, minWidth: 0, padding: '0.32rem 0.5rem', boxSizing: 'border-box',
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 5, fontSize: '0.75rem', color: 'var(--text)', fontFamily: 'inherit',
          }}
        />
        <button
          type="button"
          onClick={() => setShow(s => !s)}
          style={{
            padding: '0 8px', borderRadius: 5, cursor: 'pointer', fontSize: '0.68rem',
            background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)',
          }}
        >
          {show ? 'Hide' : 'Show'}
        </button>
        {hasSecret && onClear && (
          <button
            type="button"
            onClick={onClear}
            style={{
              padding: '0 8px', borderRadius: 5, cursor: 'pointer', fontSize: '0.68rem',
              background: 'transparent', border: '1px solid var(--border)', color: 'var(--red)',
            }}
          >
            Clear
          </button>
        )}
      </div>

      <p style={{ fontSize: '0.63rem', color: 'var(--text-faint)', margin: '5px 0 0', lineHeight: 1.5 }}>
        Encrypted before it is written, and never shown again without an unlock that is logged.
        For anything high-value, keep the vault as the source of truth and store only the pointer above.
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
    <div style={{
      margin: '0 0 0.75rem', padding: '0.55rem 0.7rem', borderRadius: 6,
      background: 'var(--bg-subtle)',
      border: '1px solid rgba(245,158,11,0.35)',
      borderLeft: '2px solid #f59e0b',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#b45309', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
          Password
        </span>

        {secret === null ? (
          <>
            <code style={{ fontSize: '0.8rem', color: 'var(--text-faint)', letterSpacing: '0.12em' }}>••••••••••</code>
            <button
              onClick={reveal}
              disabled={loading}
              style={{
                marginLeft: 'auto', padding: '2px 9px', borderRadius: 5, cursor: 'pointer',
                fontSize: '0.7rem', fontWeight: 600,
                background: '#f59e0b', color: '#fff', border: 'none',
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? 'Unlocking...' : 'Unlock'}
            </button>
          </>
        ) : (
          <>
            <code style={{
              fontSize: '0.82rem', color: 'var(--text)', wordBreak: 'break-all',
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              padding: '2px 6px', borderRadius: 4,
            }}>
              {secret}
            </code>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 5 }}>
              <button
                onClick={copy}
                style={{ padding: '2px 8px', borderRadius: 5, cursor: 'pointer', fontSize: '0.7rem', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                onClick={hide}
                style={{ padding: '2px 8px', borderRadius: 5, cursor: 'pointer', fontSize: '0.7rem', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
              >
                Hide
              </button>
            </div>
          </>
        )}
      </div>

      {error && (
        <p style={{ fontSize: '0.68rem', color: 'var(--red)', margin: '5px 0 0', lineHeight: 1.45 }}>{error}</p>
      )}
      {secret !== null && !error && (
        <p style={{ fontSize: '0.62rem', color: 'var(--text-faint)', margin: '5px 0 0' }}>
          Hides again in 30 seconds. This unlock was recorded.
        </p>
      )}
    </div>
  )
}
