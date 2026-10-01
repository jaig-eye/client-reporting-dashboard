'use client'

// Client → Billing: this client's Ad Fuel cut, its Stripe invoices and its Ad Fuel ledger.
// The invoice and ledger rows are exported for the Overview tab, which shows the latest five of
// each, so a line never looks different in the two places.

import '@/styles/admin/client-overview.css'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowSquareOut, Receipt, GasPump } from '@phosphor-icons/react'
import Section from '@/components/ui/Section'
import StatusBadge, { type StatusTone } from '@/components/ui/StatusBadge'
import Tile from '@/components/ui/Tile'
import { Sk, SkTable } from '@/components/ui/Skeleton'

export interface Invoice {
  id:          string
  number:      string | null
  date:        number
  amount:      number
  status:      string | null
  description: string | null
  hosted_url:  string | null
}

export interface LedgerEntry {
  id:              string
  date_of_payment: string | null
  invoice_date:    string | null
  amount_af:       number
  type:            string | null
  note:            string | null
  ach_status:      string | null
  invoice_id?:     string | null
  created_at:      string
}

// ─── formatting ───────────────────────────────────────────────────────────────

/** Dollars and cents, unsigned. */
export function fmtMoney(n: number): string {
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** A ledger amount with its sign. Debits used to show without a minus, told apart by colour only. */
export function fmtSigned(n: number): string {
  return (n >= 0 ? '+' : '−') + fmtMoney(n)
}

function fmtInvoiceDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDay(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function ledgerDay(e: LedgerEntry): string {
  return fmtDay(e.date_of_payment ?? e.invoice_date ?? e.created_at.slice(0, 10))
}

const INVOICE_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  paid:          { label: 'Paid',          tone: 'success' },
  open:          { label: 'Open',          tone: 'info' },
  void:          { label: 'Void',          tone: 'neutral' },
  draft:         { label: 'Draft',         tone: 'neutral' },
  uncollectible: { label: 'Uncollectible', tone: 'danger' },
}

export function InvoiceStatus({ status }: { status: string | null }) {
  const s = status ?? ''
  const d = INVOICE_STATUS[s] ?? { label: s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Unknown', tone: 'warning' as const }
  return <StatusBadge tone={d.tone}>{d.label}</StatusBadge>
}

function AchStatus({ status }: { status: string | null }) {
  if (status === 'pending') return <StatusBadge tone="warning">Pending</StatusBadge>
  if (status) return <StatusBadge tone="success">Cleared</StatusBadge>
  return null
}

// ─── rows (shared with the Overview tab) ─────────────────────────────────────

export function InvoiceRow({ inv }: { inv: Invoice }) {
  const title = inv.description || (inv.number ? `Invoice ${inv.number}` : 'Invoice')
  return (
    <div className="ui-row co-money-row">
      <Tile size="sm"><Receipt size={15} /></Tile>
      <span className="ui-row-text">
        <span className="ui-row-title"><span className="co-ellipsis">{title}</span></span>
        <span className="ui-row-sub">
          {fmtInvoiceDate(inv.date)}
          {inv.number && inv.description && <span className="co-dot">{inv.number}</span>}
        </span>
      </span>
      <span className="ui-row-actions">
        <span className="ui-hide-sm"><InvoiceStatus status={inv.status} /></span>
        <span className="co-amount">{fmtMoney(inv.amount)}</span>
        {inv.hosted_url && (
          <a href={inv.hosted_url} target="_blank" rel="noopener noreferrer" className="co-iconbtn" aria-label={`Open ${title} in Stripe (new tab)`} title="Open in Stripe">
            <ArrowSquareOut size={15} aria-hidden />
          </a>
        )}
      </span>
    </div>
  )
}

/** showAch: the cleared/pending badge on every line (the Billing tab); otherwise only pending shows. */
export function LedgerRow({ entry, showAch }: { entry: LedgerEntry; showAch?: boolean }) {
  const pending = entry.ach_status === 'pending'
  const credit  = entry.amount_af >= 0
  return (
    <div className="ui-row co-money-row">
      <Tile size="sm" tone={credit ? 'green' : 'red'}><GasPump size={15} /></Tile>
      <span className="ui-row-text">
        <span className="ui-row-title">
          <span className="co-ellipsis">{entry.note || entry.type || 'Ad Fuel entry'}</span>
        </span>
        <span className="ui-row-sub" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {ledgerDay(entry)}
          {entry.type && <StatusBadge dot={false}>{entry.type}</StatusBadge>}
          {showAch ? <AchStatus status={entry.ach_status} /> : pending && <StatusBadge tone="warning">Pending ACH</StatusBadge>}
        </span>
      </span>
      <span className="ui-row-actions">
        <span className={`co-amount ${credit ? 'co-pos' : 'co-neg'}${pending ? ' co-pending-amt' : ''}`}>{fmtSigned(entry.amount_af)}</span>
      </span>
    </div>
  )
}

function SectionSk({ children }: { children: React.ReactNode }) {
  return (
    <div className="card ui-section" aria-hidden>
      <div className="ui-section-head">
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}><Sk w={150} h={14} /><Sk w="55%" h={11} /></div>
      </div>
      <div className="ui-section-body">{children}</div>
    </div>
  )
}

// ─── tab ──────────────────────────────────────────────────────────────────────

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
    setError('')
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/billing`)
      if (!res.ok) throw new Error('Billing couldn’t load.')
      const data = await res.json()
      setInvoices(data.invoices ?? [])
      setLedger(data.ledger ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Billing couldn’t load.')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  async function saveCut(overrideValue?: number | null) {
    setCutSaving(true)
    setCutMsg('')
    const parsed = overrideValue !== undefined
      ? overrideValue
      : (cutValue === '' ? null : parseFloat(cutValue) / 100)
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
      setCutMsg('Couldn’t save')
    } finally {
      setCutSaving(false)
    }
  }

  const globalPct = (globalCut * 100).toFixed(1)

  if (loading) {
    return (
      <div className="ui-stack co-billing" aria-busy="true" aria-label="Loading billing">
        <SectionSk><div style={{ display: 'flex', gap: 10 }}><Sk w={132} h={36} r={8} /><Sk w={90} h={32} r={6} /></div></SectionSk>
        <SectionSk><SkTable rows={2} cols={5} /></SectionSk>
        <SectionSk><SkTable rows={5} cols={5} /></SectionSk>
      </div>
    )
  }

  if (error) {
    return (
      <div className="co-billing">
        <div className="ui-notice ui-notice--danger" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => load()}>Try again</button>
        </div>
      </div>
    )
  }

  const integrationsHref = `/admin/clients/${clientId}?tab=sources`

  return (
    <div className="ui-stack co-billing co-scope">

      <Section
        title="Ad Fuel cut"
        description={<>This client’s margin. Ad Fuel spend = raw spend ÷ (1 − cut). Leave it blank to use the agency default of {globalPct}%.</>}
      >
        <div className="co-cut">
          <label className="co-cut-input">
            <span className="sr-only">Ad Fuel cut, percent</span>
            <input
              type="number" min="0" max="99" step="0.1"
              value={cutValue}
              onChange={e => setCutValue(e.target.value)}
              placeholder={`${globalPct} (default)`}
              className="input"
            />
            <span aria-hidden>%</span>
          </label>
          <button type="button" onClick={() => saveCut()} disabled={cutSaving} className="btn btn-primary btn-sm">
            {cutSaving ? 'Saving…' : 'Save cut'}
          </button>
          {cutValue !== '' && (
            <button
              type="button"
              onClick={() => { setCutValue(''); saveCut(null) }}
              disabled={cutSaving}
              className="btn btn-secondary btn-sm"
            >
              Use agency default
            </button>
          )}
          <span role="status" className={`co-status ${cutMsg === 'Saved' ? 'co-status--ok' : 'co-status--err'}`}>{cutMsg}</span>
        </div>
      </Section>

      <Section title="Stripe invoices" description="Every invoice on the client’s Stripe customer, newest first." flush>
        {invoices.length === 0 ? (
          <p className="co-empty">
            No Stripe invoices. Add the client’s Stripe customer ID under <Link href={integrationsHref}>Integrations</Link> to link billing.
          </p>
        ) : (
          <>
            <div className="ui-scroll-x ui-hide-sm">
              <table className="ui-table co-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Invoice</th>
                    <th>Description</th>
                    <th className="ui-r">Amount</th>
                    <th>Status</th>
                    <th aria-label="Link" />
                  </tr>
                </thead>
                <tbody>
                  {invoices.map(inv => (
                    <tr key={inv.id}>
                      <td className="co-num">{fmtInvoiceDate(inv.date)}</td>
                      <td className="co-num">{inv.number ?? '—'}</td>
                      <td className="ui-strong co-table-desc" title={inv.description ?? undefined}>{inv.description ?? '—'}</td>
                      <td className="ui-r ui-strong co-num">{fmtMoney(inv.amount)}</td>
                      <td><InvoiceStatus status={inv.status} /></td>
                      <td className="ui-r">
                        {inv.hosted_url && (
                          <a href={inv.hosted_url} target="_blank" rel="noopener noreferrer">
                            View<ArrowSquareOut size={12} aria-label="opens in a new tab" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ui-only-sm">
              {invoices.map(inv => <InvoiceRow key={inv.id} inv={inv} />)}
            </div>
          </>
        )}
      </Section>

      <Section title="Ad Fuel ledger" description="Payments in and charges out. Pending ACH payments count once they clear." flush>
        {ledger.length === 0 ? (
          <p className="co-empty">No ledger entries yet.</p>
        ) : (
          <>
            <div className="ui-scroll-x ui-hide-sm">
              <table className="ui-table co-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Note</th>
                    <th className="ui-r">Amount</th>
                    <th>ACH</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map(entry => {
                    const isPending = entry.ach_status === 'pending'
                    return (
                      <tr key={entry.id} className={isPending ? 'co-pending' : undefined}>
                        <td className="co-num">{ledgerDay(entry)}</td>
                        <td>{entry.type ? <StatusBadge dot={false}>{entry.type}</StatusBadge> : '—'}</td>
                        <td className="co-table-desc" title={entry.note ?? undefined}>{entry.note ?? '—'}</td>
                        <td className={`ui-r co-num co-amount ${entry.amount_af >= 0 ? 'co-pos' : 'co-neg'}`}>{fmtSigned(entry.amount_af)}</td>
                        <td className="co-keep"><AchStatus status={entry.ach_status} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="ui-only-sm">
              {ledger.map(entry => <LedgerRow key={entry.id} entry={entry} showAch />)}
            </div>
          </>
        )}
      </Section>
    </div>
  )
}
