'use client'

import '@/styles/admin/adfuel.css'
import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react'
import {
  Robot, ArrowsClockwise, DownloadSimple, UploadSimple, Plus, Trash, X, CaretUp, CaretDown, ArrowsDownUp,
  Gauge, Receipt, GearSix, Check, Info, Pause, Buildings,
} from '@phosphor-icons/react'
import PageHeader from '@/components/ui/PageHeader'
import Section from '@/components/ui/Section'
import EmptyState from '@/components/ui/EmptyState'
import StatusBadge, { type StatusTone } from '@/components/ui/StatusBadge'
import { PillTabs } from '@/components/ui/PillTabs'
import Dialog, { ConfirmDialog } from '@/components/ui/Dialog'
import { Sk, SkTable, SkRows } from '@/components/ui/Skeleton'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DashRow {
  clientId:              string
  clientName:            string
  googleAccountId:       string | null
  facebookAccountId:     string | null
  crmId:                 string | null
  discordChannelId:      string | null
  adFuelAlertThreshold:  number | null
  billDay:               number | null
  historicBillDay:       number | null
  monthlyBudget:         number | null
  adFuelCut:             number
  afBalance:             number
  rawBalance:            number
  afPurchased:           number
  afSpend:               number
  rawPurchased:          number
  rawSpend:              number
  googleRaw:             number
  facebookRaw:           number
  afSinceBill:           number | null
  avgDailyAf:            number | null
  pace:                  string
  rawDailyBudget:        number
  afDailyBudget:         number
  adFuelAlertMuted:      boolean
  autoPauseAds:          boolean
  autoResumeAds:         boolean
  campaignsPausedAt:     string | null
  pendingAch?:           number
}

interface LedgerEntry {
  id:              string
  client_id:       string
  date_of_payment: string | null
  invoice_date:    string | null
  amount_af:       number
  split_override:  number | null
  invoice_id:      string | null
  type:            string | null
  note:            string | null
  created_by:      string | null
  created_at:      string
  ach_status:      string | null
  is_ach_pending?: boolean   // true = from ad_fuel_ach_pending, routes delete differently
}

interface ColConfig {
  key:     string
  label:   string
  visible: boolean
}

type Tab = 'dashboard' | 'ledger' | 'settings'

// ─── Column definitions ───────────────────────────────────────────────────────

const DEFAULT_COLS: ColConfig[] = [
  { key: 'client',         label: 'Client',             visible: true  },
  { key: 'googleAcct',     label: 'Google account',     visible: false },
  { key: 'fbAcct',         label: 'Facebook account',   visible: false },
  { key: 'crmId',          label: 'CRM ID',             visible: false },
  { key: 'afBalance',      label: 'Ad Fuel balance',    visible: true  },
  { key: 'rawBalance',     label: 'Raw balance',        visible: true  },
  { key: 'afPurchased',    label: 'Ad Fuel purchased',  visible: true  },
  { key: 'afSpend',        label: 'Ad Fuel spend',      visible: true  },
  { key: 'rawPurchased',   label: 'Raw purchased',      visible: false },
  { key: 'rawSpend',       label: 'Raw spend',          visible: false },
  { key: 'googleRaw',      label: 'Google raw',         visible: true  },
  { key: 'fbRaw',          label: 'Facebook raw',       visible: true  },
  { key: 'billDay',        label: 'Bill day',           visible: true  },
  { key: 'budget',         label: 'Budget',             visible: true  },
  { key: 'afSinceBill',    label: 'Ad Fuel since bill', visible: true  },
  { key: 'avgDaily',       label: 'Avg daily',          visible: true  },
  { key: 'pace',           label: 'Pace',               visible: true  },
  { key: 'rawDailyBudget', label: 'Raw daily budget',   visible: false },
  { key: 'afDailyBudget',  label: 'AF daily budget',    visible: false },
]

/** Columns that hold text rather than money, so they sit left. */
const LEFT_COLS = new Set(['client', 'googleAcct', 'fbAcct', 'crmId', 'pace', 'autoPause'])

const LS_KEY = 'adfuel_col_config'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '—'
  const v = Number(n)
  return (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—'
  return (Number(n) * 100).toFixed(1) + '%'
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function fmtDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const PACE: Record<string, { tone: StatusTone; label: string }> = {
  'On pace':       { tone: 'success', label: 'On pace' },
  'Underspending': { tone: 'warning', label: 'Underspending' },
  'Overspending':  { tone: 'danger',  label: 'Overspending' },
}

function PaceBadge({ pace }: { pace: string }) {
  const p = PACE[pace] ?? { tone: 'neutral' as const, label: pace }
  return <StatusBadge tone={p.tone}>{p.label}</StatusBadge>
}

/** Red below zero, amber under the client's alert threshold, green otherwise. */
function balanceTone(row: DashRow): string {
  if (row.afBalance < 0) return 'af-neg'
  if (row.adFuelAlertThreshold != null && row.afBalance < row.adFuelAlertThreshold) return 'af-warn'
  return row.afBalance === 0 ? '' : 'af-pos'
}

function balanceTitle(row: DashRow): string | undefined {
  if (row.afBalance >= 0 && row.adFuelAlertThreshold != null && row.afBalance < row.adFuelAlertThreshold) {
    return `Below the ${fmt$(row.adFuelAlertThreshold, 0)} alert threshold`
  }
  return undefined
}

const ENTRY_TYPES = ['MRR', 'One-Time', 'ACH', 'Catch up', 'Other']

function sortValue(row: DashRow, key: string): string | number {
  switch (key) {
    case 'client':             return row.clientName.toLowerCase()
    case 'afBalance':          return row.afBalance
    case 'rawBalance':         return row.rawBalance
    case 'afPurchased':        return row.afPurchased
    case 'afSpend':            return row.afSpend
    case 'rawPurchased':       return row.rawPurchased
    case 'rawSpend':           return row.rawSpend
    case 'googleRaw':          return row.googleRaw
    case 'fbRaw':              return row.facebookRaw
    case 'billDay':            return row.billDay ?? -1
    case 'budget':             return row.monthlyBudget ?? -1
    case 'afSinceBill':        return row.afSinceBill ?? -1
    case 'avgDaily':           return row.avgDailyAf    ?? -1
    case 'rawDailyBudget':     return row.rawDailyBudget ?? -1
    case 'afDailyBudget':      return row.afDailyBudget  ?? -1
    case 'pace': {
      const o: Record<string, number> = { 'Overspending': 2, 'On pace': 1, 'Underspending': 0 }
      return o[row.pace] ?? -1
    }
    default: return 0
  }
}

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

function Dash() {
  return <span className="af-faint">—</span>
}

function AutoPauseIcon({ row }: { row: DashRow }) {
  if (!row.autoPauseAds) return null
  const text = row.campaignsPausedAt ? 'Auto-pause on, campaigns paused now' : 'Auto-pause on'
  return (
    <span className={`af-robot${row.campaignsPausedAt ? ' af-robot--paused' : ''}`} title={text}>
      <Robot size={14} weight="fill" aria-hidden />
      <span className="sr-only">{text}</span>
    </span>
  )
}

function renderCell(key: string, row: DashRow, onEdit: (row: DashRow) => void): ReactNode {
  const num = (v: ReactNode, cls = '') => <td key={key} className={`ui-r af-money${cls ? ` ${cls}` : ''}`}>{v}</td>
  switch (key) {
    case 'client': return (
      <td key={key}>
        <button
          type="button"
          className="af-client"
          onClick={e => { e.stopPropagation(); onEdit(row) }}
          title="Edit billing, alerts and auto-pause"
        >
          <span className="af-client-name">{row.clientName}</span>
          <AutoPauseIcon row={row} />
        </button>
      </td>
    )
    case 'googleAcct':   return <td key={key} className="af-faint af-small">{row.googleAccountId ?? '—'}</td>
    case 'fbAcct':       return <td key={key} className="af-faint af-small">{row.facebookAccountId ?? '—'}</td>
    case 'crmId':        return <td key={key} className="af-faint af-small">{row.crmId ?? '—'}</td>
    case 'afBalance': {
      const pendingAch       = row.pendingAch ?? 0
      const projectedBalance = row.afBalance + pendingAch
      return num(
        <>
          <span className={`af-strong ${balanceTone(row)}`} title={balanceTitle(row)}>{fmt$(row.afBalance)}</span>
          {pendingAch > 0 && (
            <span className={`af-proj ${projectedBalance >= 0 ? 'af-pos' : 'af-neg'}`} title="Projected once pending ACH payments clear">
              {fmt$(projectedBalance)} after ACH
            </span>
          )}
        </>,
      )
    }
    case 'rawBalance':   return num(<span className={row.rawBalance >= 0 ? 'af-muted' : 'af-neg'}>{fmt$(row.rawBalance)}</span>)
    case 'afPurchased':  return num(fmt$(row.afPurchased), 'ui-strong')
    case 'afSpend':      return num(fmt$(row.afSpend), 'ui-strong')
    case 'rawPurchased': return num(fmt$(row.rawPurchased))
    case 'rawSpend':     return num(fmt$(row.rawSpend))
    case 'googleRaw':    return num(<span className="af-muted">{fmt$(row.googleRaw)}</span>)
    case 'fbRaw':        return num(<span className="af-muted">{fmt$(row.facebookRaw)}</span>)
    case 'billDay':      return num(row.billDay ?? <Dash />, row.billDay ? 'ui-strong' : '')
    case 'budget':       return num(row.monthlyBudget ? fmt$(row.monthlyBudget, 0) : <Dash />, row.monthlyBudget ? 'ui-strong' : '')
    case 'afSinceBill':  return num(<span className="af-strong">{fmt$(row.afSinceBill)}</span>)
    case 'avgDaily':     return num(<span className="af-muted">{fmt$(row.avgDailyAf)}</span>)
    case 'rawDailyBudget': return (
      <td key={key} className="ui-r af-money af-muted"
          title="Current total daily budget across all active campaigns (Google + Meta), not date-filtered">
        {row.rawDailyBudget > 0 ? fmt$(row.rawDailyBudget) : <Dash />}
      </td>
    )
    case 'afDailyBudget': return (
      <td key={key} className="ui-r af-money af-muted"
          title="Ad Fuel equivalent of the raw daily budget (raw ÷ client split), not date-filtered">
        {row.afDailyBudget > 0 ? fmt$(row.afDailyBudget) : <Dash />}
      </td>
    )
    case 'pace': return <td key={key}>{row.pace ? <PaceBadge pace={row.pace} /> : <Dash />}</td>
    case 'autoPause': return (
      <td key={key}>
        {row.campaignsPausedAt ? <StatusBadge tone="danger">Paused</StatusBadge>
          : row.autoPauseAds   ? <StatusBadge tone="success">Auto</StatusBadge>
          : <Dash />}
      </td>
    )
    default: return <td key={key} />
  }
}

/** One phone line for a client: where the billing cycle stands. */
function cycleLine(row: DashRow): string {
  const parts: string[] = []
  if (row.afSinceBill != null) parts.push(`${fmt$(row.afSinceBill, 0)}${row.monthlyBudget ? ` of ${fmt$(row.monthlyBudget, 0)}` : ''} since bill`)
  if (row.avgDailyAf != null) parts.push(`${fmt$(row.avgDailyAf, 0)} a day`)
  if (row.billDay) parts.push(`bills on day ${row.billDay}`)
  if (!parts.length) return 'No bill day set'
  const line = parts.join(' · ')
  return line.charAt(0).toUpperCase() + line.slice(1)
}

function LedgerTags({ e }: { e: LedgerEntry }) {
  if (!e.ach_status && !e.type) return <Dash />
  return (
    <span className="af-tags">
      {e.ach_status === 'pending' && <StatusBadge tone="warning">ACH pending</StatusBadge>}
      {e.ach_status === 'cleared' && <StatusBadge tone="success">ACH cleared</StatusBadge>}
      {e.type && <StatusBadge tone="neutral" dot={false}>{e.type}</StatusBadge>}
    </span>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function AdFuelPage() {
  const [tab, setTab] = useState<Tab>('dashboard')

  const [rows,          setRows]          = useState<DashRow[]>([])
  const [cutoffDate,    setCutoffDate]    = useState('2025-01-01')
  // Starts true so the first paint is the skeleton, not an empty table.
  const [loading,       setLoading]       = useState(true)
  const [pendingAch,    setPendingAch]    = useState<Record<string, number>>({})
  const [syncingStripe, setSyncingStripe] = useState(false)
  const [stripeMsg,     setStripeMsg]     = useState('')
  const [sortCol,       setSortCol]       = useState<string | null>(null)
  const [sortDir,       setSortDir]       = useState<'asc' | 'desc' | null>(null)

  // Column config (persisted to localStorage)
  const [cols, setCols] = useState<ColConfig[]>(DEFAULT_COLS)
  useEffect(() => { setCols(loadCols()) }, [])
  async function fetchPendingAch() {
    try {
      const r = await fetch('/api/admin/ad-fuel/pending-ach')
      if (!r.ok) { console.warn('[ad-fuel] pending-ach fetch failed:', r.status); return }
      const data = await r.json()
      setPendingAch(data?.pending ?? {})
    } catch (e) { console.error('[ad-fuel] pending-ach error:', e) }
  }

  useEffect(() => { fetchPendingAch() }, [])

  async function syncStripeInvoices() {
    setSyncingStripe(true)
    setStripeMsg('')
    try {
      const r = await fetch('/api/admin/ad-fuel/pending-ach', { method: 'POST' })
      if (!r.ok) { setStripeMsg('Stripe sync failed — check API key.'); return }
      const data = await r.json()
      setPendingAch(data?.pending ?? {})
      const count = Object.keys(data?.pending ?? {}).length
      setStripeMsg(count > 0 ? `Found ${count} client(s) with pending ACH.` : 'No new pending ACH invoices found.')
      // Refresh balance and ledger so projected totals and entries update immediately
      fetchDashboard()
      if (tab === 'ledger') fetchLedger()
    } catch (e) {
      setStripeMsg('Error contacting Stripe.')
      console.error('[ad-fuel] stripe sync error:', e)
    } finally {
      setSyncingStripe(false)
    }
  }

  function handleSortClick(key: string) {
    if (sortCol !== key) { setSortCol(key); setSortDir('asc') }
    else if (sortDir === 'asc') { setSortDir('desc') }
    else { setSortCol(null); setSortDir(null) }
  }

  function saveCols(next: ColConfig[]) {
    setCols(next)
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)) } catch {}
  }

  // Client edit modal (bill day + budget)
  const [clientEditModal, setClientEditModal] = useState<DashRow | null>(null)
  const [clientEditForm,  setClientEditForm]  = useState({ billDay: '', historicBillDay: '', monthlyBudget: '', adFuelAlertThreshold: '', adFuelAlertMuted: false, autoPauseAds: false, autoResumeAds: false })
  const [clientEditSaving, setClientEditSaving] = useState(false)
  const [clientEditError,  setClientEditError]  = useState('')

  function openClientEdit(row: DashRow) {
    setClientEditModal(row)
    setClientEditForm({
      billDay:              String(row.billDay ?? ''),
      historicBillDay:      String(row.historicBillDay ?? ''),
      monthlyBudget:        String(row.monthlyBudget ?? ''),
      adFuelAlertThreshold: row.adFuelAlertThreshold != null ? String(row.adFuelAlertThreshold) : '',
      adFuelAlertMuted:     row.adFuelAlertMuted,
      autoPauseAds:         row.autoPauseAds,
      autoResumeAds:        row.autoResumeAds,
    })
    setClientEditError('')
  }

  async function saveClientEdit() {
    if (!clientEditModal) return
    setClientEditSaving(true)
    setClientEditError('')
    const body: Record<string, unknown> = {
      bill_day:                clientEditForm.billDay              === '' ? null : parseInt(clientEditForm.billDay),
      historic_bill_day:       clientEditForm.historicBillDay      === '' ? null : parseInt(clientEditForm.historicBillDay),
      monthly_budget:          clientEditForm.monthlyBudget        === '' ? null : parseFloat(clientEditForm.monthlyBudget),
      ad_fuel_alert_threshold: clientEditForm.adFuelAlertThreshold === '' ? null : parseFloat(clientEditForm.adFuelAlertThreshold),
      ad_fuel_alert_muted:     clientEditForm.adFuelAlertMuted,
      auto_pause_ads:          clientEditForm.autoPauseAds,
      auto_resume_ads:         clientEditForm.autoResumeAds,
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
  const [ledgerLoaded,  setLedgerLoaded]  = useState(false)
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
  const [settingsForm,       setSettingsForm]       = useState({ billDay: '', historicBillDay: '', monthlyBudget: '', adFuelAlertThreshold: '' })
  const [settingsSaving,     setSettingsSaving]     = useState(false)
  const [settingsSaveMsg,    setSettingsSaveMsg]    = useState('')

  // Settings tab — Ad Fuel cutoff date (agency-level)
  const [cutoffInput,   setCutoffInput]   = useState(cutoffDate)
  const [cutoffSaving,  setCutoffSaving]  = useState(false)
  const [cutoffMsg,     setCutoffMsg]     = useState('')

  const fetchDashboard = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/ad-fuel')
      if (res.ok) {
        const json = await res.json()
        setRows(json.rows ?? [])
        if (json.cutoffDate) { setCutoffDate(json.cutoffDate); setCutoffInput(json.cutoffDate) }
      }
    } finally { setLoading(false) }
  }, [])

  const fetchLedger = useCallback(async () => {
    setLedgerLoading(true)
    try {
      const url = filterClient ? `/api/admin/ad-fuel/ledger?client_id=${filterClient}` : '/api/admin/ad-fuel/ledger'
      const res = await fetch(url)
      if (res.ok) setLedger(await res.json())
    } finally { setLedgerLoading(false); setLedgerLoaded(true) }
  }, [filterClient])

  useEffect(() => { fetchDashboard() }, [fetchDashboard])
  useEffect(() => { if (tab === 'ledger') fetchLedger() }, [tab, fetchLedger])

  // Populate settings form when a client is selected in settings tab
  useEffect(() => {
    if (!settingsClientId) { setSettingsForm({ billDay: '', historicBillDay: '', monthlyBudget: '', adFuelAlertThreshold: '' }); return }
    const row = rows.find(r => r.clientId === settingsClientId)
    if (row) setSettingsForm({
      billDay:              String(row.billDay ?? ''),
      historicBillDay:      String(row.historicBillDay ?? ''),
      monthlyBudget:        String(row.monthlyBudget ?? ''),
      adFuelAlertThreshold: row.adFuelAlertThreshold != null ? String(row.adFuelAlertThreshold) : '',
    })
  }, [settingsClientId, rows])

  async function saveSettingsClient() {
    if (!settingsClientId) return
    setSettingsSaving(true)
    setSettingsSaveMsg('')
    const body: Record<string, unknown> = {
      bill_day:                settingsForm.billDay              === '' ? null : parseInt(settingsForm.billDay),
      historic_bill_day:       settingsForm.historicBillDay      === '' ? null : parseInt(settingsForm.historicBillDay),
      monthly_budget:          settingsForm.monthlyBudget        === '' ? null : parseFloat(settingsForm.monthlyBudget),
      ad_fuel_alert_threshold: settingsForm.adFuelAlertThreshold === '' ? null : parseFloat(settingsForm.adFuelAlertThreshold),
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
    if (!addForm.client_id || !addForm.amount_af) { setAddError('Choose a client and enter an amount.'); return }
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

  // ── Delete ledger entries ───────────────────────────────────────────────────
  // Both deletes ask first, in a ConfirmDialog (they used window.confirm). A failed delete throws,
  // so the dialog says so and stays open.
  const [deleteAsk, setDeleteAsk] = useState<{ kind: 'one'; id: string; ach: boolean } | { kind: 'bulk' } | null>(null)

  function deleteEntry(id: string, isAchPending?: boolean) {
    setDeleteAsk({ kind: 'one', id, ach: !!isAchPending })
  }

  function bulkDelete() {
    if (selectedIds.size > 0) setDeleteAsk({ kind: 'bulk' })
  }

  async function confirmDelete() {
    if (!deleteAsk) return
    if (deleteAsk.kind === 'one') {
      const { id, ach } = deleteAsk
      const res = await fetch(ach ? `/api/admin/ad-fuel/pending-ach?id=${id}` : `/api/admin/ad-fuel/ledger/${id}`, { method: 'DELETE' }).catch(() => null)
      if (!res?.ok) throw new Error('The entry couldn’t be deleted. Try again.')
      setSelectedIds(s => { const n = new Set(s); n.delete(id); return n })
    } else {
      setBulkDeleting(true)
      try {
        const res = await fetch('/api/admin/ad-fuel/ledger', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: Array.from(selectedIds) }),
        }).catch(() => null)
        if (!res?.ok) throw new Error('The entries couldn’t be deleted. Try again.')
        setSelectedIds(new Set())
      } finally {
        setBulkDeleting(false)
      }
    }
    setDeleteAsk(null)
    fetchLedger()
    fetchDashboard()
  }

  // Pending ACH rows have no checkbox and bulk delete only removes confirmed entries, so
  // "select all" takes the confirmed ones only (it used to count the pending rows too).
  const selectable = ledger.filter(e => !e.is_ach_pending)
  const allSelected = selectable.length > 0 && selectedIds.size === selectable.length

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(selectable.map(e => e.id)))
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
    a.download = `ad-fuel-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  const visibleCols = cols.filter(c => c.visible)

  const rowsWithPending = rows.map(r => ({ ...r, pendingAch: pendingAch[r.clientId] ?? 0 }))

  const displayRows = sortCol && sortDir
    ? [...rowsWithPending].sort((a, b) => {
        const va = sortValue(a, sortCol)
        const vb = sortValue(b, sortCol)
        const cmp = typeof va === 'string'
          ? va.localeCompare(vb as string)
          : (va as number) - (vb as number)
        return sortDir === 'asc' ? cmp : -cmp
      })
    : rowsWithPending

  // Totals for the strip — sums of the rows above, nothing recalculated.
  const totalBalance   = rowsWithPending.reduce((s, r) => s + r.afBalance, 0)
  const totalPending   = rowsWithPending.reduce((s, r) => s + (r.pendingAch ?? 0), 0)
  const totalPurchased = rows.reduce((s, r) => s + r.afPurchased, 0)
  const totalSpent     = rows.reduce((s, r) => s + r.afSpend, 0)
  const overdrawn      = rows.filter(r => r.afBalance < 0).length
  const lowBalance     = rows.filter(r => r.afBalance >= 0 && r.adFuelAlertThreshold != null && r.afBalance < r.adFuelAlertThreshold).length
  const overspending   = rows.filter(r => r.pace === 'Overspending').length
  const cutoffLabel    = fmtDay(cutoffDate)

  const firstDashLoad   = loading && rows.length === 0
  const firstLedgerLoad = !ledgerLoaded || (ledgerLoading && ledger.length === 0)
  const stripeFailed    = /failed|error/i.test(stripeMsg)
  const clientName      = (id: string) => rows.find(r => r.clientId === id)?.clientName ?? id.slice(0, 8)

  const statValue = (v: ReactNode) => (firstDashLoad ? <Sk w={92} h={24} r={6} /> : v)

  function SortHead({ col }: { col: ColConfig }) {
    const on = sortCol === col.key && sortDir != null
    return (
      <th className={LEFT_COLS.has(col.key) ? undefined : 'ui-r'} aria-sort={on ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" className={`af-sort${on ? ' af-sort--on' : ''}`} onClick={() => handleSortClick(col.key)}>
          {col.label}
          {on ? (sortDir === 'asc' ? <CaretUp size={11} weight="bold" aria-hidden /> : <CaretDown size={11} weight="bold" aria-hidden />)
              : <ArrowsDownUp size={11} className="af-sort-idle" aria-hidden />}
        </button>
      </th>
    )
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div>
      <PageHeader
        title="Ad Fuel"
        description="Each client's prepaid ad budget: what they've bought, what's been spent and what's left."
        actions={
          <button
            type="button"
            onClick={syncStripeInvoices}
            disabled={syncingStripe}
            className="btn btn-secondary"
            title="Check Stripe for new or unrecorded ACH invoices"
          >
            <ArrowsClockwise size={15} weight="bold" className={syncingStripe ? 'af-spin' : undefined} aria-hidden />
            {syncingStripe ? 'Syncing…' : 'Sync Stripe'}
          </button>
        }
      />

      {stripeMsg && (
        <div className={`ui-notice ui-notice--${stripeFailed ? 'danger' : 'info'}`} role="status">
          <span>{stripeMsg}</span>
          <button type="button" className="af-iconbtn af-iconbtn--plain" onClick={() => setStripeMsg('')} aria-label="Dismiss message">
            <X size={14} aria-hidden />
          </button>
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <PillTabs
          label="Ad Fuel sections"
          idPrefix="af"
          activeId={tab}
          onSelect={id => setTab(id as Tab)}
          items={[
            { id: 'dashboard', label: 'Dashboard', icon: <Gauge size={15} /> },
            { id: 'ledger',    label: 'Ledger',    icon: <Receipt size={15} /> },
            { id: 'settings',  label: 'Settings',  icon: <GearSix size={15} /> },
          ]}
        />
      </div>

      {/* ── DASHBOARD TAB ────────────────────────────────────────────────────── */}
      {tab === 'dashboard' && (
        <div role="tabpanel" id="af-panel-dashboard" aria-labelledby="af-tab-dashboard" className="af-sec">
          <section className="card af-stats" aria-label="Totals">
            <div className="af-stat">
              <span className="af-stat-label">Ad Fuel balance</span>
              <span className={`af-stat-value${totalBalance < 0 ? ' af-neg' : ''}`}>{statValue(fmt$(totalBalance, 0))}</span>
              {!firstDashLoad && totalPending > 0 && (
                <span className="af-stat-sub">{fmt$(totalBalance + totalPending, 0)} after pending ACH</span>
              )}
            </div>
            <div className="af-stat">
              <span className="af-stat-label">Purchased</span>
              <span className="af-stat-value">{statValue(fmt$(totalPurchased, 0))}</span>
              <span className="af-stat-sub">Since {cutoffLabel}</span>
            </div>
            <div className="af-stat">
              <span className="af-stat-label">Spent</span>
              <span className="af-stat-value">{statValue(fmt$(totalSpent, 0))}</span>
              <span className="af-stat-sub">Since {cutoffLabel}</span>
            </div>
            <div className="af-stat">
              <span className="af-stat-label">Below zero</span>
              <span className={`af-stat-value${overdrawn > 0 ? ' af-neg' : ''}`}>{statValue(overdrawn)}</span>
              {!firstDashLoad && (
                <span className={`af-stat-sub${lowBalance > 0 ? ' af-warn' : ''}`}>
                  {lowBalance > 0 ? `${lowBalance} more under their alert threshold` : `of ${rows.length} client${rows.length === 1 ? '' : 's'}`}
                </span>
              )}
            </div>
            <div className="af-stat">
              <span className="af-stat-label">Overspending</span>
              <span className={`af-stat-value${overspending > 0 ? ' af-warn' : ''}`}>{statValue(overspending)}</span>
              <span className="af-stat-sub">This billing cycle</span>
            </div>
          </section>

          <Section
            title="Balances"
            description={`Totals since ${cutoffLabel}. Select a client to change their bill day, budget, alerts or auto-pause.`}
            actions={
              <button type="button" onClick={exportCSV} className="btn btn-secondary btn-sm" disabled={rows.length === 0}>
                <DownloadSimple size={14} weight="bold" aria-hidden />Export CSV
              </button>
            }
            flush
          >
            {firstDashLoad ? (
              <div aria-busy="true" aria-label="Loading balances">
                <div className="af-table-wrap"><SkTable rows={5} cols={8} /></div>
                <div className="af-list"><SkRows rows={5} tile={false} /></div>
              </div>
            ) : displayRows.length === 0 ? (
              <EmptyState icon={<Buildings size={20} />} title="No clients yet">
                Clients show here with their Ad Fuel balance once they&apos;re added.
              </EmptyState>
            ) : (
              <div className={loading ? 'af-refreshing' : undefined} aria-busy={loading}>
                {/* Laptop: the configurable table. */}
                <div className="af-table-wrap ui-scroll-x">
                  <table className="ui-table af-table">
                    <thead>
                      <tr>{visibleCols.map(col => <SortHead key={col.key} col={col} />)}</tr>
                    </thead>
                    <tbody>
                      {displayRows.map(row => (
                        <tr key={row.clientId} className="af-tr-edit" onClick={() => openClientEdit(row)}>
                          {visibleCols.map(col => renderCell(col.key, row, openClientEdit))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Phone: one row per client, balance on the right. */}
                <div className="af-list">
                  {displayRows.map(row => {
                    const pending = row.pendingAch ?? 0
                    const projected = row.afBalance + pending
                    return (
                      <button key={row.clientId} type="button" className="ui-row af-list-row" onClick={() => openClientEdit(row)}>
                        <span className="ui-row-text">
                          <span className="ui-row-title">{row.clientName}<AutoPauseIcon row={row} /></span>
                          <span className="ui-row-sub">{cycleLine(row)}</span>
                        </span>
                        <span className="af-list-end">
                          <span className={`af-list-amount ${balanceTone(row)}`} title={balanceTitle(row)}>{fmt$(row.afBalance)}</span>
                          {pending > 0 && <span className={`af-proj ${projected >= 0 ? 'af-pos' : 'af-neg'}`}>{fmt$(projected)} after ACH</span>}
                          {row.pace && <PaceBadge pace={row.pace} />}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </Section>
        </div>
      )}

      {/* ── LEDGER TAB ───────────────────────────────────────────────────────── */}
      {tab === 'ledger' && (
        <div role="tabpanel" id="af-panel-ledger" aria-labelledby="af-tab-ledger" className="af-sec">
          <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleImport} />
          <Section
            title="Ledger"
            description="Payments and adjustments, newest first. Pending ACH payments from Stripe are shaded until they clear."
            flush
            actions={<>
              <select
                value={filterClient}
                onChange={e => setFilterClient(e.target.value)}
                className="input af-filter"
                aria-label="Show entries for"
              >
                <option value="">All clients</option>
                {rows.map(r => <option key={r.clientId} value={r.clientId}>{r.clientName}</option>)}
              </select>
              <button type="button" onClick={() => fileInputRef.current?.click()} className="btn btn-secondary btn-sm">
                <UploadSimple size={14} weight="bold" aria-hidden />Import CSV
              </button>
              <button type="button" onClick={() => { setShowAddModal(true); setAddError('') }} className="btn btn-primary btn-sm">
                <Plus size={14} weight="bold" aria-hidden />Add entry
              </button>
            </>}
          >
            {importStatus && (
              <div className="af-pad">
                <div className={`ui-notice ui-notice--${importStatus.errors.length ? 'danger' : 'success'}`} role="status">
                  <span>
                    Imported {importStatus.inserted} entr{importStatus.inserted === 1 ? 'y' : 'ies'}
                    {importStatus.skipped > 0 ? `, skipped ${importStatus.skipped}` : ''}
                    {importStatus.errors.length > 0 && <>, {importStatus.errors.length} error{importStatus.errors.length === 1 ? '' : 's'}</>}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {importStatus.errors.length > 0 && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setImportErrorsExpanded(v => !v)}
                        aria-expanded={importErrorsExpanded}
                      >
                        {importErrorsExpanded ? 'Hide errors' : 'Show errors'}
                        {importErrorsExpanded ? <CaretUp size={12} weight="bold" aria-hidden /> : <CaretDown size={12} weight="bold" aria-hidden />}
                      </button>
                    )}
                    <button
                      type="button"
                      className="af-iconbtn af-iconbtn--plain"
                      onClick={() => { setImportStatus(null); setImportErrorsExpanded(false) }}
                      aria-label="Dismiss import result"
                    >
                      <X size={14} aria-hidden />
                    </button>
                  </span>
                  {importErrorsExpanded && importStatus.errors.length > 0 && (
                    <ul style={{ flexBasis: '100%', margin: 0, padding: '0 0 0 1.25rem', display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 200, overflowY: 'auto', fontSize: '0.75rem' }}>
                      {importStatus.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {selectedIds.size > 0 && (
              <div className="af-selbar">
                <span className="af-selbar-count">{selectedIds.size} selected</span>
                <button type="button" onClick={() => setSelectedIds(new Set())} className="btn btn-ghost btn-sm">
                  Clear selection
                </button>
                <button type="button" onClick={bulkDelete} disabled={bulkDeleting} className="btn btn-danger btn-sm">
                  <Trash size={14} aria-hidden />
                  {bulkDeleting ? 'Deleting…' : `Delete ${selectedIds.size}`}
                </button>
              </div>
            )}

            {firstLedgerLoad ? (
              <div aria-busy="true" aria-label="Loading ledger">
                <div className="af-table-wrap"><SkTable rows={7} cols={8} /></div>
                <div className="af-list"><SkRows rows={6} tile={false} /></div>
              </div>
            ) : ledger.length === 0 ? (
              <EmptyState icon={<Receipt size={20} />} title={filterClient ? 'No entries for this client' : 'No ledger entries yet'}>
                Add a payment by hand, import a CSV of past payments, or sync Stripe for pending ACH invoices.
              </EmptyState>
            ) : (
              <div className={ledgerLoading ? 'af-refreshing' : undefined} aria-busy={ledgerLoading}>
                {/* Laptop: the table. */}
                <div className="af-table-wrap ui-scroll-x">
                  <table className="ui-table af-table">
                    <thead>
                      <tr>
                        <th className="af-col-check">
                          <label className="af-check">
                            <input
                              type="checkbox"
                              className="af-checkbox"
                              checked={allSelected}
                              ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && !allSelected }}
                              onChange={toggleSelectAll}
                              disabled={selectable.length === 0}
                              aria-label="Select all entries"
                            />
                          </label>
                        </th>
                        <th>Payment date</th>
                        <th>Client</th>
                        <th className="ui-r">Amount (Ad Fuel)</th>
                        <th className="ui-r" title="Split override">Split</th>
                        <th>Invoice ID</th>
                        <th>Type</th>
                        <th>Notes</th>
                        <th className="af-col-act"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.map(e => {
                        const checked = selectedIds.has(e.id)
                        const name    = clientName(e.client_id)
                        return (
                          <tr key={e.id} className={e.is_ach_pending ? 'af-tr--pending' : checked ? 'af-tr--checked' : undefined}>
                            <td className="af-col-check">
                              {e.is_ach_pending
                                ? <span className="af-check-ph" title="Pending ACH, managed by the Stripe sync">—</span>
                                : (
                                  <label className="af-check">
                                    <input type="checkbox" className="af-checkbox" checked={checked} onChange={() => toggleSelect(e.id)} aria-label={`Select ${name} entry`} />
                                  </label>
                                )}
                            </td>
                            {/* The invoice date only shows when it differs from the payment date. */}
                            <td className="af-money">
                              {e.is_ach_pending ? <span className="af-muted">Pending</span> : (e.date_of_payment ?? '—')}
                              {e.invoice_date && e.invoice_date !== e.date_of_payment && (
                                <span className="af-proj af-faint">Invoiced {e.invoice_date}</span>
                              )}
                            </td>
                            <td className="ui-strong">{name}</td>
                            <td className="ui-r af-money"><span className={`af-strong ${e.amount_af >= 0 ? 'af-pos' : 'af-neg'}`}>{fmt$(e.amount_af)}</span></td>
                            <td className="ui-r af-money af-muted">{e.split_override != null ? fmtPct(e.split_override) : '—'}</td>
                            <td className="af-muted">{e.invoice_id ?? '—'}</td>
                            <td><LedgerTags e={e} /></td>
                            {/* Who added it sits under the note, so the table fits a laptop without scrolling. */}
                            <td className="af-muted" title={e.note ?? undefined}>
                              <span className="af-note">{e.note ?? '—'}</span>
                              {e.created_by && <span className="af-proj af-faint">Added by {e.created_by}</span>}
                            </td>
                            <td className="af-col-act">
                              <button
                                type="button"
                                className="af-iconbtn"
                                onClick={() => deleteEntry(e.id, e.is_ach_pending)}
                                aria-label={e.is_ach_pending ? `Remove pending ACH entry for ${name}` : `Delete ${name} entry`}
                                title={e.is_ach_pending ? 'Remove pending ACH entry' : 'Delete entry'}
                              >
                                <Trash size={15} aria-hidden />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Phone: one row per entry. */}
                {selectable.length > 0 && (
                  <label className="af-list-head">
                    <span className="af-check">
                      <input
                        type="checkbox"
                        className="af-checkbox"
                        checked={allSelected}
                        ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && !allSelected }}
                        onChange={toggleSelectAll}
                      />
                    </span>
                    Select all
                  </label>
                )}
                <div className="af-list">
                  {ledger.map(e => {
                    const checked = selectedIds.has(e.id)
                    const name    = clientName(e.client_id)
                    const meta    = [
                      e.is_ach_pending ? 'Pending' : `Paid ${e.date_of_payment ?? '—'}`,
                      e.invoice_date && e.invoice_date !== e.date_of_payment ? `invoiced ${e.invoice_date}` : null,
                      e.invoice_id,
                      e.split_override != null ? `${fmtPct(e.split_override)} split` : null,
                      e.created_by ? `by ${e.created_by}` : null,
                    ].filter(Boolean).join(' · ')
                    return (
                      <div key={e.id} className={`ui-row af-list-row${e.is_ach_pending ? ' af-list-row--pending' : checked ? ' af-list-row--checked' : ''}`}>
                        {e.is_ach_pending
                          ? <span className="af-check-ph" title="Pending ACH, managed by the Stripe sync">—</span>
                          : (
                            <label className="af-check">
                              <input type="checkbox" className="af-checkbox" checked={checked} onChange={() => toggleSelect(e.id)} aria-label={`Select ${name} entry`} />
                            </label>
                          )}
                        <span className="ui-row-text">
                          <span className="ui-row-title af-led-title">
                            <span className="af-led-name">{name}</span>
                            <span className={`af-list-amount ${e.amount_af >= 0 ? 'af-pos' : 'af-neg'}`}>{fmt$(e.amount_af)}</span>
                          </span>
                          <span className="ui-row-sub">{meta}</span>
                          {e.note && <span className="ui-row-sub af-note-sub">{e.note}</span>}
                          {(e.ach_status || e.type) && <LedgerTags e={e} />}
                        </span>
                        <button
                          type="button"
                          className="af-iconbtn"
                          onClick={() => deleteEntry(e.id, e.is_ach_pending)}
                          aria-label={e.is_ach_pending ? `Remove pending ACH entry for ${name}` : `Delete ${name} entry`}
                        >
                          <Trash size={16} aria-hidden />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </Section>
        </div>
      )}

      {/* ── SETTINGS TAB ─────────────────────────────────────────────────────── */}
      {tab === 'settings' && (
        <div role="tabpanel" id="af-panel-settings" aria-labelledby="af-tab-settings">
          <div className="ui-notice ui-notice--info">
            <span style={{ display: 'inline-flex', gap: 8, alignItems: 'flex-start' }}>
              <Info size={16} style={{ flexShrink: 0, marginTop: 1, color: 'var(--accent)' }} aria-hidden />
              <span>
                Balance, purchased and spend totals run from the data cutoff date. Since bill, avg daily and pace always cover
                the current billing cycle. You can also edit a client from the Dashboard tab by selecting their row.
              </span>
            </span>
          </div>

          <div className="ui-grid-2 af-settings">
            <div className="ui-stack">
              <Section title="Client billing" description="Bill day, budget and low-balance alert for one client.">
                <div className="af-form">
                  <div className="af-field">
                    <label className="af-label" htmlFor="af-set-client">Client</label>
                    <select
                      id="af-set-client"
                      value={settingsClientId}
                      onChange={e => setSettingsClientId(e.target.value)}
                      className="input"
                    >
                      <option value="">Select a client…</option>
                      {rows.map(r => <option key={r.clientId} value={r.clientId}>{r.clientName}</option>)}
                    </select>
                  </div>

                  {settingsClientId && (
                    <>
                      <div className="af-form-grid">
                        <div className="af-field">
                          <label className="af-label" htmlFor="af-set-bill">Bill day <span className="af-opt">1–31</span></label>
                          <input
                            id="af-set-bill"
                            type="number" min={1} max={31} placeholder="e.g. 1"
                            value={settingsForm.billDay}
                            onChange={e => setSettingsForm(f => ({ ...f, billDay: e.target.value }))}
                            className="input"
                          />
                        </div>
                        <div className="af-field">
                          <label className="af-label" htmlFor="af-set-hist">Historic bill day <span className="af-opt">1–31</span></label>
                          <input
                            id="af-set-hist"
                            type="number" min={1} max={31} placeholder="e.g. 21"
                            value={settingsForm.historicBillDay}
                            onChange={e => setSettingsForm(f => ({ ...f, historicBillDay: e.target.value }))}
                            className="input"
                          />
                        </div>
                        <div className="af-field">
                          <label className="af-label" htmlFor="af-set-budget">Monthly budget ($)</label>
                          <input
                            id="af-set-budget"
                            type="number" min={0} placeholder="e.g. 5000"
                            value={settingsForm.monthlyBudget}
                            onChange={e => setSettingsForm(f => ({ ...f, monthlyBudget: e.target.value }))}
                            className="input"
                          />
                        </div>
                        <div className="af-field">
                          <label className="af-label" htmlFor="af-set-alert">Alert threshold ($) <span className="af-opt">optional</span></label>
                          <input
                            id="af-set-alert"
                            type="number" min={0} placeholder="e.g. 200"
                            value={settingsForm.adFuelAlertThreshold}
                            onChange={e => setSettingsForm(f => ({ ...f, adFuelAlertThreshold: e.target.value }))}
                            className="input"
                          />
                        </div>
                      </div>

                      <div className="af-form-actions">
                        <button type="button" onClick={saveSettingsClient} disabled={settingsSaving} className="btn btn-primary">
                          {settingsSaving ? 'Saving…' : 'Save client settings'}
                        </button>
                        <SaveMsg msg={settingsSaveMsg} />
                      </div>
                    </>
                  )}
                </div>
              </Section>

              <Section title="Data cutoff" description="Spend and purchased totals leave out everything before this date. Applies to every client.">
                <div className="af-inline">
                  <div className="af-field">
                    <label className="af-label" htmlFor="af-cutoff">Cutoff date</label>
                    <input
                      id="af-cutoff"
                      type="date"
                      value={cutoffInput}
                      onChange={e => setCutoffInput(e.target.value)}
                      className="input"
                    />
                  </div>
                  <button type="button" onClick={saveCutoffDate} disabled={cutoffSaving} className="btn btn-primary">
                    {cutoffSaving ? 'Saving…' : 'Save cutoff date'}
                  </button>
                  <SaveMsg msg={cutoffMsg} />
                </div>
              </Section>
            </div>

            <Section
              title="Dashboard columns"
              description="Choose which columns the Dashboard shows and what they're called. Saved in this browser."
              actions={
                <button type="button" onClick={() => saveCols(DEFAULT_COLS)} className="btn btn-secondary btn-sm">
                  Reset to defaults
                </button>
              }
            >
              <div className="af-cols">
                {cols.map((col, i) => (
                  <div key={col.key} className={`af-col-row${col.visible ? '' : ' af-col-row--off'}`}>
                    <label className="af-check" title={col.key === 'client' ? 'Always shown' : col.visible ? 'Hide column' : 'Show column'}>
                      <input
                        type="checkbox"
                        className="af-checkbox"
                        checked={col.visible}
                        disabled={col.key === 'client'}
                        onChange={e => {
                          const next = cols.map((c, j) => j === i ? { ...c, visible: e.target.checked } : c)
                          saveCols(next)
                        }}
                        aria-label={`Show the ${col.label} column`}
                      />
                    </label>
                    <input
                      type="text"
                      value={col.label}
                      onChange={e => {
                        const next = cols.map((c, j) => j === i ? { ...c, label: e.target.value } : c)
                        saveCols(next)
                      }}
                      className="input"
                      aria-label={`Name of the ${DEFAULT_COLS.find(d => d.key === col.key)?.label ?? col.key} column`}
                    />
                  </div>
                ))}
              </div>
            </Section>
          </div>
        </div>
      )}

      {/* ── CLIENT EDIT MODAL (click row on dashboard) ───────────────────────── */}
      <Dialog
        open={!!clientEditModal}
        onClose={() => setClientEditModal(null)}
        title={clientEditModal?.clientName ?? ''}
        description="Ad Fuel billing, alerts and auto-pause"
        busy={clientEditSaving}
        bodyClassName="af-form"
        footer={<>
          <button type="button" onClick={() => setClientEditModal(null)} className="btn btn-secondary" disabled={clientEditSaving}>Cancel</button>
          <button type="button" onClick={saveClientEdit} disabled={clientEditSaving} className="btn btn-primary">
            {clientEditSaving ? 'Saving…' : 'Save changes'}
          </button>
        </>}
      >
              <div className="af-form-grid">
                <div className="af-field">
                  <label className="af-label" htmlFor="af-edit-bill">Bill day <span className="af-opt">1–31</span></label>
                  <input
                    id="af-edit-bill"
                    type="number" min={1} max={31} placeholder="e.g. 1"
                    value={clientEditForm.billDay}
                    onChange={e => setClientEditForm(f => ({ ...f, billDay: e.target.value }))}
                    className="input"
                  />
                </div>
                <div className="af-field">
                  <label className="af-label" htmlFor="af-edit-hist">Historic bill day <span className="af-opt">1–31</span></label>
                  <input
                    id="af-edit-hist"
                    type="number" min={1} max={31} placeholder="e.g. 21"
                    value={clientEditForm.historicBillDay}
                    onChange={e => setClientEditForm(f => ({ ...f, historicBillDay: e.target.value }))}
                    className="input"
                  />
                </div>
                <div className="af-field">
                  <label className="af-label" htmlFor="af-edit-budget">Budget per cycle ($)</label>
                  <input
                    id="af-edit-budget"
                    type="number" min={0} placeholder="e.g. 5000"
                    value={clientEditForm.monthlyBudget}
                    onChange={e => setClientEditForm(f => ({ ...f, monthlyBudget: e.target.value }))}
                    className="input"
                  />
                </div>
                <div className="af-field">
                  <label className="af-label" htmlFor="af-edit-alert">Alert threshold ($) <span className="af-opt">optional</span></label>
                  <input
                    id="af-edit-alert"
                    type="number" min={0} placeholder="e.g. 200"
                    value={clientEditForm.adFuelAlertThreshold}
                    onChange={e => setClientEditForm(f => ({ ...f, adFuelAlertThreshold: e.target.value }))}
                    className="input"
                  />
                </div>
              </div>

              {/* ── Alert mute ──────────────────────────────────────── */}
              <div className="af-group">
                <label className="af-toggle">
                  <input
                    type="checkbox"
                    className="af-checkbox"
                    checked={clientEditForm.adFuelAlertMuted}
                    onChange={e => setClientEditForm(f => ({ ...f, adFuelAlertMuted: e.target.checked }))}
                  />
                  <span className="af-toggle-text">
                    Mute low-balance Discord alerts
                    <span className="af-toggle-sub">No alerts are sent for this client, whatever the balance.</span>
                  </span>
                </label>
              </div>

              {/* ── Auto-pause ──────────────────────────────────────── */}
              <div className="af-group">
                <h3 className="af-group-title">Auto-pause campaigns</h3>

                {clientEditModal?.campaignsPausedAt && (
                  <div className="ui-notice ui-notice--danger">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Pause size={14} weight="fill" aria-hidden />
                      Campaigns paused since {new Date(clientEditModal.campaignsPausedAt).toLocaleDateString()}
                    </span>
                  </div>
                )}

                <label className="af-toggle">
                  <input
                    type="checkbox"
                    className="af-checkbox"
                    checked={clientEditForm.autoPauseAds}
                    onChange={e => setClientEditForm(f => ({ ...f, autoPauseAds: e.target.checked, autoResumeAds: e.target.checked ? f.autoResumeAds : false }))}
                  />
                  <span className="af-toggle-text">
                    Pause campaigns when the balance goes below zero
                    <span className="af-toggle-sub">Pauses every active Google and Meta campaign.</span>
                  </span>
                </label>

                {clientEditForm.autoPauseAds && (
                  <label className="af-toggle af-toggle--nested">
                    <input
                      type="checkbox"
                      className="af-checkbox"
                      checked={clientEditForm.autoResumeAds}
                      onChange={e => setClientEditForm(f => ({ ...f, autoResumeAds: e.target.checked }))}
                    />
                    <span className="af-toggle-text">
                      Resume them when the balance is back above zero
                      <span className="af-toggle-sub">Turns the paused campaigns back on automatically.</span>
                    </span>
                  </label>
                )}
              </div>

              {clientEditError && <div className="ui-notice ui-notice--danger" role="alert">{clientEditError}</div>}
      </Dialog>

      {/* ── DELETE CONFIRM ─────────────────────────────────────────────────────── */}
      <ConfirmDialog
        open={!!deleteAsk}
        tone="danger"
        title={deleteAsk?.kind === 'bulk'
          ? `Delete ${selectedIds.size} ${selectedIds.size === 1 ? 'entry' : 'entries'}?`
          : deleteAsk?.ach ? 'Delete this pending ACH payment?' : 'Delete this ledger entry?'}
        confirmLabel="Delete"
        busyLabel="Deleting…"
        onClose={() => setDeleteAsk(null)}
        onConfirm={confirmDelete}
      >
        {deleteAsk?.kind === 'bulk'
          ? 'They come off the ledger, and the Ad Fuel balances are worked out again without them. This can’t be undone.'
          : 'It comes off the ledger, and the Ad Fuel balance is worked out again without it. This can’t be undone.'}
      </ConfirmDialog>

      {/* ── ADD ENTRY MODAL ───────────────────────────────────────────────────── */}
      <Dialog
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Add ledger entry"
        description="A payment or adjustment, in Ad Fuel dollars."
        bodyClassName="af-form"
        footer={<>
          <button type="button" onClick={() => setShowAddModal(false)} className="btn btn-secondary">Cancel</button>
          <button type="button" onClick={submitAdd} className="btn btn-primary">Add entry</button>
        </>}
      >
              <div className="af-field">
                <label className="af-label" htmlFor="af-add-client">Client</label>
                <select id="af-add-client" value={addForm.client_id} onChange={e => setAddForm(f => ({ ...f, client_id: e.target.value }))} className="input">
                  <option value="">Select a client…</option>
                  {rows.map(r => <option key={r.clientId} value={r.clientId}>{r.clientName}</option>)}
                </select>
              </div>

              <div className="af-form-grid">
                <div className="af-field">
                  <label className="af-label" htmlFor="af-add-date">Date of payment</label>
                  <input id="af-add-date" type="date" value={addForm.date_of_payment} onChange={e => setAddForm(f => ({ ...f, date_of_payment: e.target.value }))} className="input" />
                </div>
                <div className="af-field">
                  <label className="af-label" htmlFor="af-add-amount">Ad Fuel amount ($)</label>
                  <input id="af-add-amount" type="number" placeholder="0.00" value={addForm.amount_af} onChange={e => setAddForm(f => ({ ...f, amount_af: e.target.value }))} className="input" />
                </div>
                <div className="af-field">
                  <label className="af-label" htmlFor="af-add-type">Type</label>
                  <select id="af-add-type" value={addForm.type} onChange={e => setAddForm(f => ({ ...f, type: e.target.value }))} className="input">
                    {ENTRY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="af-field">
                  <label className="af-label" htmlFor="af-add-split">Split override (%) <span className="af-opt">optional</span></label>
                  <input id="af-add-split" type="number" placeholder="Client default" min={0} max={100} value={addForm.split_override} onChange={e => setAddForm(f => ({ ...f, split_override: e.target.value }))} className="input" />
                </div>
              </div>

              <div className="af-field">
                <label className="af-label" htmlFor="af-add-invoice">Invoice ID <span className="af-opt">optional</span></label>
                <input id="af-add-invoice" type="text" placeholder="INV-001" value={addForm.invoice_id} onChange={e => setAddForm(f => ({ ...f, invoice_id: e.target.value }))} className="input" />
              </div>

              <div className="af-field">
                <label className="af-label" htmlFor="af-add-note">Notes <span className="af-opt">optional</span></label>
                <input id="af-add-note" type="text" placeholder="e.g. 2025 catch-up Ad Fuel submission" value={addForm.note} onChange={e => setAddForm(f => ({ ...f, note: e.target.value }))} className="input" />
              </div>

              <div className="af-field">
                <label className="af-label" htmlFor="af-add-by">Added by</label>
                <input id="af-add-by" type="text" placeholder="Your name" value={addForm.created_by} onChange={e => setAddForm(f => ({ ...f, created_by: e.target.value }))} className="input" />
              </div>

              {addError && <div className="ui-notice ui-notice--danger" role="alert">{addError}</div>}
      </Dialog>
    </div>
  )
}

/** "Saved!" / "Save failed" after a settings save. */
function SaveMsg({ msg }: { msg: string }) {
  if (!msg) return null
  const ok = msg === 'Saved!'
  return (
    <span className={`af-msg ${ok ? 'af-msg--ok' : 'af-msg--err'}`} role="status">
      {ok && <Check size={14} weight="bold" aria-hidden />}
      {ok ? 'Saved' : msg}
    </span>
  )
}
