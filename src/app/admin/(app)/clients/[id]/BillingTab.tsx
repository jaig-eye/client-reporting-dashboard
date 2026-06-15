'use client'

import { useState, useEffect, useCallback } from 'react'

interface Invoice {
  id:          string
  number:      string | null
  date:        number
  amount:      number
  status:      string | null
  description: string | null
  hosted_url:  string | null
}

interface LedgerEntry {
  id:              string
  date_of_payment: string | null
  invoice_date:    string | null
  amount_af:       number
  type:            string | null
  note:            string | null
  ach_status:      string | null
  invoice_id:      string | null
  created_at:      string
}

function fmt$(n: number): string {
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtShort(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function StatusBadge({ status }: { status: string | null }) {
  const s = status ?? ''
  const style = s === 'paid' ? { bg: '#dcfce7', color: '#166534' }
    : s === 'open'   ? { bg: '#dbeafe', color: '#1e40af' }
    : s === 'void'   ? { bg: '#f3f4f6', color: '#6b7280' }
    : { bg: '#fef3c7', color: '#92400e' }
  return (
    <span style={{ padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700, background: style.bg, color: style.color }}>
      {s || 'unknown'}
    </span>
  )
}

export default function BillingTab({ clientId, adFuelCut, globalCut }: { clientId: string; adFuelCut: number | null; globalCut: number }) {
  const [loading,  setLoading]  = useState(true)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [ledger,   setLedger]   = useState<LedgerEntry[]>([])
  const [error,    setError]    = useState('')

  // Ad Fuel cut editing (moved from old client General tab)
  const [cutValue,  setCutValue]  = useState(adFuelCut != null ? String((adFuelCut * 100).toFixed(1)) : '')
  const [cutSaving, setCutSaving] = useState(false)
  const [cutMsg,    setCutMsg]    = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/billing`)
      if (!res.ok) throw new Error('Failed to load billing data')
      const data = await res.json()
      setInvoices(data.invoices ?? [])
      setLedger(data.ledger ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error loading billing data')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  async function saveCut() {
    setCutSaving(true)
    setCutMsg('')
    const parsed = cutValue === '' ? null : parseFloat(cutValue) / 100
    try {
      const res = await fetch(`/api/admin/clients/${clientId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ad_fuel_cut: parsed }),
      })
      if (!res.ok) throw new Error('Save failed')
      setCutMsg('Saved')
      setTimeout(() => setCutMsg(''), 2000)
    } catch {
      setCutMsg('Error saving')
    } finally {
      setCutSaving(false)
    }
  }

  if (loading) {
    return <p style={{ color: 'var(--text-faint)', fontSize: '0.875rem' }}>Loading billing data…</p>
  }

  if (error) {
    return <p style={{ color: 'var(--red)', fontSize: '0.875rem' }}>{error}</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: 900 }}>

      {/* Ad Fuel Cut config */}
      <div className="card p-5">
        <h2 className="section-title mb-1">Ad Fuel Cut</h2>
        <p className="section-desc mb-3">Per-client margin override. Ad Fuel Spend = raw spend ÷ (1 − cut). Global default: {(globalCut * 100).toFixed(1)}%.</p>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <input
              type="number" min="0" max="99" step="0.1"
              value={cutValue}
              onChange={e => setCutValue(e.target.value)}
              placeholder={`${(globalCut * 100).toFixed(1)} (global)`}
              className="input"
              style={{ width: 110 }}
            />
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>%</span>
          </div>
          <button onClick={saveCut} disabled={cutSaving} className="btn btn-primary" style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem' }}>
            {cutSaving ? 'Saving…' : 'Save'}
          </button>
          {cutValue !== '' && (
            <button
              onClick={() => { setCutValue(''); saveCut() }}
              className="btn btn-secondary"
              style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem' }}
            >
              Reset to global
            </button>
          )}
          {cutMsg && <span style={{ fontSize: '0.75rem', color: cutMsg === 'Saved' ? 'var(--green)' : 'var(--red)' }}>{cutMsg}</span>}
        </div>
      </div>

      {/* Stripe invoices */}
      <div className="card p-5">
        <h2 className="section-title mb-3">Stripe Invoice History</h2>
        {invoices.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
            No Stripe invoices found. Set a Stripe Customer ID in Integrations to link billing.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Date</th>
                  <th className="text-left">Invoice #</th>
                  <th className="text-left">Description</th>
                  <th className="text-right">Amount</th>
                  <th className="text-center">Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id}>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{fmtDate(inv.date)}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{inv.number ?? '—'}</td>
                    <td style={{ color: 'var(--text-primary)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {inv.description ?? '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt$(inv.amount)}</td>
                    <td style={{ textAlign: 'center' }}><StatusBadge status={inv.status} /></td>
                    <td>
                      {inv.hosted_url && (
                        <a href={inv.hosted_url} target="_blank" rel="noopener noreferrer"
                           className="text-xs" style={{ color: 'var(--blue)' }}>View →</a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Ad Fuel ledger */}
      <div className="card p-5">
        <h2 className="section-title mb-3">Ad Fuel Ledger</h2>
        {ledger.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-faint)' }}>No ledger entries yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Date</th>
                  <th className="text-left">Type</th>
                  <th className="text-left">Note</th>
                  <th className="text-right">Amount</th>
                  <th className="text-center">ACH</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map(entry => {
                  const isPending = entry.ach_status === 'pending'
                  return (
                    <tr key={entry.id} style={{ opacity: isPending ? 0.5 : 1 }}>
                      <td style={{ whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                        {fmtShort(entry.date_of_payment ?? entry.invoice_date ?? entry.created_at.slice(0, 10))}
                      </td>
                      <td>
                        {entry.type && (
                          <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700, background: 'var(--bg-subtle)', color: 'var(--text-muted)' }}>
                            {entry.type}
                          </span>
                        )}
                      </td>
                      <td style={{ color: 'var(--text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entry.note ?? '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: entry.amount_af >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {entry.amount_af >= 0 ? '+' : ''}{fmt$(entry.amount_af)}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {isPending ? (
                          <span style={{ fontSize: '0.65rem', color: '#d97706', fontWeight: 600 }}>Pending</span>
                        ) : entry.ach_status ? (
                          <span style={{ fontSize: '0.65rem', color: 'var(--green)', fontWeight: 600 }}>Cleared</span>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
