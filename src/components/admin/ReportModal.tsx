'use client'

import { useState, useRef, useEffect } from 'react'
import { X, Envelope, Check } from '@phosphor-icons/react'

interface Props {
  from: string
  to: string
  compare: string
  clientId: string
  onClose: () => void
}

export default function ReportModal({ from, to, compare, clientId, onClose }: Props) {
  const [email,   setEmail]   = useState('')
  const [sending, setSending] = useState(false)
  const [sent,    setSent]    = useState(false)
  const [error,   setError]   = useState('')
  const backdropRef = useRef<HTMLDivElement>(null)

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const qs = [
    from    ? `from=${from}`    : '',
    to      ? `to=${to}`        : '',
    compare && compare !== 'none' ? `compare=${compare}` : '',
  ].filter(Boolean).join('&')
  const previewSrc = `/api/export/report?format=email${qs ? '&' + qs : ''}`

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!email) return
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/admin/report/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, email, from, to, compare }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send')
      setSent(true)
      setTimeout(onClose, 1800)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      ref={backdropRef}
      onClick={e => { if (e.target === backdropRef.current) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        width: '100%',
        maxWidth: 740,
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.875rem 1.25rem',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--text-primary)' }}>
            Email Report Preview
          </span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, display: 'flex' }}
          >
            <X size={16} weight="bold" />
          </button>
        </div>

        {/* Preview iframe */}
        <div style={{ flex: 1, overflow: 'hidden', background: '#f3f4f6', minHeight: 420 }}>
          <iframe
            src={previewSrc}
            style={{ display: 'block', width: '100%', height: '100%', minHeight: 420, border: 'none' }}
            title="Email report preview"
          />
        </div>

        {/* Send form */}
        <form
          onSubmit={handleSend}
          style={{
            padding: '0.875rem 1.25rem',
            borderTop: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 8,
            flexShrink: 0,
          }}
        >
          <Envelope size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            type="email"
            required
            className="input"
            placeholder="Send to email address…"
            value={email}
            onChange={e => { setEmail(e.target.value); setSent(false); setError('') }}
            style={{ flex: 1, fontSize: '0.8125rem' }}
            disabled={sending || sent}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={sending || sent || !email}
            style={{ padding: '0.375rem 0.85rem', fontSize: '0.8125rem', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5 }}
          >
            {sent
              ? <><Check size={13} weight="bold" /> Sent!</>
              : sending ? 'Sending…' : 'Send Report'}
          </button>
          {error && <p style={{ fontSize: '0.75rem', color: 'var(--red)', margin: 0 }}>{error}</p>}
        </form>
      </div>
    </div>
  )
}
