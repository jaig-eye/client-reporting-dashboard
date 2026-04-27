'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DashRow {
  clientId:          string
  clientName:        string
  googleAccountId:   string | null
  facebookAccountId: string | null
  crmId:             string | null
  discordChannelId:  string | null
  billDay:           number | null
  monthlyBudget:     number | null
  adFuelCut:         number
  afBalance:         number
  rawBalance:        number
  afPurchased:       number
  afSpend:           number
  rawPurchased:      number
  rawSpend:          number
  googleRaw:         number
  facebookRaw:       number
  afSinceBill:       number | null
  avgDailyAf:        number | null
  pace:              string
}

interface LedgerEntry {
  id:              string
  client_id:       string
  date_of_payment: string
  amount_af:       number
  split_override:  number | null
  invoice_id:      string | null
  type:            string | null
  note:            string | null
  created_by:      string | null
  created_at:      string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '—'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—'
  return (Number(n) * 100).toFixed(1) + '%'
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function billMonthStart(billDay: number): string {
  const now = new Date()
  const d   = now.getDate()
  if (d >= billDay) {
    return new Date(now.getFullYear(), now.getMonth(), billDay).toISOString().slice(0, 10)
  }
  return new Date(now.getFullYear(), now.getMonth() - 1, billDay).toISOString().slice(0, 10)
}

const PACE_STYLE: Record<string, { bg: string; color: string }> = {
  'On Pace':      { bg: '#dcfce7', color: '#166534' },
  'Underspending':{ bg: '#fef3c7', color: '#92400e' },
  'Overspending': { bg: '#fee2e2', color: '#991b1b' },
}

const ENTRY_TYPES = ['MRR', 'Catch Up', 'Other']

// ─── Main Component ────────────────────────────────────────────────────────────

export default function AdFuelPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()

  const [tab, setTab] = useState<'dashboard' | 'ledger'>('dashboard')

  // Dashboard state — seed from URL params if present
  const [dateFrom, setDateFrom] = useState(() => {
    const p = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('date_from') : null
    if (p) return p
    const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10)
  })
  const [dateTo, setDateTo] = useState(() => {
    const p = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('date_to') : null
    return p ?? today()
  })
  const [rows,     setRows]     = useState<DashRow[]>([])
  const [loading,  setLoading]  = useState(false)
  const [editCell, setEditCell] = useState<{ clientId: string; field: 'billDay' | 'monthlyBudget'; value: string } | null>(null)
  const [saving,   setSaving]   = useState(false)

  // Ledger state
  const [ledger,        setLedger]        = useState<LedgerEntry[]>([])
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [filterClient,  setFilterClient]  = useState('')
  const [showAddModal,  setShowAddModal]  = useState(false)
  const [importStatus,  setImportStatus]  = useState<{ inserted: number; skipped: number; errors: string[] } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Add entry form
  const emptyForm = { client_id: '', date_of_payment: today(), amount_af: '', split_override: '', invoice_id: '', type: 'MRR', note: '', created_by: '' }
  const [addForm, setAddForm] = useState(emptyForm)
  const [addError, setAddError] = useState('')

  // Keep URL in sync with current date range
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('date_from', dateFrom)
    params.set('date_to', dateTo)
    router.replace(`?${params.toString()}`, { scroll: false })
  }, [dateFrom, dateTo]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchDashboard = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/ad-fuel?date_from=${dateFrom}&date_to=${dateTo}`)
      if (res.ok) setRows(await res.json())
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  const fetchLedger = useCallback(async () => {
    setLedgerLoading(true)
    try {
      const url = filterClient ? `/api/admin/ad-fuel/ledger?client_id=${filterClient}` : '/api/admin/ad-fuel/ledger'
      const res = await fetch(url)
      if (res.ok) setLedger(await res.json())
    } finally {
      setLedgerLoading(false)
    }
  }, [filterClient])

  useEffect(() => { fetchDashboard() }, [fetchDashboard])
  useEffect(() => { if (tab === 'ledger') fetchLedger() }, [tab, fetchLedger])

  // ── Inline-edit save ────────────────────────────────────────────────────────
  async function saveCell() {
    if (!editCell) return
    setSaving(true)
    const body: Record<string, unknown> = {}
    if (editCell.field === 'billDay')       body.bill_day        = editCell.value === '' ? null : parseInt(editCell.value)
    if (editCell.field === 'monthlyBudget') body.monthly_budget  = editCell.value === '' ? null : parseFloat(editCell.value)
    await fetch(`/api/admin/clients/${editCell.clientId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    setSaving(false)
    setEditCell(null)
    fetchDashboard()
  }

  // ── Add ledger entry ────────────────────────────────────────────────────────
  async function submitAdd() {
    if (!addForm.client_id || !addForm.amount_af) { setAddError('Client and Amount are required'); return }
    setAddError('')
    const res = await fetch('/api/admin/ad-fuel/ledger', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:       addForm.client_id,
        date_of_payment: addForm.date_of_payment,
        amount_af:       parseFloat(addForm.amount_af),
        split_override:  addForm.split_override ? parseFloat(addForm.split_override) / 100 : null,
        invoice_id:      addForm.invoice_id || null,
        type:            addForm.type || null,
        note:            addForm.note || null,
        created_by:      addForm.created_by || null,
      }),
    })
    if (!res.ok) { setAddError((await res.json()).error || 'Failed'); return }
    setShowAddModal(false)
    setAddForm(emptyForm)
    fetchLedger()
    fetchDashboard()
  }

  // ── Delete ledger entry ─────────────────────────────────────────────────────
  async function deleteEntry(id: string) {
    if (!confirm('Delete this ledger entry?')) return
    await fetch(`/api/admin/ad-fuel/ledger/${id}`, { method: 'DELETE' })
    fetchLedger()
    fetchDashboard()
  }

  // ── CSV import ──────────────────────────────────────────────────────────────
  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const form = new FormData(); form.append('file', file)
    const res = await fetch('/api/admin/ad-fuel/import', { method: 'POST', body: form })
    const result = await res.json()
    setImportStatus(result)
    fetchLedger()
    fetchDashboard()
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── CSV export ──────────────────────────────────────────────────────────────
  function exportCSV() {
    const headers = ['Client','G Acct','FB Acct','CRM ID','AF Balance','Raw Balance','AF Purchased','AF Spend','Raw Purchased','Raw Spend','G Raw','FB Raw','Bill Day','Budget','AF Since Bill','Avg Daily AF','Pace']
    const csvRows = rows.map(r => [
      r.clientName, r.googleAccountId ?? '', r.facebookAccountId ?? '', r.crmId ?? '',
      r.afBalance.toFixed(2), r.rawBalance.toFixed(2), r.afPurchased.toFixed(2), r.afSpend.toFixed(2),
      r.rawPurchased.toFixed(2), r.rawSpend.toFixed(2), r.googleRaw.toFixed(2), r.facebookRaw.toFixed(2),
      r.billDay ?? '', r.monthlyBudget ?? '', r.afSinceBill?.toFixed(2) ?? '', r.avgDailyAf?.toFixed(2) ?? '', r.pace,
    ])
    const csv = [headers, ...csvRows].map(r => r.join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `ad-fuel-${dateFrom}-${dateTo}.csv`; a.click()
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '1.5rem 2rem', maxWidth: 1600 }}>
      <div className="page-header" style={{ marginBottom: '1.25rem' }}>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>Ad Fuel</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)', marginTop: 2 }}>
          Track ad spend, purchased fuel, billing cycles, and pace for all clients.
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.625rem' }}>
        {(['dashboard', 'ledger'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '0.35rem 1rem', borderRadius: 6, border: 'none', cursor: 'pointer',
              fontWeight: tab === t ? 600 : 400, fontSize: '0.875rem',
              background: tab === t ? 'var(--blue)' : 'var(--bg-subtle)',
              color: tab === t ? '#fff' : 'var(--text-muted)',
            }}
          >
            {t === 'dashboard' ? 'Dashboard' : 'Ledger'}
          </button>
        ))}
      </div>

      {/* ── DASHBOARD TAB ────────────────────────────────────────────────────── */}
      {tab === 'dashboard' && (
        <>
          {/* Date controls */}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-faint)', marginBottom: 3 }}>From</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input" style={{ fontSize: '0.8125rem', padding: '0.3rem 0.6rem' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-faint)', marginBottom: 3 }}>To</label>
              <input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   className="input" style={{ fontSize: '0.8125rem', padding: '0.3rem 0.6rem' }} />
            </div>
            <button onClick={fetchDashboard} className="btn btn-primary" style={{ fontSize: '0.8125rem', padding: '0.35rem 1rem' }}>Refresh</button>
            <button onClick={exportCSV} className="btn btn-secondary" style={{ fontSize: '0.8125rem', padding: '0.35rem 1rem', marginLeft: 'auto' }}>Export CSV</button>
          </div>

          {loading ? (
            <p style={{ color: 'var(--text-faint)', fontSize: '0.875rem' }}>Loading…</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ minWidth: 1400, fontSize: '0.8rem' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Client</th>
                    <th>G Acct</th>
                    <th>FB Acct</th>
                    <th>CRM ID</th>
                    <th title="AF Balance = AF Purchased − AF Spend">AF Balance</th>
                    <th title="Raw Balance = Raw Purchased − Raw Spend">Raw Balance</th>
                    <th>AF Purch.</th>
                    <th>AF Spend</th>
                    <th>Raw Purch.</th>
                    <th>Raw Spend</th>
                    <th>G Raw</th>
                    <th>FB Raw</th>
                    <th title="Click to edit">Bill Day</th>
                    <th title="Click to edit">Budget</th>
                    <th>AF Since Bill</th>
                    <th>Avg Daily</th>
                    <th>Pace</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.clientId}>
                      <td style={{ fontWeight: 600, whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>{row.clientName}</td>
                      <td style={{ color: 'var(--text-faint)', fontSize: '0.7rem' }}>{row.googleAccountId ?? '—'}</td>
                      <td style={{ color: 'var(--text-faint)', fontSize: '0.7rem' }}>{row.facebookAccountId ?? '—'}</td>
                      <td style={{ color: 'var(--text-faint)', fontSize: '0.7rem' }}>{row.crmId ?? '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: row.afBalance >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt$(row.afBalance)}</td>
                      <td style={{ textAlign: 'right', color: row.rawBalance >= 0 ? 'var(--text-muted)' : 'var(--red)' }}>{fmt$(row.rawBalance)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt$(row.afPurchased)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt$(row.afSpend)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt$(row.rawPurchased)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt$(row.rawSpend)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmt$(row.googleRaw)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmt$(row.facebookRaw)}</td>

                      {/* Bill Day — inline editable */}
                      <td style={{ textAlign: 'center' }}>
                        {editCell?.clientId === row.clientId && editCell.field === 'billDay' ? (
                          <span style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                            <input
                              type="number" min={1} max={31} value={editCell.value}
                              onChange={e => setEditCell(c => c ? { ...c, value: e.target.value } : null)}
                              className="input" style={{ width: 50, padding: '0.15rem 0.4rem', fontSize: '0.75rem' }}
                              onKeyDown={e => { if (e.key === 'Enter') saveCell(); if (e.key === 'Escape') setEditCell(null) }}
                              autoFocus
                            />
                            <button onClick={saveCell} disabled={saving} className="btn btn-primary" style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem' }}>✓</button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setEditCell({ clientId: row.clientId, field: 'billDay', value: String(row.billDay ?? '') })}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: row.billDay ? 'var(--text-primary)' : 'var(--text-faint)', fontSize: '0.8rem' }}
                          >
                            {row.billDay ?? <span style={{ opacity: 0.4 }}>—</span>}
                          </button>
                        )}
                      </td>

                      {/* Budget — inline editable */}
                      <td style={{ textAlign: 'right' }}>
                        {editCell?.clientId === row.clientId && editCell.field === 'monthlyBudget' ? (
                          <span style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                            <input
                              type="number" min={0} value={editCell.value}
                              onChange={e => setEditCell(c => c ? { ...c, value: e.target.value } : null)}
                              className="input" style={{ width: 80, padding: '0.15rem 0.4rem', fontSize: '0.75rem' }}
                              onKeyDown={e => { if (e.key === 'Enter') saveCell(); if (e.key === 'Escape') setEditCell(null) }}
                              autoFocus
                            />
                            <button onClick={saveCell} disabled={saving} className="btn btn-primary" style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem' }}>✓</button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setEditCell({ clientId: row.clientId, field: 'monthlyBudget', value: String(row.monthlyBudget ?? '') })}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: row.monthlyBudget ? 'var(--text-primary)' : 'var(--text-faint)', fontSize: '0.8rem', textAlign: 'right', width: '100%' }}
                          >
                            {row.monthlyBudget ? fmt$(row.monthlyBudget, 0) : <span style={{ opacity: 0.4 }}>—</span>}
                          </button>
                        )}
                      </td>

                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt$(row.afSinceBill)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmt$(row.avgDailyAf)}</td>
                      <td>
                        {row.pace ? (
                          <span style={{
                            display: 'inline-block', padding: '2px 7px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700,
                            ...(PACE_STYLE[row.pace] ?? { bg: '#f3f4f6', color: '#374151' }),
                            background: (PACE_STYLE[row.pace] ?? { bg: '#f3f4f6' }).bg,
                          }}>
                            {row.pace}
                          </span>
                        ) : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: '0.5rem' }}>
            Click Bill Day or Budget cells to edit inline. AF Balance = AF Purchased − AF Spend. Split = {((1 - (rows[0]?.adFuelCut ?? 0.2)) * 100).toFixed(0)}% media (agency cut: {((rows[0]?.adFuelCut ?? 0.2) * 100).toFixed(0)}%).
          </p>
        </>
      )}

      {/* ── LEDGER TAB ───────────────────────────────────────────────────────── */}
      {tab === 'ledger' && (
        <>
          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <button onClick={() => { setShowAddModal(true); setAddError('') }} className="btn btn-primary" style={{ fontSize: '0.8125rem' }}>
              + Add Entry
            </button>
            <button onClick={() => fileInputRef.current?.click()} className="btn btn-secondary" style={{ fontSize: '0.8125rem' }}>
              Import CSV
            </button>
            <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleImport} />

            <select
              value={filterClient}
              onChange={e => setFilterClient(e.target.value)}
              className="input"
              style={{ fontSize: '0.8125rem', padding: '0.3rem 0.6rem', minWidth: 180 }}
            >
              <option value="">All clients</option>
              {rows.map(r => <option key={r.clientId} value={r.clientId}>{r.clientName}</option>)}
            </select>

            {importStatus && (
              <div style={{
                padding: '0.4rem 0.75rem', borderRadius: 6, fontSize: '0.75rem',
                background: importStatus.errors.length ? '#fee2e2' : '#dcfce7',
                color: importStatus.errors.length ? '#991b1b' : '#166534',
              }}>
                Imported {importStatus.inserted} entries{importStatus.skipped > 0 ? `, skipped ${importStatus.skipped}` : ''}.
                {importStatus.errors.length > 0 && ` ${importStatus.errors.length} error(s).`}
                <button onClick={() => setImportStatus(null)} style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.7rem' }}>✕</button>
              </div>
            )}
          </div>

          {/* Ledger table */}
          {ledgerLoading ? (
            <p style={{ color: 'var(--text-faint)', fontSize: '0.875rem' }}>Loading…</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ minWidth: 900 }}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th style={{ textAlign: 'left' }}>Client</th>
                    <th>Amount (AF)</th>
                    <th>Split Override</th>
                    <th>Invoice ID</th>
                    <th>Type</th>
                    <th style={{ textAlign: 'left' }}>Notes</th>
                    <th>Added By</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.length === 0 && (
                    <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-faint)', padding: '2rem' }}>No ledger entries yet.</td></tr>
                  )}
                  {ledger.map(e => {
                    const client = rows.find(r => r.clientId === e.client_id)
                    return (
                      <tr key={e.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{e.date_of_payment}</td>
                        <td style={{ fontWeight: 600 }}>{client?.clientName ?? e.client_id.slice(0, 8)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--green)' }}>{fmt$(e.amount_af)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                          {e.split_override != null ? fmtPct(e.split_override) : '—'}
                        </td>
                        <td style={{ color: 'var(--text-muted)' }}>{e.invoice_id ?? '—'}</td>
                        <td>
                          {e.type && (
                            <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700, background: '#dbeafe', color: '#1e40af' }}>
                              {e.type}
                            </span>
                          )}
                        </td>
                        <td style={{ color: 'var(--text-muted)', maxWidth: 200 }}>
                          <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.note ?? '—'}</span>
                        </td>
                        <td style={{ color: 'var(--text-faint)', fontSize: '0.75rem' }}>{e.created_by ?? '—'}</td>
                        <td>
                          <button
                            onClick={() => deleteEntry(e.id)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: '0.875rem', padding: '0.15rem 0.4rem' }}
                            title="Delete entry"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── ADD ENTRY MODAL ───────────────────────────────────────────────────── */}
      {showAddModal && (
        <div
          onClick={() => setShowAddModal(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bg-surface)', borderRadius: 12, width: '100%', maxWidth: 500, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}
          >
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Add Ledger Entry</h2>
              <button onClick={() => setShowAddModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem', color: 'var(--text-faint)' }}>×</button>
            </div>

            <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              {/* Client */}
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Client *</label>
                <select value={addForm.client_id} onChange={e => setAddForm(f => ({ ...f, client_id: e.target.value }))} className="input" style={{ width: '100%' }}>
                  <option value="">Select a client…</option>
                  {rows.map(r => <option key={r.clientId} value={r.clientId}>{r.clientName}</option>)}
                </select>
              </div>

              {/* Date + Amount side by side */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Date of Payment *</label>
                  <input type="date" value={addForm.date_of_payment} onChange={e => setAddForm(f => ({ ...f, date_of_payment: e.target.value }))} className="input" style={{ width: '100%' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Ad Fuel Amount ($) *</label>
                  <input type="number" placeholder="0.00" value={addForm.amount_af} onChange={e => setAddForm(f => ({ ...f, amount_af: e.target.value }))} className="input" style={{ width: '100%' }} />
                </div>
              </div>

              {/* Type + Split side by side */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Type</label>
                  <select value={addForm.type} onChange={e => setAddForm(f => ({ ...f, type: e.target.value }))} className="input" style={{ width: '100%' }}>
                    {ENTRY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Split % Override <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>(optional)</span></label>
                  <input type="number" placeholder="client default" min={0} max={100} value={addForm.split_override} onChange={e => setAddForm(f => ({ ...f, split_override: e.target.value }))} className="input" style={{ width: '100%' }} />
                </div>
              </div>

              {/* Invoice ID */}
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Invoice ID <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>(optional)</span></label>
                <input type="text" placeholder="INV-001" value={addForm.invoice_id} onChange={e => setAddForm(f => ({ ...f, invoice_id: e.target.value }))} className="input" style={{ width: '100%' }} />
              </div>

              {/* Notes */}
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Notes <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>(optional)</span></label>
                <input type="text" placeholder="e.g. 2025 Catchup Ad Fuel Submission" value={addForm.note} onChange={e => setAddForm(f => ({ ...f, note: e.target.value }))} className="input" style={{ width: '100%' }} />
              </div>

              {/* Added by */}
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Added By</label>
                <input type="text" placeholder="Your name" value={addForm.created_by} onChange={e => setAddForm(f => ({ ...f, created_by: e.target.value }))} className="input" style={{ width: '100%' }} />
              </div>

              {addError && <p style={{ color: 'var(--red)', fontSize: '0.8rem', margin: 0 }}>{addError}</p>}
            </div>

            <div style={{ padding: '0.875rem 1.25rem', borderTop: '1px solid var(--border)', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowAddModal(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={submitAdd} className="btn btn-primary">Add Entry</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
