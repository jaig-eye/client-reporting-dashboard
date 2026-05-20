'use client'

import { useState, useEffect, useRef } from 'react'

interface IntegrationModalProps {
  open:          boolean
  onClose:       () => void
  onSaved?:      () => void        // called after success animation ends
  title:         string
  icon:          React.ReactNode
  howTo?:        React.ReactNode   // collapsible guide
  children:      React.ReactNode   // the fields
  onSave:        () => Promise<void>
  saveLabel?:    string            // default "Connect"
  isConnected?:  boolean           // true → button says "Save Changes"
  canDelete?:    boolean
  onDelete?:     () => Promise<void>
}

export default function IntegrationModal({
  open, onClose, onSaved, title, icon, howTo, children,
  onSave, saveLabel, isConnected, canDelete, onDelete,
}: IntegrationModalProps) {
  const [saving,    setSaving]    = useState(false)
  const [deleting,  setDeleting]  = useState(false)
  const [error,     setError]     = useState('')
  const [success,   setSuccess]   = useState(false)
  const [showHowTo, setShowHowTo] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!open) {
      setSaving(false); setError(''); setSuccess(false); setShowHowTo(false)
      if (closeTimer.current) clearTimeout(closeTimer.current)
    }
  }, [open])

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      await onSave()
      setSuccess(true)
      closeTimer.current = setTimeout(() => {
        setSuccess(false)
        onClose()
        onSaved?.()
      }, 1400)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!onDelete) return
    setDeleting(true)
    setError('')
    try {
      await onDelete()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.')
    } finally {
      setDeleting(false)
    }
  }

  if (!open) return null

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget && !saving) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999, padding: '1rem',
      }}
    >
      <div
        style={{
          background: 'var(--bg-surface)', borderRadius: 14, width: '100%', maxWidth: 440,
          boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
          overflow: 'hidden', position: 'relative',
        }}
      >
        {/* ── Success overlay ─────────────────────────────────────── */}
        {success && (
          <div
            style={{
              position: 'absolute', inset: 0, background: 'var(--bg-surface)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: '0.75rem', zIndex: 10,
            }}
          >
            <div className="integration-success-circle">
              <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
                <circle cx="28" cy="28" r="26" stroke="#16a34a" strokeWidth="2.5" fill="#f0fdf4"
                  style={{ animation: 'circle-scale 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards' }} />
                <polyline points="16,28 23,35 40,19" stroke="#16a34a" strokeWidth="3"
                  strokeLinecap="round" strokeLinejoin="round"
                  style={{ strokeDasharray: 36, strokeDashoffset: 36, animation: 'checkmark-draw 0.4s 0.25s ease forwards' }} />
              </svg>
            </div>
            <span style={{ fontWeight: 600, color: '#16a34a', fontSize: '0.9375rem' }}>
              {isConnected ? 'Settings saved!' : 'Connected!'}
            </span>
          </div>
        )}

        {/* ── Header ──────────────────────────────────────────────── */}
        <div style={{
          padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: '0.75rem',
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8, background: 'var(--bg-subtle)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.125rem', flexShrink: 0,
          }}>
            {icon}
          </div>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700 }}>{title}</h2>
            {isConnected && (
              <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--text-muted)' }}>Connected — update credentials below</p>
            )}
          </div>
          <button
            type="button" onClick={onClose} disabled={saving}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem', color: 'var(--text-faint)', lineHeight: 1 }}
          >×</button>
        </div>

        {/* ── How-to guide (collapsible) ───────────────────────────── */}
        {howTo && (
          <div style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <button
              type="button"
              onClick={() => setShowHowTo(v => !v)}
              style={{
                width: '100%', padding: '0.625rem 1.25rem',
                background: showHowTo ? 'var(--bg-subtle)' : 'transparent',
                border: 'none', cursor: 'pointer', textAlign: 'left',
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                fontSize: '0.775rem', fontWeight: 600, color: 'var(--text-muted)',
              }}
            >
              <span style={{ transform: showHowTo ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block' }}>▶</span>
              How to find these credentials
            </button>
            {showHowTo && (
              <div style={{
                padding: '0.75rem 1.25rem', background: 'var(--bg-subtle)',
                fontSize: '0.775rem', color: 'var(--text-muted)', lineHeight: 1.6,
              }}>
                {howTo}
              </div>
            )}
          </div>
        )}

        {/* ── Fields ──────────────────────────────────────────────── */}
        <div style={{ padding: '1.125rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          {children}
          {error && (
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--red)' }}>{error}</p>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────────── */}
        <div style={{
          padding: '0.875rem 1.25rem', borderTop: '1px solid var(--border)',
          display: 'flex', gap: '0.5rem', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            {canDelete && isConnected && (
              <button
                type="button" onClick={handleDelete} disabled={deleting || saving}
                className="btn btn-danger"
                style={{ fontSize: '0.8rem', padding: '0.375rem 0.75rem' }}
              >
                {deleting ? 'Removing…' : 'Disconnect'}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button" onClick={onClose} disabled={saving}
              className="btn btn-secondary" style={{ fontSize: '0.8rem' }}
            >Cancel</button>
            <button
              type="button" onClick={handleSave} disabled={saving || success}
              className="btn btn-primary" style={{ fontSize: '0.8rem', minWidth: 80 }}
            >
              {saving ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
                  Saving…
                </span>
              ) : saveLabel ?? (isConnected ? 'Save Changes' : 'Connect')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
