'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import CopyButton from '@/components/CopyButton'
import ClientNotesStream from '@/components/admin/ClientNotesStream'
import ClientLogoUpload from './ClientLogoUpload'

interface AdminUser {
  id:         string
  name:       string
  email:      string
  avatar_url?: string | null
}

interface Contact {
  id:    string
  name:  string
  email: string | null
  phone: string | null
  role:  string
}

interface Stats {
  adFuelBalance:        number | null
  pendingAch:           number
  mtdSpend:             number | null
  siteUptime7d:         number | null
  contentPipelineCount: number
}

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
  created_at:      string
}

interface Props {
  clientId:         string
  name:             string
  address:          string | null
  phone:            string | null
  website:          string | null
  logoUrl:          string | null
  accountManagerId: string | null
  adminUsers:       AdminUser[]
  contacts:         Contact[]
  dashUrl:          string
  adsLibraryUrl:    string | null
}

function fmt$(n: number | null): string {
  if (n == null) return '—'
  const abs = Math.abs(n)
  const formatted = abs >= 1000
    ? '$' + (abs / 1000).toFixed(1) + 'k'
    : '$' + abs.toFixed(0)
  return n < 0 ? '-' + formatted : formatted
}

function fmtNum(n: number | null): string {
  if (n == null) return '—'
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n)
}

function fmtInvoiceDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtLedgerDate(s: string | null): string {
  if (!s) return '—'
  return new Date(s + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function normalizeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

export default function OverviewTab({
  clientId, name, address, phone, website, logoUrl,
  accountManagerId, adminUsers, contacts: initialContacts,
  dashUrl, adsLibraryUrl,
}: Props) {
  const router = useRouter()

  // ── Lazy-load stats ───────────────────────────────────────────────────────
  const [stats, setStats]           = useState<Stats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/admin/clients/${clientId}/overview-stats`)
      .then(r => r.ok ? r.json() : null)
      .then((data: Stats | null) => { if (data) setStats(data) })
      .catch(() => {})
      .finally(() => setStatsLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Business info editing ─────────────────────────────────────────────────
  const [editingBiz,    setEditingBiz]    = useState(false)
  const [bizForm,       setBizForm]       = useState({ name, address: address ?? '', phone: phone ?? '', website: website ?? '', logoUrl: logoUrl ?? '' })
  const [displayLogoUrl, setDisplayLogoUrl] = useState(logoUrl ?? '')
  const [bizSaving,  setBizSaving]  = useState(false)
  const [bizError,   setBizError]   = useState('')

  async function saveBiz(e: React.FormEvent) {
    e.preventDefault()
    setBizSaving(true)
    setBizError('')
    try {
      const res = await fetch(`/api/admin/clients/${clientId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:     bizForm.name     || undefined,
          address:  bizForm.address  || null,
          phone:    bizForm.phone    || null,
          website:  bizForm.website  || null,
          logo_url: bizForm.logoUrl  || null,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed')
      setEditingBiz(false)
      router.refresh()
    } catch (err) {
      setBizError(err instanceof Error ? err.message : 'Error saving')
    } finally {
      setBizSaving(false)
    }
  }

  // ── Account manager ───────────────────────────────────────────────────────
  const [mgr,       setMgr]       = useState(accountManagerId)
  const [mgrSaving, setMgrSaving] = useState(false)

  async function saveManager(newId: string | null) {
    const prev = mgr
    setMgr(newId)
    setMgrSaving(true)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ account_manager_id: newId }),
      })
      if (!res.ok) throw new Error('Save failed')
      router.refresh()
    } catch {
      setMgr(prev)
    } finally {
      setMgrSaving(false)
    }
  }

  const currentMgr = adminUsers.find(u => u.id === mgr) ?? null

  // ── Contacts ──────────────────────────────────────────────────────────────
  const [contacts,      setContacts]      = useState<Contact[]>(initialContacts)
  const [addingContact, setAddingContact] = useState(false)
  const [contactForm,   setContactForm]   = useState({ name: '', email: '', phone: '', role: 'contact' })
  const [contactSaving, setContactSaving] = useState(false)
  const [contactError,  setContactError]  = useState('')

  async function addContact(e: React.FormEvent) {
    e.preventDefault()
    if (!contactForm.name.trim()) return
    setContactSaving(true)
    setContactError('')
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/contacts`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:  contactForm.name.trim(),
          email: contactForm.email.trim() || null,
          phone: contactForm.phone.trim() || null,
          role:  contactForm.role,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      const created = await res.json()
      setContacts(prev => [...prev, created])
      setContactForm({ name: '', email: '', phone: '', role: 'contact' })
      setAddingContact(false)
    } catch (err) {
      setContactError(err instanceof Error ? err.message : 'Error')
    } finally {
      setContactSaving(false)
    }
  }

  async function deleteContact(contactId: string) {
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/contacts/${contactId}`, { method: 'DELETE' })
      if (res.ok) setContacts(prev => prev.filter(c => c.id !== contactId))
    } catch {
      // leave contact in list on network failure
    }
  }

  const roleLabel = (r: string) =>
    r === 'primary' ? 'Primary' : r === 'billing' ? 'Billing' : 'Contact'

  const roleColor = (r: string) =>
    r === 'primary' ? { bg: '#dbeafe', color: '#1d4ed8' }
    : r === 'billing' ? { bg: '#fef3c7', color: '#92400e' }
    : { bg: 'var(--bg-subtle)', color: 'var(--text-muted)' }

  // ── Billing data (invoices + ledger) ─────────────────────────────────────
  const [invoices,       setInvoices]       = useState<Invoice[]>([])
  const [billingLedger,  setBillingLedger]  = useState<LedgerEntry[]>([])
  const [billingLoading, setBillingLoading] = useState(true)

  const loadBilling = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/billing`)
      if (!res.ok) { console.error('Billing fetch failed:', res.status); return }
      const data = await res.json()
      setInvoices(data.invoices ?? [])
      setBillingLedger(data.ledger ?? [])
    } finally {
      setBillingLoading(false)
    }
  }, [clientId])

  useEffect(() => { loadBilling() }, [loadBilling])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: '1.5rem', alignItems: 'start' }}>

      {/* ── LEFT COLUMN ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

        {/* Business info card */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="section-title">Business Info</h2>
            {!editingBiz && (
              <button
                onClick={() => setEditingBiz(true)}
                className="btn btn-secondary"
                style={{ padding: '0.25rem 0.625rem', fontSize: '0.75rem' }}
              >
                Edit
              </button>
            )}
          </div>

          {editingBiz ? (
            <form onSubmit={saveBiz} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {bizError && <p style={{ color: 'var(--red)', fontSize: '0.75rem' }}>{bizError}</p>}
              {([
                { key: 'name',    label: 'Business Name', required: true  },
                { key: 'address', label: 'Address',       required: false },
                { key: 'phone',   label: 'Phone',         required: false },
                { key: 'website', label: 'Website',       required: false },
              ] as const).map(f => (
                <div key={f.key}>
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>{f.label}</label>
                  <input
                    className="input"
                    value={bizForm[f.key]}
                    onChange={e => setBizForm(v => ({ ...v, [f.key]: e.target.value }))}
                    required={f.required}
                    placeholder={f.label}
                  />
                </div>
              ))}
              <div className="flex items-center gap-2">
                <button type="submit" disabled={bizSaving} className="btn btn-primary" style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem' }}>
                  {bizSaving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className="btn btn-secondary" style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem' }}
                  onClick={() => { setEditingBiz(false); setBizForm({ name, address: address ?? '', phone: phone ?? '', website: website ?? '', logoUrl: logoUrl ?? '' }) }}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
              <InfoRow label="Business Name" value={name} bold />
              <InfoRow label="Address"  value={address} />
              <InfoRow label="Phone"    value={phone} />
              <InfoRow label="Website"  value={website} link />
            </div>
          )}

          {/* Logo upload — always visible, saves directly to clients table */}
          <div style={{ marginTop: '1rem', paddingTop: '0.875rem', borderTop: '1px solid var(--border)' }}>
            <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Client Logo</p>
            <ClientLogoUpload
              clientId={clientId}
              currentLogoUrl={displayLogoUrl}
              onUpload={url => { setDisplayLogoUrl(url); setBizForm(v => ({ ...v, logoUrl: url })) }}
            />
          </div>
        </div>

        {/* Notes card */}
        <div className="card p-5">
          <ClientNotesStream clientId={clientId} />
        </div>

        {/* Contacts card */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="section-title">Contacts</h2>
            {!addingContact && (
              <button
                onClick={() => setAddingContact(true)}
                className="btn btn-secondary"
                style={{ padding: '0.25rem 0.625rem', fontSize: '0.75rem' }}
              >
                + Add
              </button>
            )}
          </div>

          {contacts.length === 0 && !addingContact && (
            <p className="text-sm" style={{ color: 'var(--text-faint)' }}>No contacts added yet.</p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {contacts.map(contact => {
              const rc = roleColor(contact.role)
              return (
                <div
                  key={contact.id}
                  className="flex items-start justify-between gap-3 rounded-lg px-3 py-2.5"
                  style={{ background: 'var(--bg-subtle)' }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{contact.name}</span>
                      <span style={{
                        fontSize: '0.6rem', fontWeight: 700, padding: '1px 6px', borderRadius: 999,
                        background: rc.bg, color: rc.color, textTransform: 'uppercase', letterSpacing: '0.04em',
                      }}>
                        {roleLabel(contact.role)}
                      </span>
                    </div>
                    {contact.email && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{contact.email}</p>}
                    {contact.phone && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{contact.phone}</p>}
                  </div>
                  <button
                    onClick={() => deleteContact(contact.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: '0.75rem', padding: '0.125rem 0.25rem', flexShrink: 0 }}
                    title="Remove contact"
                  >
                    ✕
                  </button>
                </div>
              )
            })}
          </div>

          {addingContact && (
            <form onSubmit={addContact} style={{ marginTop: contacts.length > 0 ? '0.75rem' : 0, display: 'flex', flexDirection: 'column', gap: '0.625rem', padding: '0.875rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>New Contact</p>
              {contactError && <p style={{ color: 'var(--red)', fontSize: '0.7rem' }}>{contactError}</p>}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <label className="text-xs block mb-0.5" style={{ color: 'var(--text-muted)' }}>Name *</label>
                  <input className="input" value={contactForm.name} onChange={e => setContactForm(v => ({ ...v, name: e.target.value }))} required placeholder="Full name" />
                </div>
                <div>
                  <label className="text-xs block mb-0.5" style={{ color: 'var(--text-muted)' }}>Role</label>
                  <select className="input" value={contactForm.role} onChange={e => setContactForm(v => ({ ...v, role: e.target.value }))}>
                    <option value="contact">Contact</option>
                    <option value="primary">Primary</option>
                    <option value="billing">Billing</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs block mb-0.5" style={{ color: 'var(--text-muted)' }}>Email</label>
                  <input className="input" type="email" value={contactForm.email} onChange={e => setContactForm(v => ({ ...v, email: e.target.value }))} placeholder="email@example.com" />
                </div>
                <div>
                  <label className="text-xs block mb-0.5" style={{ color: 'var(--text-muted)' }}>Phone</label>
                  <input className="input" value={contactForm.phone} onChange={e => setContactForm(v => ({ ...v, phone: e.target.value }))} placeholder="(555) 555-5555" />
                </div>
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={contactSaving} className="btn btn-primary" style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem' }}>
                  {contactSaving ? 'Adding…' : 'Add Contact'}
                </button>
                <button type="button" className="btn btn-secondary" style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem' }}
                  onClick={() => { setAddingContact(false); setContactError(''); setContactForm({ name: '', email: '', phone: '', role: 'contact' }) }}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Stripe invoice history */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="section-title">Invoice History</h2>
            <a
              href={`/admin/clients/${clientId}?tab=billing`}
              className="text-xs"
              style={{ color: 'var(--blue)' }}
            >
              View all →
            </a>
          </div>

          {billingLoading ? (
            <p className="text-sm" style={{ color: 'var(--text-faint)' }}>Loading…</p>
          ) : invoices.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
              No Stripe invoices. Set a Stripe Customer ID in Integrations to link billing.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              {invoices.slice(0, 5).map(inv => (
                <div
                  key={inv.id}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
                    padding: '0.5rem 0.75rem', borderRadius: 8, background: 'var(--bg-subtle)',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {fmtInvoiceDate(inv.date)}
                      </span>
                      <InvoiceStatusBadge status={inv.status} />
                    </div>
                    {inv.description && (
                      <p className="text-xs" style={{ color: 'var(--text-faint)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {inv.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
                    <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      ${inv.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    {inv.hosted_url && (
                      <a href={inv.hosted_url} target="_blank" rel="noopener noreferrer"
                         className="text-xs" style={{ color: 'var(--blue)' }}>↗</a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Ad Fuel ledger (recent entries) */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="section-title">Ad Fuel Ledger</h2>
            <a
              href={`/admin/clients/${clientId}?tab=billing`}
              className="text-xs"
              style={{ color: 'var(--blue)' }}
            >
              View all →
            </a>
          </div>

          {billingLoading ? (
            <p className="text-sm" style={{ color: 'var(--text-faint)' }}>Loading…</p>
          ) : billingLedger.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-faint)' }}>No ledger entries yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              {billingLedger.slice(0, 5).map(entry => {
                const isPending = entry.ach_status === 'pending'
                const dateStr = entry.date_of_payment ?? entry.invoice_date ?? entry.created_at.slice(0, 10)
                return (
                  <div
                    key={entry.id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
                      padding: '0.5rem 0.75rem', borderRadius: 8, background: 'var(--bg-subtle)',
                      opacity: isPending ? 0.6 : 1,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="flex items-center gap-2">
                        <span className="text-xs" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {fmtLedgerDate(dateStr)}
                        </span>
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
                        <p className="text-xs" style={{ color: 'var(--text-faint)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {entry.note}
                        </p>
                      )}
                    </div>
                    <span style={{ fontSize: '0.875rem', fontWeight: 700, color: entry.amount_af >= 0 ? 'var(--green)' : 'var(--red)', flexShrink: 0 }}>
                      {entry.amount_af >= 0 ? '+' : ''}${Math.abs(entry.amount_af).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT COLUMN ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

        {/* Key stats */}
        <div className="card p-5">
          <h2 className="section-title mb-3">At a Glance</h2>
          {statsLoading ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              {[0,1,2,3].map(i => (
                <div key={i} style={{ height: 56, borderRadius: 8, background: 'var(--bg-subtle)', animation: 'pulse 1.5s ease-in-out infinite' }} />
              ))}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <StatTile
                  label="Ad Fuel Balance"
                  value={stats?.adFuelBalance != null
                    ? `${stats.adFuelBalance < 0 ? '-' : ''}$${Math.abs(stats.adFuelBalance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : '—'}
                  valueColor={stats?.adFuelBalance != null && stats.adFuelBalance < 0 ? 'var(--red)' : stats?.adFuelBalance != null && stats.adFuelBalance < 200 ? '#d97706' : 'var(--green)'}
                />
                {stats != null && (stats.pendingAch ?? 0) > 0 && (() => {
                  const proj = (stats.adFuelBalance ?? 0) + stats.pendingAch
                  return (
                    <p style={{ fontSize: '0.7rem', marginTop: 2, color: proj >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {proj >= 0 ? '' : '-'}${Math.abs(proj).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} projected
                    </p>
                  )
                })()}
              </div>
              <StatTile
                label="MTD Spend (raw)"
                value={fmt$(stats?.mtdSpend ?? null)}
              />
              <StatTile
                label="Site Uptime (7d)"
                value={stats?.siteUptime7d != null ? `${stats.siteUptime7d.toFixed(1)}%` : '—'}
                valueColor={stats?.siteUptime7d == null ? 'var(--text-faint)' : stats.siteUptime7d >= 99 ? 'var(--green)' : stats.siteUptime7d >= 95 ? '#d97706' : 'var(--red)'}
              />
              <StatTile
                label="Content Pipeline"
                value={String(stats?.contentPipelineCount ?? 0)}
                valueColor={(stats?.contentPipelineCount ?? 0) > 0 ? 'var(--blue)' : 'var(--text-muted)'}
              />
            </div>
          )}
        </div>

        {/* Account manager */}
        <div className="card p-5">
          <h2 className="section-title mb-3">Account Manager</h2>
          {currentMgr ? (
            <div className="flex items-center gap-3 mb-3">
              {currentMgr.avatar_url ? (
                <img src={currentMgr.avatar_url} alt={currentMgr.name} style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
              ) : (
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--blue)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 700, flexShrink: 0 }}>
                  {currentMgr.name.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{currentMgr.name}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{currentMgr.email}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm mb-3" style={{ color: 'var(--text-faint)' }}>Unassigned</p>
          )}
          <select
            className="input w-full"
            value={mgr ?? ''}
            onChange={e => saveManager(e.target.value || null)}
            disabled={mgrSaving}
            style={{ fontSize: '0.8125rem' }}
          >
            <option value="">— Unassigned —</option>
            {adminUsers.map(u => (
              <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
            ))}
          </select>
        </div>

        {/* Dashboard link */}
        <div className="card p-5">
          <h2 className="section-title mb-1">Dashboard Link</h2>
          <p className="section-desc mb-3">Share with the client to access their reporting dashboard.</p>
          <div
            className="flex items-center gap-2 rounded-lg px-3 py-2.5"
            style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)' }}
          >
            <span className="text-xs font-mono truncate flex-1" style={{ color: 'var(--text-muted)' }}>
              {dashUrl}
            </span>
            <CopyButton text={dashUrl} />
          </div>
        </div>

        {/* Ad Library link */}
        {adsLibraryUrl && (
          <div className="card p-5">
            <h2 className="section-title mb-1">Ad Library Link</h2>
            <p className="section-desc mb-3">Direct link to this client&apos;s ad creative library.</p>
            <div
              className="flex items-center gap-2 rounded-lg px-3 py-2.5"
              style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)' }}
            >
              <span className="text-xs font-mono truncate flex-1" style={{ color: 'var(--text-muted)' }}>
                {adsLibraryUrl}
              </span>
              <CopyButton text={adsLibraryUrl} />
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function InfoRow({ label, value, bold, link }: { label: string; value: string | null; bold?: boolean; link?: boolean }) {
  if (!value) return (
    <div>
      <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{label}</p>
      <p className="text-sm" style={{ color: 'var(--text-faint)' }}>—</p>
    </div>
  )
  return (
    <div>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</p>
      {link ? (
        <a href={normalizeUrl(value)} target="_blank" rel="noopener noreferrer" className="text-sm" style={{ color: 'var(--blue)' }}>
          {value}
        </a>
      ) : (
        <p className={`text-sm ${bold ? 'font-semibold' : ''}`} style={{ color: 'var(--text-primary)' }}>{value}</p>
      )}
    </div>
  )
}

function StatTile({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ padding: '0.75rem', borderRadius: 8, background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}>
      <p style={{ fontSize: '0.625rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)', fontWeight: 600, marginBottom: '0.25rem' }}>
        {label}
      </p>
      <p style={{ fontSize: '1.125rem', fontWeight: 700, color: valueColor ?? 'var(--text-primary)', lineHeight: 1.2 }}>
        {value}
      </p>
    </div>
  )
}

function InvoiceStatusBadge({ status }: { status: string | null }) {
  const s = status ?? ''
  const style = s === 'paid' ? { bg: '#dcfce7', color: '#166534' }
    : s === 'open'   ? { bg: '#dbeafe', color: '#1e40af' }
    : s === 'void'   ? { bg: '#f3f4f6', color: '#6b7280' }
    : { bg: '#fef3c7', color: '#92400e' }
  return (
    <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: '0.6rem', fontWeight: 700, background: style.bg, color: style.color }}>
      {s || 'unknown'}
    </span>
  )
}
