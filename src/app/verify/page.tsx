'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function VerifyPage() {
  const router   = useRouter()
  const [code,   setCode]   = useState('')
  const [error,  setError]  = useState('')
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [resent,  setResent]  = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)

    try {
      const res = await fetch('/api/auth/client-verify', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code }),
        signal:  controller.signal,
      })

      if (res.ok) {
        router.push('/dashboard')
        return
      }
      const data = await res.json().catch(() => ({})) as { error?: string }
      setError(data.error ?? 'Invalid or expired code.')
    } catch (err) {
      setError(err instanceof DOMException && err.name === 'AbortError'
        ? 'Request timed out — please try again.'
        : 'Network error — please try again.')
    } finally {
      clearTimeout(timeout)
      setLoading(false)
    }
  }

  async function handleResend() {
    setResending(true)
    setResent(false)
    setError('')

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)

    try {
      const res = await fetch('/api/auth/client-resend', { method: 'POST', signal: controller.signal })
      if (res.ok) {
        setResent(true)
      } else {
        setError('Failed to resend code. Please try again.')
      }
    } catch {
      setError('Failed to resend code. Please try again.')
    } finally {
      clearTimeout(timeout)
      setResending(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-base, #f8f9fb)',
      padding: '2rem',
    }}>
      <div style={{
        background: '#fff',
        border: '1.5px solid #e5e7eb',
        borderRadius: 12,
        padding: '2.5rem 2rem',
        maxWidth: 400,
        width: '100%',
        textAlign: 'center',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}>
        <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>🔐</div>
        <h1 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#111827', margin: '0 0 0.5rem' }}>
          Verify your location
        </h1>
        <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: '0 0 1.5rem', lineHeight: 1.6 }}>
          We noticed a new sign-in location. A 6-digit code was sent to your email address.
        </p>

        <form onSubmit={handleSubmit}>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            required
            style={{
              width: '100%',
              padding: '0.75rem 1rem',
              fontSize: '1.5rem',
              fontFamily: 'monospace',
              letterSpacing: '0.3em',
              textAlign: 'center',
              border: '1.5px solid #e5e7eb',
              borderRadius: 8,
              outline: 'none',
              marginBottom: '1rem',
              boxSizing: 'border-box',
            }}
          />

          {error && (
            <p style={{ fontSize: '0.875rem', color: '#ef4444', margin: '0 0 1rem' }}>
              {error}
            </p>
          )}

          {resent && (
            <p style={{ fontSize: '0.875rem', color: '#16a34a', margin: '0 0 1rem' }}>
              Code resent — check your email.
            </p>
          )}

          <button
            type="submit"
            disabled={loading || code.length !== 6}
            style={{
              width: '100%',
              padding: '0.75rem',
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: '0.9375rem',
              fontWeight: 600,
              cursor: loading || code.length !== 6 ? 'not-allowed' : 'pointer',
              opacity: loading || code.length !== 6 ? 0.6 : 1,
            }}
          >
            {loading ? 'Verifying…' : 'Verify'}
          </button>
        </form>

        <button
          onClick={handleResend}
          disabled={resending}
          style={{
            background: 'none',
            border: 'none',
            color: '#6b7280',
            fontSize: '0.8125rem',
            cursor: resending ? 'not-allowed' : 'pointer',
            marginTop: '1rem',
            textDecoration: 'underline',
            opacity: resending ? 0.6 : 1,
          }}
        >
          {resending ? 'Resending…' : 'Resend code'}
        </button>
      </div>
    </div>
  )
}
