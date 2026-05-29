'use client'

import { useState } from 'react'
import { ArrowsCounterClockwise } from '@phosphor-icons/react'

export default function GoogleRefreshButton() {
  const [loading,  setLoading]  = useState(false)
  const [result,   setResult]   = useState<string | null>(null)

  async function handleRefresh() {
    setLoading(true)
    setResult(null)
    try {
      const res  = await fetch('/api/admin/google/refresh-accounts', { method: 'POST' })
      const data = await res.json() as { refreshed?: number; results?: { label: string; accounts: number; error?: string }[]; error?: string }
      if (!res.ok) throw new Error(data.error || 'Refresh failed')
      const total = data.results?.reduce((s, r) => s + r.accounts, 0) ?? 0
      setResult(`Refreshed — ${total} account${total === 1 ? '' : 's'} found`)
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'Refresh failed')
    } finally {
      setLoading(false)
      setTimeout(() => setResult(null), 4000)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
      <button
        className="btn btn-secondary"
        onClick={handleRefresh}
        disabled={loading}
        title="Re-fetches your Google Ads account list to discover recently added clients"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.75rem' }}
      >
        <ArrowsCounterClockwise size={14} weight={loading ? 'regular' : 'bold'} style={loading ? { animation: 'spin 1s linear infinite' } : undefined} />
        {loading ? 'Refreshing…' : 'Refresh Accounts'}
      </button>
      {result && (
        <span style={{ fontSize: '0.75rem', color: result.startsWith('Refreshed') ? 'var(--green)' : 'var(--red)' }}>
          {result}
        </span>
      )}
    </div>
  )
}
