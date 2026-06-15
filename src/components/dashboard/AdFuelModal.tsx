'use client'

import { useState, useEffect, useCallback } from 'react'
import { fmt$ } from '@/lib/metrics'

interface LedgerEntry {
  id:              string
  date_of_payment: string | null
  invoice_date:    string | null
  amount_af:       number
  type:            string | null
  note:            string | null
  ach_status:      string | null
  created_at:      string
}

interface DailyDebit {
  date:        string
  google_spend: number
  meta_spend:  number
  total:       number
}

function fmtShort(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function AdFuelModal({ onClose }: { onClose: () => void }) {
  const [tab,          setTab]          = useState<'payments' | 'spend'>('payments')
  const [ledger,       setLedger]       = useState<LedgerEntry[]>([])
  const [dailyDebits,  setDailyDebits]  = useState<DailyDebit[]>([])
  const [loading,      setLoading]      = useState(true)
  const [loadingMore,  setLoadingMore]  = useState(false)
  const [nextPage,     setNextPage]     = useState<number | null>(null)
  const [error,        setError]        = useState('')

  const loadPage = useCallback(async (page: number) => {
    if (page === 0) setLoading(true); else setLoadingMore(true)
    try {
      const res = await fetch(`/api/dashboard/ad-fuel/details?page=${page}`)
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      if (page === 0) {
        setLedger(data.ledger ?? [])
        setDailyDebits(data.dailyDebits ?? [])
      } else {
        setDailyDebits(prev => [...prev, ...(data.dailyDebits ?? [])])
      }
      setNextPage(data.nextPage)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error loading data')
    } finally {
      if (page === 0) setLoading(false); else setLoadingMore(false)
    }
  }, [])

  useEffect(() => { loadPage(0) }, [loadPage])

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--bg-surface, #fff)',
        borderRadius: 16,
        border: '1px solid var(--border, #e5e7eb)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.20)',
        width: '100%', maxWidth: 640,
        maxHeight: '85vh',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '1.25rem 1.5rem 0', borderBottom: '1px solid var(--border-subtle, #f3f4f6)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Ad Fuel Activity</h2>
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: '1.25rem', padding: '0.25rem', lineHeight: 1 }}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '0.125rem' }}>
            {(['payments', 'spend'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: '0.375rem 0.875rem',
                  fontSize: '0.8125rem', fontWeight: tab === t ? 600 : 400,
                  color: tab === t ? 'var(--text-primary)' : 'var(--text-faint)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  borderBottom: tab === t ? '2px solid var(--blue, #3b82f6)' : '2px solid transparent',
                  marginBottom: -1,
                  transition: 'color 0.1s',
                }}
              >
                {t === 'payments' ? 'Payments' : 'Daily Spend'}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem' }}>
          {loading ? (
            <p style={{ color: 'var(--text-faint)', fontSize: '0.875rem', textAlign: 'center', paddingTop: '2rem' }}>Loading…</p>
          ) : error ? (
            <p style={{ color: 'var(--red)', fontSize: '0.875rem' }}>{error}</p>
          ) : tab === 'payments' ? (
            <>
              {/* Payments received (ledger) */}
              <section>
                {ledger.length === 0 ? (
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-faint)' }}>No payment records yet.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                    {ledger.map(entry => {
                      const isPending = entry.ach_status === 'pending'
                      const dateStr   = entry.date_of_payment ?? entry.invoice_date ?? entry.created_at.slice(0, 10)
                      return (
                        <div
                          key={entry.id}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
                            padding: '0.625rem 0.875rem', borderRadius: 8,
                            background: 'var(--bg-subtle)',
                            opacity: isPending ? 0.55 : 1,
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{fmtShort(dateStr)}</span>
                              {entry.type && (
                                <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: 'var(--bg-surface)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}>
                                  {entry.type}
                                </span>
                              )}
                              {isPending && (
                                <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: '#fef3c7', color: '#92400e' }}>
                                  Pending
                                </span>
                              )}
                            </div>
                            {entry.note && (
                              <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {entry.note}
                              </p>
                            )}
                          </div>
                          <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: entry.amount_af >= 0 ? 'var(--green)' : 'var(--red)', flexShrink: 0 }}>
                            {entry.amount_af >= 0 ? '+' : ''}{fmt$(entry.amount_af)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            </>
          ) : (
            <>
              {/* Daily spend (debit log) */}
              <section>
                {dailyDebits.length === 0 ? (
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-faint)' }}>No spend data available.</p>
                ) : (
                  <>
                    {/* Header row */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px', gap: '0.5rem', padding: '0 0.875rem', marginBottom: '0.375rem' }}>
                      <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date</span>
                      <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--text-faint)', textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Google</span>
                      <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--text-faint)', textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Meta</span>
                      <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--text-faint)', textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      {dailyDebits.map(row => (
                        <div
                          key={row.date}
                          style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px', gap: '0.5rem', padding: '0.5rem 0.875rem', borderRadius: 8, background: 'var(--bg-subtle)' }}
                        >
                          <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{fmtShort(row.date)}</span>
                          <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', textAlign: 'right' }}>{row.google_spend > 0 ? fmt$(row.google_spend) : '—'}</span>
                          <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', textAlign: 'right' }}>{row.meta_spend > 0 ? fmt$(row.meta_spend) : '—'}</span>
                          <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', textAlign: 'right' }}>{fmt$(row.total)}</span>
                        </div>
                      ))}
                    </div>

                    {nextPage !== null && (
                      <button
                        onClick={() => loadPage(nextPage)}
                        disabled={loadingMore}
                        style={{
                          display: 'block', width: '100%', marginTop: '0.75rem',
                          padding: '0.5rem', borderRadius: 8, border: '1px solid var(--border)',
                          background: 'var(--bg-surface)', cursor: loadingMore ? 'not-allowed' : 'pointer',
                          fontSize: '0.8125rem', color: 'var(--text-muted)',
                          transition: 'background 0.1s',
                        }}
                      >
                        {loadingMore ? 'Loading…' : 'Load more'}
                      </button>
                    )}
                  </>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
