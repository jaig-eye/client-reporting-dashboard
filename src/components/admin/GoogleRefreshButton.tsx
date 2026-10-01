'use client'

// Looks for Google accounts added since the last check (a new client's ad account, a new GA4
// property) without signing in again.

import { useState } from 'react'
import { ArrowsCounterClockwise } from '@phosphor-icons/react'

export default function GoogleRefreshButton() {
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState<{ ok: boolean; text: string } | null>(null)

  async function handleRefresh() {
    setLoading(true)
    setResult(null)
    try {
      const res  = await fetch('/api/admin/google/refresh-accounts', { method: 'POST' })
      const data = await res.json() as { refreshed?: number; results?: { label: string; accounts: number; error?: string }[]; error?: string }
      if (!res.ok) throw new Error(data.error || 'Couldn’t check for accounts.')
      const total = data.results?.reduce((s, r) => s + r.accounts, 0) ?? 0
      setResult({ ok: true, text: `${total} account${total === 1 ? '' : 's'} found` })
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : 'Couldn’t check for accounts.' })
    } finally {
      setLoading(false)
      setTimeout(() => setResult(null), 4000)
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {result && (
        <span role="status" style={{ fontSize: '0.75rem', color: result.ok ? 'var(--green-fg)' : 'var(--red-fg)' }}>{result.text}</span>
      )}
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={handleRefresh}
        disabled={loading}
        title="Check Google for accounts added since the last look"
      >
        <ArrowsCounterClockwise size={14} weight="bold" className={loading ? 'int-spin' : undefined} aria-hidden />
        {loading ? 'Checking…' : 'Find new accounts'}
      </button>
    </span>
  )
}
