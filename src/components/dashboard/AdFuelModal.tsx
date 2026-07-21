'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
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
  date:         string
  google_spend: number
  meta_spend:   number
  total:        number
}

function fmtShort(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function AdFuelModal({ balance, onClose }: { balance: number | null; onClose: () => void }) {
  const [tab,         setTab]         = useState<'payments' | 'balance'>('payments')
  const [ledger,      setLedger]      = useState<LedgerEntry[]>([])
  const [dailyDebits, setDailyDebits] = useState<DailyDebit[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/dashboard/ad-fuel/details')
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setLedger(data.ledger ?? [])
      setDailyDebits(data.dailyDebits ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error loading data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Payments tab: only last 6 months by effective date.
  // setDate(1) first to avoid month-overflow when today is day 29-31
  // (e.g. Oct 31 → Apr 31 overflows to May 1 without this guard).
  const sixMonthsAgo = useMemo(() => {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - 6)
    return d.toISOString().slice(0, 10)
  }, [])

  const recentLedger = useMemo(() =>
    ledger.filter(e => {
      const d = e.date_of_payment ?? e.invoice_date ?? e.created_at.slice(0, 10)
      return d >= sixMonthsAgo
    }),
  [ledger, sixMonthsAgo])

  // Balance tab: running balance computed by working backward from current balance
  const balanceDays = useMemo(() => {
    // Group confirmed payments by effective date
    const payByDate = new Map<string, number>()
    for (const e of ledger) {
      if (e.ach_status === 'pending') continue
      const d = e.date_of_payment ?? e.invoice_date ?? e.created_at.slice(0, 10)
      payByDate.set(d, (payByDate.get(d) ?? 0) + e.amount_af)
    }

    // Build spend lookup
    const spendByDate = new Map<string, number>()
    for (const d of dailyDebits) spendByDate.set(d.date, d.total)

    // Union of all active dates, newest first
    const allDates = new Set<string>()
    for (const d of dailyDebits) allDates.add(d.date)
    Array.from(payByDate.keys()).forEach(d => allDates.add(d))
    const dates = Array.from(allDates).sort().reverse()
    if (!dates.length) return []

    // Walk backward from current balance — bal is the end-of-day balance for the current date.
    // Use 0 as fallback when balance is null (RPC failure) — the tab shows no meaningful data.
    let bal = balance ?? 0
    return dates.map(date => {
      const spend    = spendByDate.get(date) ?? 0
      const payments = payByDate.get(date) ?? 0
      const delta    = payments - spend   // net change this day
      const dayBal   = bal
      bal = bal - delta                  // step one day further back
      return { date, delta, balance: dayBal }
    })
  }, [balance, ledger, dailyDebits])

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
        {/* Header + tabs */}
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
          <div style={{ display: 'flex', gap: '0.125rem' }}>
            {(['payments', 'balance'] as const).map(t => (
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
                {t === 'payments' ? 'Payments' : 'Balance'}
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
            <section>
              {recentLedger.length === 0 ? (
                <p style={{ fontSize: '0.875rem', color: 'var(--text-faint)' }}>No payment records in the last 6 months.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  {recentLedger.map(entry => {
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
          ) : (
            <section>
              {balanceDays.length === 0 ? (
                <p style={{ fontSize: '0.875rem', color: 'var(--text-faint)' }}>No activity in the last 6 months.</p>
              ) : (
                <>
                  {/* Column headers */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 110px', gap: '0.5rem', padding: '0 0.875rem', marginBottom: '0.375rem' }}>
                    <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date</span>
                    <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--text-faint)', textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Change</span>
                    <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--text-faint)', textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Balance</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    {balanceDays.map(row => (
                      <div
                        key={row.date}
                        style={{ display: 'grid', gridTemplateColumns: '1fr 100px 110px', gap: '0.5rem', padding: '0.5rem 0.875rem', borderRadius: 8, background: 'var(--bg-subtle)' }}
                      >
                        <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{fmtShort(row.date)}</span>
                        <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: row.delta >= 0 ? 'var(--green)' : 'var(--red)', textAlign: 'right' }}>
                          {row.delta >= 0 ? '+' : ''}{fmt$(row.delta)}
                        </span>
                        <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: row.balance >= 0 ? 'var(--text-primary)' : 'var(--red)', textAlign: 'right' }}>
                          {fmt$(row.balance)}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
