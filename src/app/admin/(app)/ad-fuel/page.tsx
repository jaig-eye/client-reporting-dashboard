'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DashRow {
  clientId:            string
  clientName:          string
  googleAccountId:     string | null
  facebookAccountId:   string | null
  crmId:               string | null
  discordChannelId:    string | null
  billDay:             number | null
  historicBillDay:     number | null
  monthlyBudget:       number | null
  adFuelCut:           number
  afBalance:           number
  rawBalance:          number
  lifetimeRawBalance:  number
  afPurchased:         number
  afSpend:             number
  rawPurchased:        number
  rawSpend:            number
  googleRaw:           number
  facebookRaw:         number
  afSinceBill:         number | null
  avgDailyAf:          number | null
  pace:                string
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

interface ColConfig {
  key:     string
  label:   string
  visible: boolean
}

// ─── Column definitions ───────────────────────────────────────────────────────

const DEFAULT_COLS: ColConfig[] = [
  { key: 'client',       label: 'Client',              visible: true  },
  { key: 'googleAcct',   label: 'G Acct',              visible: false },
  { key: 'fbAcct',       label: 'FB Acct',             visible: false },
  { key: 'crmId',        label: 'CRM ID',              visible: false },
  { key: 'afBalance',         label: 'Ad Fuel Balance',     visible: true  },
  { key: 'rawBalance',        label: 'Raw Balance',         visible: true  },
  { key: 'lifetimeRawBalance', label: 'Lifetime Raw Bal',   visible: false },
  { key: 'afPurchased',       label: 'Ad Fuel Purchased',   visible: true  },
  { key: 'afSpend',      label: 'Ad Fuel Spend',       visible: true  },
  { key: 'rawPurchased', label: 'Raw Purchased',       visible: false },
  { key: 'rawSpend',     label: 'Raw Spend',           visible: false },
  { key: 'googleRaw',    label: 'Google Raw',          visible: true  },
  { key: 'fbRaw',        label: 'Facebook Raw',        visible: true  },
  { key: 'billDay',      label: 'Bill Day',            visible: true  },
  { key: 'budget',       label: 'Budget',              visible: true  },
  { key: 'afSinceBill',  label: 'Ad Fuel Since Bill',  visible: true  },
  { key: 'avgDaily',     label: 'Avg Daily',           visible: true  },
  { key: 'pace',         label: 'Pace',                visible: true  },
]

const LS_KEY = 'adfuel_col_config'

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

const PACE_STYLE: Record<string, { bg: string; color: string }> = {
  'On Pace':       { bg: '#dcfce7', color: '#166534' },
  'Underspending': { bg: '#fef3c7', color: '#92400e' },
  'Overspending':  { bg: '#fee2e2', color: '#991b1b' },
}

const ENTRY_TYPES = ['MRR', 'Catch Up', 'Other']

function loadCols(): ColConfig[] {
  if (typeof window === 'undefined') return DEFAULT_COLS
  try {
    const stored = localStorage.getItem(LS_KEY)
    if (!stored) return DEFAULT_COLS
    const parsed: ColConfig[] = JSON.parse(stored)
    // Merge: keep user labels/visibility, add any new keys from DEFAULT_COLS
    const map = new Map(parsed.map(c => [c.key, c]))
    return DEFAULT_COLS.map(d => map.get(d.key) ?? d)
  } catch { return DEFAULT_COLS }
}

// ─── Cell renderer ────────────────────────────────────────────────────────────

function renderCell(key: string, row: DashRow): React.ReactNode {
  switch (key) {
    case 'client':       return <td key={key} style={{ fontWeight: 600, whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>{row.clientName}</td>
    case 'googleAcct':   return <td key={key} style={{ color: 'var(--text-faint)', fontSize: '0.7rem' }}>{row.googleAccountId ?? '—'}</td>
    case 'fbAcct':       return <td key={key} style={{ color: 'var(--text-faint)', fontSize: '0.7rem' }}>{row.facebookAccountId ?? '—'}</td>
    case 'crmId':        return <td key={key} style={{ color: 'var(--text-faint)', fontSize: '0.7rem' }}>{row.crmId ?? '—'}</td>
    case 'afBalance':         return <td key={key} style={{ textAlign: 'right', fontWeight: 600, color: row.afBalance >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt$(row.afBalance)}</td>
    case 'rawBalance':        return <td key={key} style={{ textAlign: 'right', color: row.rawBalance >= 0 ? 'var(--text-muted)' : 'var(--red)' }}>{fmt$(row.rawBalance)}</td>
    case 'lifetimeRawBalance': return <td key={key} style={{ textAlign: 'right', color: row.lifetimeRawBalance >= 0 ? 'var(--text-muted)' : 'var(--red)' }}>{fmt$(row.lifetimeRawBalance)}</td>
    case 'afPurchased':       return <td key={key} style={{ textAlign: 'right' }}>{fmt$(row.afPurchased)}</td>
    case 'afSpend':      return <td key={key} style={{ textAlign: 'right' }}>{fmt$(row.afSpend)}</td>
    case 'rawPurchased': return <td key={key} style={{ textAlign: 'right' }}>{fmt$(row.rawPurchased)}</td>
    case 'rawSpend':     return <td key={key} style={{ textAlign: 'right' }}>{fmt$(row.rawSpend)}</td>
    case 'googleRaw':    return <td key={key} style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmt$(row.googleRaw)}</td>
    case 'fbRaw':        return <td key={key} style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmt$(row.facebookRaw)}</td>
    case 'billDay':      return <td key={key} style={{ textAlign: 'center', color: row.billDay ? 'var(--text-primary)' : 'var(--text-faint)' }}>{row.billDay ?? '—'}</td>
    case 'budget':       return <td key={key} style={{ textAlign: 'right', color: row.monthlyBudget ? 'var(--text-primary)' : 'var(--text-faint)' }}>{row.monthlyBudget ? fmt$(row.monthlyBudget, 0) : '—'}</td>
    case 'afSinceBill':  return <td key={key} style={{ textAlign: 'right', fontWeight: 600 }}>{fmt$(row.afSinceBill)}</td>
    case 'avgDaily':     return <td key={key} style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmt$(row.avgDailyAf)}</td>
    case 'pace': return (
      <td key={key}>
        {row.pace ? (
          <span style={{
            display: 'inline-block', padding: '2px 7px', borderRadius: 999,
            fontSize: '0.65rem', fontWeight: 700,
            background: (PACE_STYLE[row.pace] ?? { bg: '#f3f4f6' }).bg,
            color: (PACE_STYLE[row.pace] ?? { color: '#374151' }).color,
          }}>
            {row.pace}
          </span>
        ) : <span style={{ color: 'var(--text-faint)' }}>—</span>}
      </td>
    )
    default: return <td key={key} />
  }
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function AdFuelPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()

  const [tab, setTab] = useState<'dashboard' | 'ledger' | 'settings'>('dashboard')

  // Dashboard state — seed from URL params if present
  const [dateFilterEnabled, setDateFilterEnabled] = useState(() => {
    if (typeof window === 'undefined') return false
    const p = new URLSearchParams(window.location.search)
    return p.has('date_from') && p.has('date_to')
  })
  const [dateFrom, setDateFrom] = useState(() => {
    const p = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('date_from') : null
    if (p) return p
    const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10)
  })
  const [dateTo, setDateTo] = useState(() => {
    const p = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('date_to') : null
    return p ?? today()
  })
  const [rows,       setRows]       = useState<DashRow[]>([])
  const [cutoffDate, setCutoffDate] = useState('2025-01-01')
  const [loading,    setLoading]    = useState(false)

  // Column config (persisted to localStorage)
  const [cols, setCols] = useState<ColConfig[]>(DEFAULT_COLS)
  useEffect(() => { setCols(loadCols()) }, [])
  function saveCols(next: ColConfig[]) {
    setCols(next)
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)) } catch {}
  }

  // Client edit modal (bill day + budget)
  const [clientEditModal, setClientEditModal] = useState<DashRow | null>(null)
  const [clientEditForm,  setClientEditForm]  = useState({ billDay: '', historicBillDay: '', monthlyBudget: '' })
  const [clientEditSaving, setClientEditSaving] = useState(false)
  const [clientEditError,  setClientEditError]  = useState('')

  function openClientEdit(row: DashRow) {
    setClientEditModal(row)
    setClientEditForm({
      billDay:         String(row.billDay ?? ''),
      historicBillDay: String(row.historicBillDay ?? ''),
      monthlyBudget:   String(row.monthlyBudget ?? ''),
    })
    setClientEditError('')
  }

  async function saveClientEdit() {
    if (!clientEditModal) return
    setClientEditSaving(true)
    setClientEditError('')
    const body: Record<string, unknown> = {
      bill_day:          clientEditForm.billDay         === '' ? null : parseInt(clientEditForm.billDay),
      historic_bill_day: clientEditForm.historicBillDay === '' ? null : parseInt(clientEditForm.historicBillDay),
      monthly_budget:    clientEditForm.monthlyBudget   === '' ? null : parseFloat(clientEditForm.monthlyBudget),
    }
    const res = await fetch(`/api/admin/clients/${clientEditModal.clientId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    setClientEditSaving(false)
    if (!res.ok) { setClientEditError((await res.json()).error || 'Save failed'); return }
    setClientEditModal(null)
    fetchDashboard()
  }

  // Ledger state
  const [ledger,        setLedger]        = useState<LedgerEntry[]>([])
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [filterClient,  setFilterClient]  = useState('')
  const [showAddModal,  setShowAddModal]  = useState(false)
  const [importStatus,  setImportStatus]  = useState<{ inserted: number; skipped: number; errors: string[] } | null>(null)
  const [importErrorsExpanded, setImportErrorsExpanded] = useState(false)
  const [selectedIds,   setSelectedIds]   = useState<Set<string>>(new Set())
  const [bulkDeleting,  setBulkDeleting]  = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Add entry form
  const emptyForm = { client_id: '', date_of_payment: today(), amount_af: '', split_override: '', invoice_id: '', type: 'MRR', note: '', created_by: '' }
  const [addForm,  setAddForm]  = useState(emptyForm)
  const [addError, setAddError] = useState('')

  // Settings tab — client selector for manual values
  const [settingsClientId,   setSettingsClientId]   = useState('')
  const [settingsForm,       setSettingsForm]       = useState({ billDay: '', historicBillDay: '', monthlyBudget: '' })
  const [settingsSaving,     setSettingsSaving]     = useState(false)
  const [settingsSaveMsg,    setSettingsSaveMsg]    = useState('')

  // Settings tab — Ad Fuel cutoff date (agency-level)
  const [cutoffInput,   setCutoffInput]   = useState(cutoffDate)
  const [cutoffSaving,  setCutoffSaving]  = useState(false)
  const [cutoffMsg,     setCutoffMsg]     = useState('')

  // Sync URL with current date range (only when filter is enabled)
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    if (dateFilterEnabled) {
      params.set('date_from', dateFrom)
      params.set('date_to', dateTo)
    } else {
      params.delete('date_from')
      params.delete('date_to')
    }
    router.replace(`?${params.toString()}`, { scroll: false })
  }, [dateFrom, dateTo, dateFilterEnabled]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchDashboard = useCallback(async () => {
    setLoading(true)
    try {
      const url = dateFilterEnabled
        ? `/api/admin/ad-fuel?date_from=${dateFrom}&date_to=${dateTo}`
        : '/api/admin/ad-fuel'
      const res = await fetch(url)
      if (res.ok) {
        const json = await res.json()
        setRows(json.rows ?? [])
        if (json.cutoffDate) { setCutoffDate(json.cutoffDate); setCutoffInput(json.cutoffDate) }
      }
    } finally { setLoading(false) }
  }, [dateFrom, dateTo, dateFilterEnabled])

  const fetchLedger = useCallback(async () => {
    setLedgerLoading(true)
    try {
      const url = filterClient ? `/api/admin/ad-fuel/ledger?client_id=${filterClient}` : '/api/admin/ad-fuel/ledger'
      const res = await fetch(url)
      if (res.ok) setLedger(await res.json())
    } finally { setLedgerLoading(false) }
  }, [filterClient])

  useEffect(() => { fetchDashboard() }, [fetchDashboard])
  useEffect(() => { if (tab === 'ledger') fetchLedger() }, [tab, fetchLedger])

  // Populate settings form when a client is selected in settings tab
  useEffect(() => {
    if (!settingsClientId) { setSettingsForm({ billDay: '', historicBillDay: '', monthlyBudget: '' }); return }
    const row = rows.find(r => r.clientId === settingsClientId)
    if (row) setSettingsForm({
      billDay:         String(row.billDay ?? ''),
      historicBillDay: String(row.historicBillDay ?? ''),
      monthlyBudget:   String(row.monthlyBudget ?? ''),
    })
  }, [settingsClientId, rows])

  async function saveSettingsClient() {
    if (!settingsClientId) return
    setSettingsSaving(true)
    setSettingsSaveMsg('')
    const body: Record<string, unknown> = {
      bill_day:          settingsForm.billDay         === '' ? null : parseInt(settingsForm.billDay),
      historic_bill_day: settingsForm.historicBillDay === '' ? null : parseInt(settingsForm.historicBillDay),
      monthly_budget:    settingsForm.monthlyBudget   === '' ? null : parseFloat(settingsForm.monthlyBudget),
    }
    const res = await fetch(`/api/admin/clients/${settingsClientId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    setSettingsSaving(false)
    if (!res.ok) { setSettingsSaveMsg('Save failed'); return }
    setSettingsSaveMsg('Saved!')
    fetchDashboard()
    setTimeout(() => setSettingsSaveMsg(''), 2000)
  }

  async function saveCutoffDate() {
    setCutoffSaving(true)
    setCutoffMsg('')
    const res = await fetch('/api/admin/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ad_fuel_cutoff_date: cutoffInput }),
    })
    setCutoffSaving(false)
    if (!res.ok) { setCutoffMsg('Save failed'); return }
    setCutoffDate(cutoffInput)
    setCutoffMsg('Saved!')
    fetchDashboard()
    setTimeout(() => setCutoffMsg(''), 2000)
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
    setSelectedIds(s => { const n = new Set(s); n.delete(id); return n })
    fetchLedger()
    fetchDashboard()
  }

  // ── Bulk delete ─────────────────────────────────────────────────────────────
  async function bulkDelete() {
    if (selectedIds.size === 0) return
    if (!confirm(`Delete ${selectedIds.size} selected entr${selectedIds.size === 1 ? 'y' : 'ies'}?`)) return
    setBulkDeleting(true)
    await fetch('/api/admin/ad-fuel/ledger', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.from(selectedIds) }),
    })
    setSelectedIds(new Set())
    setBulkDeleting(false)
    fetchLedger()
    fetchDashboard()
  }

  function toggleSelectAll() {
    if (selectedIds.size === ledger.length && ledger.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(ledger.map(e => e.id)))
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds(s => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  // ── CSV import ──────────────────────────────────────────────────────────────
  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const form = new FormData(); form.append('file', file)
    const res  = await fetch('/api/admin/ad-fuel/import', { method: 'POST', body: form })
    setImportStatus(await res.json())
    fetchLedger()
    fetchDashboard()
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── CSV export ──────────────────────────────────────────────────────────────
  function exportCSV() {
    const visibleCols = cols.filter(c => c.visible)
    const headers = visibleCols.map(c => c.label)
    const csvRows = rows.map(row =>
      visibleCols.map(({ key }) => {
        switch (key) {
          case 'client':       return row.clientName
          case 'googleAcct':   return row.googleAccountId ?? ''
          case 'fbAcct':       return row.facebookAccountId ?? ''
          case 'crmId':        return row.crmId ?? ''
          case 'afBalance':         return row.afBalance.toFixed(2)
          case 'rawBalance':        return row.rawBalance.toFixed(2)
          case 'lifetimeRawBalance': return row.lifetimeRawBalance.toFixed(2)
          case 'afPurchased':       return row.afPurchased.toFixed(2)
          case 'afSpend':      return row.afSpend.toFixed(2)
          case 'rawPurchased': return row.rawPurchased.toFixed(2)
          case 'rawSpend':     return row.rawSpend.toFixed(2)
          case 'googleRaw':    return row.googleRaw.toFixed(2)
          case 'fbRaw':        return row.facebookRaw.toFixed(2)
          case 'billDay':      return row.billDay ?? ''
          case 'budget':       return row.monthlyBudget ?? ''
          case 'afSinceBill':  return row.afSinceBill?.toFixed(2) ?? ''
          case 'avgDaily':     return row.avgDailyAf?.toFixed(2) ?? ''
          case 'pace':         return row.pace
          default: return ''
        }
      })
    )
    const csv = [headers, ...csvRows].map(r => r.join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `ad-fuel-${dateFrom}-${dateTo}.csv`
    a.click()
  }

  const visibleCols = cols.filter(c => c.visible)

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '1.5rem 2rem', maxWidth: 1600 }}>
      <div className="page-header" style={{ marginBottom: '1.25rem' }}>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>Ad Fuel</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)', marginTop: 2 }}>
          Lifetime totals from {cutoffDate}. Balance, purchased, and raw spend are all-time figures. Billing cycle columns (Since Bill, Avg Daily, Pace) always reflect the current cycle.
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
        {/* Settings gear tab */}
        <button
          onClick={() => setTab('settings')}
          title="Column & client settings"
          style={{
            padding: '0.35rem 0.65rem', borderRadius: 6, border: 'none', cursor: 'pointer',
            fontSize: '1rem', lineHeight: 1,
            background: tab === 'settings' ? 'var(--blue)' : 'var(--bg-subtle)',
            color: tab === 'settings' ? '#fff' : 'var(--text-muted)',
          }}
        >
          ⚙
        </button>
      </div>

      {/* ── DASHBOARD TAB ────────────────────────────────────────────────────── */}
      {tab === 'dashboard' && (
        <>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1rem' }}>
            {/* Date filter toggle */}
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', userSelect: 'none', paddingBottom: 2 }}>
              <input
                type="checkbox"
                checked={dateFilterEnabled}
                onChange={e => setDateFilterEnabled(e.target.checked)}
              />
              <span style={{ fontSize: '0.8rem', color: dateFilterEnabled ? 'var(--text-primary)' : 'var(--text-faint)', fontWeight: 500 }}>
                Filter by date
              </span>
            </label>

            <div style={{ opacity: dateFilterEnabled ? 1 : 0.4, pointerEvents: dateFilterEnabled ? 'auto' : 'none' }}>
              <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-faint)', marginBottom: 3 }}>From</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input" style={{ fontSize: '0.8125rem', padding: '0.3rem 0.6rem' }} disabled={!dateFilterEnabled} />
            </div>
            <div style={{ opacity: dateFilterEnabled ? 1 : 0.4, pointerEvents: dateFilterEnabled ? 'auto' : 'none' }}>
              <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-faint)', marginBottom: 3 }}>To</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input" style={{ fontSize: '0.8125rem', padding: '0.3rem 0.6rem' }} disabled={!dateFilterEnabled} />
            </div>
            <button onClick={fetchDashboard} className="btn btn-primary" style={{ fontSize: '0.8125rem', padding: '0.35rem 1rem' }}>Refresh</button>

            {!dateFilterEnabled && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)', paddingBottom: 4 }}>
                All-time from {cutoffDate}
              </span>
            )}

            <button onClick={exportCSV} className="btn btn-secondary" style={{ fontSize: '0.8125rem', padding: '0.35rem 1rem', marginLeft: 'auto' }}>Export CSV</button>
          </div>

          {loading ? (
            <p style={{ color: 'var(--text-faint)', fontSize: '0.875rem' }}>Loading…</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ minWidth: 800, fontSize: '0.8rem' }}>
                <thead>
                  <tr>
                    {visibleCols.map(col => (
                      <th key={col.key} style={{ textAlign: col.key === 'client' ? 'left' : undefined }}>
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={visibleCols.length} style={{ textAlign: 'center', color: 'var(--text-faint)', padding: '2rem' }}>No clients found.</td></tr>
                  )}
                  {rows.map(row => (
                    <tr
                      key={row.clientId}
                      onClick={() => openClientEdit(row)}
                      style={{ cursor: 'pointer' }}
                      title="Click to edit bill day, budget, and Ad Fuel cut"
                    >
                      {visibleCols.map(col => renderCell(col.key, row))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: '0.5rem' }}>
            Click any row to edit bill day and budget. Balance and spend are lifetime from {cutoffDate}. Since Bill / Avg Daily / Pace always reflect the current billing cycle.
          </p>
        </>
      )}

      {/* ── LEDGER TAB ───────────────────────────────────────────────────────── */}
      {tab === 'ledger' && (
        <>
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
                padding: '0.5rem 0.75rem', borderRadius: 6, fontSize: '0.75rem',
                background: importStatus.errors.length ? '#fee2e2' : '#dcfce7',
                color: importStatus.errors.length ? '#991b1b' : '#166534',
                maxWidth: 600,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>
                    Imported {importStatus.inserted} entr{importStatus.inserted === 1 ? 'y' : 'ies'}
                    {importStatus.skipped > 0 ? `, skipped ${importStatus.skipped}` : ''}
                    {importStatus.errors.length > 0 && (
                      <>
                        {' — '}
                        <button
                          onClick={() => setImportErrorsExpanded(v => !v)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 700, fontSize: '0.75rem', padding: 0, textDecoration: 'underline' }}
                        >
                          {importStatus.errors.length} error{importStatus.errors.length === 1 ? '' : 's'} {importErrorsExpanded ? '▲' : '▼'}
                        </button>
                      </>
                    )}
                  </span>
                  <button onClick={() => { setImportStatus(null); setImportErrorsExpanded(false) }} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem', color: 'inherit' }}>✕</button>
                </div>
                {importErrorsExpanded && importStatus.errors.length > 0 && (
                  <ul style={{ margin: '0.5rem 0 0', padding: '0 0 0 1.25rem', display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 200, overflowY: 'auto' }}>
                    {importStatus.errors.map((e, i) => <li key={i} style={{ fontSize: '0.7rem' }}>{e}</li>)}
                  </ul>
                )}
              </div>
            )}
          </div>

          {selectedIds.size > 0 && (
            <div style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{selectedIds.size} selected</span>
              <button
                onClick={bulkDelete}
                disabled={bulkDeleting}
                className="btn btn-danger"
                style={{ fontSize: '0.8125rem' }}
              >
                {bulkDeleting ? 'Deleting…' : `Delete ${selectedIds.size}`}
              </button>
              <button onClick={() => setSelectedIds(new Set())} className="btn btn-secondary" style={{ fontSize: '0.8125rem' }}>
                Clear selection
              </button>
            </div>
          )}

          {ledgerLoading ? (
            <p style={{ color: 'var(--text-faint)', fontSize: '0.875rem' }}>Loading…</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ minWidth: 900 }}>
                <thead>
                  <tr>
                    <th style={{ width: 32, textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={ledger.length > 0 && selectedIds.size === ledger.length}
                        ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < ledger.length }}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th>Date</th>
                    <th style={{ textAlign: 'left' }}>Client</th>
                    <th>Amount (Ad Fuel)</th>
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
                    <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-faint)', padding: '2rem' }}>No ledger entries yet.</td></tr>
                  )}
                  {ledger.map(e => {
                    const client  = rows.find(r => r.clientId === e.client_id)
                    const checked = selectedIds.has(e.id)
                    return (
                      <tr key={e.id} style={{ background: checked ? 'var(--bg-subtle)' : undefined }}>
                        <td style={{ textAlign: 'center' }}>
                          <input type="checkbox" checked={checked} onChange={() => toggleSelect(e.id)} />
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>{e.date_of_payment}</td>
                        <td style={{ fontWeight: 600 }}>{client?.clientName ?? e.client_id.slice(0, 8)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: e.amount_af >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt$(e.amount_af)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{e.split_override != null ? fmtPct(e.split_override) : '—'}</td>
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
                          >✕</button>
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

      {/* ── SETTINGS TAB ─────────────────────────────────────────────────────── */}
      {tab === 'settings' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', maxWidth: 900 }}>

          {/* Column visibility + rename */}
          <div className="card" style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700 }}>Column Visibility</h3>
              <button
                onClick={() => saveCols(DEFAULT_COLS)}
                className="btn btn-secondary"
                style={{ fontSize: '0.7rem', padding: '0.2rem 0.6rem' }}
              >
                Reset defaults
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {cols.map((col, i) => (
                <div key={col.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={col.visible}
                    disabled={col.key === 'client'}
                    onChange={e => {
                      const next = cols.map((c, j) => j === i ? { ...c, visible: e.target.checked } : c)
                      saveCols(next)
                    }}
                    style={{ flexShrink: 0 }}
                  />
                  <input
                    type="text"
                    value={col.label}
                    onChange={e => {
                      const next = cols.map((c, j) => j === i ? { ...c, label: e.target.value } : c)
                      saveCols(next)
                    }}
                    className="input"
                    style={{ flex: 1, fontSize: '0.8rem', padding: '0.2rem 0.5rem', opacity: col.visible ? 1 : 0.45 }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Client manual values editor */}
          <div className="card" style={{ padding: '1.25rem' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '0.9375rem', fontWeight: 700 }}>Client Settings</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.875rem', marginTop: 0 }}>
              Set billing cycle and Ad Fuel configuration per client.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Client</label>
                <select
                  value={settingsClientId}
                  onChange={e => setSettingsClientId(e.target.value)}
                  className="input"
                  style={{ width: '100%' }}
                >
                  <option value="">Select a client…</option>
                  {rows.map(r => <option key={r.clientId} value={r.clientId}>{r.clientName}</option>)}
                </select>
              </div>

              {settingsClientId && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Bill Day <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>(1–31)</span></label>
                      <input
                        type="number" min={1} max={31} placeholder="e.g. 1"
                        value={settingsForm.billDay}
                        onChange={e => setSettingsForm(f => ({ ...f, billDay: e.target.value }))}
                        className="input" style={{ width: '100%' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Historic Bill Day <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>(1–31)</span></label>
                      <input
                        type="number" min={1} max={31} placeholder="e.g. 21"
                        value={settingsForm.historicBillDay}
                        onChange={e => setSettingsForm(f => ({ ...f, historicBillDay: e.target.value }))}
                        className="input" style={{ width: '100%' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Monthly Budget ($)</label>
                      <input
                        type="number" min={0} placeholder="e.g. 5000"
                        value={settingsForm.monthlyBudget}
                        onChange={e => setSettingsForm(f => ({ ...f, monthlyBudget: e.target.value }))}
                        className="input" style={{ width: '100%' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <button
                      onClick={saveSettingsClient}
                      disabled={settingsSaving}
                      className="btn btn-primary"
                      style={{ fontSize: '0.8125rem' }}
                    >
                      {settingsSaving ? 'Saving…' : 'Save'}
                    </button>
                    {settingsSaveMsg && (
                      <span style={{ fontSize: '0.8rem', color: settingsSaveMsg === 'Saved!' ? 'var(--green)' : 'var(--red)' }}>
                        {settingsSaveMsg}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Ad Fuel global settings */}
          <div className="card" style={{ padding: '1.25rem', gridColumn: '1 / -1' }}>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.9375rem', fontWeight: 700 }}>Ad Fuel Settings</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.875rem', marginTop: 0 }}>
              Agency-wide settings for Ad Fuel calculations.
            </p>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>
                  Data Cutoff Date
                  <span style={{ fontWeight: 400, color: 'var(--text-faint)', marginLeft: 6 }}>
                    Spend and purchased totals exclude data before this date
                  </span>
                </label>
                <input
                  type="date"
                  value={cutoffInput}
                  onChange={e => setCutoffInput(e.target.value)}
                  className="input"
                  style={{ fontSize: '0.875rem' }}
                />
              </div>
              <button
                onClick={saveCutoffDate}
                disabled={cutoffSaving}
                className="btn btn-primary"
                style={{ fontSize: '0.8125rem' }}
              >
                {cutoffSaving ? 'Saving…' : 'Save'}
              </button>
              {cutoffMsg && (
                <span style={{ fontSize: '0.8rem', color: cutoffMsg === 'Saved!' ? 'var(--green)' : 'var(--red)' }}>
                  {cutoffMsg}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── CLIENT EDIT MODAL (click row on dashboard) ───────────────────────── */}
      {clientEditModal && (
        <div
          onClick={() => setClientEditModal(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bg-surface)', borderRadius: 12, width: '100%', maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}
          >
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>{clientEditModal.clientName}</h2>
                <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Ad Fuel billing settings</p>
              </div>
              <button onClick={() => setClientEditModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem', color: 'var(--text-faint)' }}>×</button>
            </div>

            <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Bill Day <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>(1–31)</span></label>
                  <input
                    type="number" min={1} max={31} placeholder="e.g. 1"
                    value={clientEditForm.billDay}
                    onChange={e => setClientEditForm(f => ({ ...f, billDay: e.target.value }))}
                    className="input" style={{ width: '100%' }}
                    autoFocus
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Historic Bill Day <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>(1–31)</span></label>
                  <input
                    type="number" min={1} max={31} placeholder="e.g. 21"
                    value={clientEditForm.historicBillDay}
                    onChange={e => setClientEditForm(f => ({ ...f, historicBillDay: e.target.value }))}
                    className="input" style={{ width: '100%' }}
                  />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Ad Fuel Budget / Cycle ($)</label>
                <input
                  type="number" min={0} placeholder="e.g. 5000"
                  value={clientEditForm.monthlyBudget}
                  onChange={e => setClientEditForm(f => ({ ...f, monthlyBudget: e.target.value }))}
                  className="input" style={{ width: '100%' }}
                />
              </div>

              {clientEditError && <p style={{ color: 'var(--red)', fontSize: '0.8rem', margin: 0 }}>{clientEditError}</p>}
            </div>

            <div style={{ padding: '0.875rem 1.25rem', borderTop: '1px solid var(--border)', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setClientEditModal(null)} className="btn btn-secondary">Cancel</button>
              <button onClick={saveClientEdit} disabled={clientEditSaving} className="btn btn-primary">
                {clientEditSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
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
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Client *</label>
                <select value={addForm.client_id} onChange={e => setAddForm(f => ({ ...f, client_id: e.target.value }))} className="input" style={{ width: '100%' }}>
                  <option value="">Select a client…</option>
                  {rows.map(r => <option key={r.clientId} value={r.clientId}>{r.clientName}</option>)}
                </select>
              </div>

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

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Invoice ID <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>(optional)</span></label>
                <input type="text" placeholder="INV-001" value={addForm.invoice_id} onChange={e => setAddForm(f => ({ ...f, invoice_id: e.target.value }))} className="input" style={{ width: '100%' }} />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Notes <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>(optional)</span></label>
                <input type="text" placeholder="e.g. 2025 Catchup Ad Fuel Submission" value={addForm.note} onChange={e => setAddForm(f => ({ ...f, note: e.target.value }))} className="input" style={{ width: '100%' }} />
              </div>

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
