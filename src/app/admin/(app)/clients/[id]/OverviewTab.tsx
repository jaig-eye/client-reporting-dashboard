'use client'

// Client → Overview, the tab a client page opens on. Main column: business info, contacts,
// relationship, notes, and the latest invoices and Ad Fuel lines. Rail: the numbers at a glance and
// the account manager. On a tablet or phone the rail stacks first.
//
// The dashboard and ad library links that used to sit in the rail live in the page header's ⋯
// menu now (with copy buttons), so they are not repeated here.

import '@/styles/admin/client-overview.css'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { PencilSimple, Plus, Trash, ArrowSquareOut, CaretRight } from '@phosphor-icons/react'
import ClientNotesStream from '@/components/admin/ClientNotesStream'
import Section from '@/components/ui/Section'
import StatusBadge, { type StatusTone } from '@/components/ui/StatusBadge'
import { Sk, SkRows } from '@/components/ui/Skeleton'
import ClientLogoUpload from './ClientLogoUpload'
import ClientRelationshipCard from './ClientRelationshipCard'
import { InvoiceRow, LedgerRow, fmtMoney, type Invoice, type LedgerEntry } from './BillingTab'
import type { ClientTemperature } from '@/lib/types'

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

interface Props {
  clientId:         string
  name:             string
  address:          string | null
  phone:            string | null
  website:          string | null
  logoUrl:          string | null
  accountManagerId: string | null
  temperature:      ClientTemperature | null
  lastContactedAt:  string | null
  contactStaleDays: number | null
  agencyStaleDays:  number
  adminUsers:       AdminUser[]
  contacts:         Contact[]
  /** No longer used: the header's ⋯ menu carries the dashboard link. page.tsx still passes it. */
  dashUrl?:         string
  /** No longer used: the header's ⋯ menu carries the ad library link. page.tsx still passes it. */
  adsLibraryUrl?:   string | null
}

function fmt$(n: number | null): string {
  if (n == null) return '—'
  const abs = Math.abs(n)
  const formatted = abs >= 1000
    ? '$' + (abs / 1000).toFixed(1) + 'k'
    : '$' + abs.toFixed(0)
  return n < 0 ? '-' + formatted : formatted
}

function normalizeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?'
}

const ROLE: Record<string, { label: string; tone: StatusTone }> = {
  primary: { label: 'Primary', tone: 'info' },
  billing: { label: 'Billing', tone: 'warning' },
}

export default function OverviewTab({
  clientId, name, address, phone, website, logoUrl,
  accountManagerId, adminUsers, contacts: initialContacts,
  temperature, lastContactedAt, contactStaleDays, agencyStaleDays,
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

  function cancelBiz() {
    setEditingBiz(false)
    setBizError('')
    setBizForm({ name, address: address ?? '', phone: phone ?? '', website: website ?? '', logoUrl: logoUrl ?? '' })
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

  const billingHref = `/admin/clients/${clientId}?tab=billing`

  // ── At a glance ───────────────────────────────────────────────────────────
  const afBalance = stats?.adFuelBalance ?? null
  const afTone = afBalance == null ? 'co-faint' : afBalance < 0 ? 'co-neg' : afBalance < 200 ? 'co-warn' : 'co-pos'
  const projected = stats != null && (stats.pendingAch ?? 0) > 0 ? (stats.adFuelBalance ?? 0) + stats.pendingAch : null
  const uptime = stats?.siteUptime7d ?? null
  const uptimeTone = uptime == null ? 'co-faint' : uptime >= 99 ? 'co-pos' : uptime >= 95 ? 'co-warn' : 'co-neg'
  const pipeline = stats?.contentPipelineCount ?? 0

  return (
    <div className="ui-grid-side co-scope">

      {/* ── Main column ──────────────────────────────────────────────── */}
      <div className="ui-stack">

        <Section
          title="Business info"
          description={editingBiz ? 'The name, address and links shown on the client’s dashboard and reports.' : undefined}
          actions={!editingBiz && (
            <button type="button" onClick={() => setEditingBiz(true)} className="btn btn-secondary btn-sm">
              <PencilSimple size={14} aria-hidden />Edit
            </button>
          )}
        >
          {editingBiz ? (
            <form onSubmit={saveBiz} className="ui-stack" style={{ gap: 14 }}>
              {bizError && <div className="ui-notice ui-notice--danger" role="alert" style={{ margin: 0 }}>{bizError}</div>}
              <div className="co-fields">
                {([
                  { key: 'name',    label: 'Business name', required: true,  type: 'text' },
                  { key: 'phone',   label: 'Phone',         required: false, type: 'tel'  },
                  { key: 'address', label: 'Address',       required: false, type: 'text' },
                  { key: 'website', label: 'Website',       required: false, type: 'text' },
                ] as const).map(f => (
                  <div key={f.key} className="co-field">
                    <label className="co-label" htmlFor={`biz-${f.key}`}>{f.label}</label>
                    <input
                      id={`biz-${f.key}`}
                      className="input"
                      type={f.type}
                      value={bizForm[f.key]}
                      onChange={e => setBizForm(v => ({ ...v, [f.key]: e.target.value }))}
                      required={f.required}
                      placeholder={f.key === 'website' ? 'example.com' : undefined}
                    />
                  </div>
                ))}
              </div>

              <div>
                <p className="co-label">Logo</p>
                <ClientLogoUpload
                  clientId={clientId}
                  currentLogoUrl={displayLogoUrl}
                  onUpload={url => { setDisplayLogoUrl(url); setBizForm(v => ({ ...v, logoUrl: url })) }}
                />
              </div>

              <div className="co-divider" />
              <div className="co-actions">
                <button type="submit" disabled={bizSaving} className="btn btn-primary btn-sm">
                  {bizSaving ? 'Saving…' : 'Save changes'}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={cancelBiz}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              {displayLogoUrl && <img src={displayLogoUrl} alt={`${name} logo`} className="co-biz-logo" />}
              <dl className="co-facts">
                <Fact label="Business name" value={name} strong />
                <Fact label="Phone" value={phone} />
                <Fact label="Address" value={address} />
                <Fact label="Website" value={website} href={website ? normalizeUrl(website) : undefined} />
              </dl>
            </>
          )}
        </Section>

        <Section
          title="Contacts"
          description="Who we talk to at the client, and who gets the bills."
          flush
          actions={!addingContact && (
            <button type="button" onClick={() => setAddingContact(true)} className="btn btn-secondary btn-sm">
              <Plus size={14} weight="bold" aria-hidden />Add contact
            </button>
          )}
        >
          {contacts.length === 0 && !addingContact && (
            <p className="co-empty">No contacts yet. Add the client’s main contact and whoever pays the invoices.</p>
          )}

          {contacts.map(contact => {
            const role = ROLE[contact.role]
            return (
              <div key={contact.id} className="ui-row co-money-row">
                <span className="co-avatar" aria-hidden>{initials(contact.name)}</span>
                <span className="ui-row-text">
                  <span className="ui-row-title">
                    {contact.name}
                    {role
                      ? <StatusBadge tone={role.tone} dot={false}>{role.label}</StatusBadge>
                      : <StatusBadge dot={false}>Contact</StatusBadge>}
                  </span>
                  {(contact.email || contact.phone) && (
                    <span className="ui-row-sub co-row-sub">
                      {contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
                      {contact.email && contact.phone && <span className="co-dot" aria-hidden />}
                      {contact.phone && <span className="co-nowrap">{contact.phone}</span>}
                    </span>
                  )}
                </span>
                <span className="ui-row-actions">
                  <button
                    type="button"
                    onClick={() => deleteContact(contact.id)}
                    className="co-iconbtn co-iconbtn--danger"
                    aria-label={`Remove ${contact.name}`}
                    title="Remove contact"
                  >
                    <Trash size={15} aria-hidden />
                  </button>
                </span>
              </div>
            )
          })}

          {addingContact && (
            <div className="co-section-pad" style={{ paddingTop: contacts.length > 0 ? 12 : 0 }}>
              <form onSubmit={addContact} className="co-subform">
                <p className="co-subform-title">New contact</p>
                {contactError && <div className="ui-notice ui-notice--danger" role="alert" style={{ margin: 0 }}>{contactError}</div>}
                <div className="co-fields">
                  <div className="co-field">
                    <label className="co-label" htmlFor="contact-name">Name</label>
                    <input id="contact-name" className="input" value={contactForm.name} onChange={e => setContactForm(v => ({ ...v, name: e.target.value }))} required placeholder="Full name" autoFocus />
                  </div>
                  <div className="co-field">
                    <label className="co-label" htmlFor="contact-role">Role</label>
                    <select id="contact-role" className="input" value={contactForm.role} onChange={e => setContactForm(v => ({ ...v, role: e.target.value }))}>
                      <option value="contact">Contact</option>
                      <option value="primary">Primary</option>
                      <option value="billing">Billing</option>
                    </select>
                  </div>
                  <div className="co-field">
                    <label className="co-label" htmlFor="contact-email">Email</label>
                    <input id="contact-email" className="input" type="email" value={contactForm.email} onChange={e => setContactForm(v => ({ ...v, email: e.target.value }))} placeholder="name@example.com" />
                  </div>
                  <div className="co-field">
                    <label className="co-label" htmlFor="contact-phone">Phone</label>
                    <input id="contact-phone" className="input" type="tel" value={contactForm.phone} onChange={e => setContactForm(v => ({ ...v, phone: e.target.value }))} placeholder="(555) 555-5555" />
                  </div>
                </div>
                <div className="co-actions">
                  <button type="submit" disabled={contactSaving} className="btn btn-primary btn-sm">
                    {contactSaving ? 'Adding…' : 'Add contact'}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm"
                    onClick={() => { setAddingContact(false); setContactError(''); setContactForm({ name: '', email: '', phone: '', role: 'contact' }) }}>
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}
        </Section>

        {/* Relationship: attention level + last contact */}
        <ClientRelationshipCard
          clientId={clientId}
          temperature={temperature}
          lastContactedAt={lastContactedAt}
          contactStaleDays={contactStaleDays}
          agencyStaleDays={agencyStaleDays}
        />

        <ClientNotesStream
          clientId={clientId}
          // A contact-log note stamps last_contacted_at server-side; refresh so
          // the Relationship card above reflects it without a manual reload.
          onContactLogged={() => router.refresh()}
        />

        <Section
          title="Invoices"
          description="The latest Stripe invoices."
          flush
          actions={<Link href={billingHref} className="co-link">All billing<CaretRight size={12} weight="bold" aria-hidden /></Link>}
        >
          {billingLoading ? (
            <SkRows rows={2} />
          ) : invoices.length === 0 ? (
            <p className="co-empty">
              No Stripe invoices. Add the client’s Stripe customer ID under <Link href={`/admin/clients/${clientId}?tab=sources`}>Integrations</Link> to link billing.
            </p>
          ) : (
            invoices.slice(0, 5).map(inv => <InvoiceRow key={inv.id} inv={inv} />)
          )}
        </Section>

        <Section
          title="Ad Fuel ledger"
          description="The latest payments in and charges out."
          flush
          actions={<Link href={billingHref} className="co-link">Full ledger<CaretRight size={12} weight="bold" aria-hidden /></Link>}
        >
          {billingLoading ? (
            <SkRows rows={3} />
          ) : billingLedger.length === 0 ? (
            <p className="co-empty">No ledger entries yet.</p>
          ) : (
            billingLedger.slice(0, 5).map(entry => <LedgerRow key={entry.id} entry={entry} />)
          )}
        </Section>
      </div>

      {/* ── Rail ─────────────────────────────────────────────────────── */}
      <div className="ui-stack co-rail">

        <Section title="At a glance">
          <div className="co-stats" aria-busy={statsLoading || undefined}>
            <Link href={billingHref} className="co-stat">
              <span className="co-stat-label">Ad Fuel balance<CaretRight size={10} weight="bold" aria-hidden /></span>
              {statsLoading ? <Sk w="80%" h={22} r={6} /> : (
                <>
                  <span className={`co-stat-value ${afTone}`}>
                    {afBalance != null ? `${afBalance < 0 ? '−' : ''}${fmtMoney(afBalance)}` : '—'}
                  </span>
                  {projected != null && (
                    <span className={`co-stat-sub ${projected >= 0 ? 'co-pos' : 'co-neg'}`}>
                      {projected < 0 ? '−' : ''}{fmtMoney(projected)} after pending ACH
                    </span>
                  )}
                </>
              )}
            </Link>
            <div className="co-stat">
              <span className="co-stat-label">Spend this month</span>
              {statsLoading ? <Sk w="60%" h={22} r={6} /> : (
                <>
                  <span className="co-stat-value">{fmt$(stats?.mtdSpend ?? null)}</span>
                  <span className="co-stat-sub co-muted">Raw, before Ad Fuel</span>
                </>
              )}
            </div>
            <Link href="/admin/sites" className="co-stat">
              <span className="co-stat-label">Site uptime, 7 days<CaretRight size={10} weight="bold" aria-hidden /></span>
              {statsLoading ? <Sk w="60%" h={22} r={6} /> : (
                <span className={`co-stat-value ${uptimeTone}`}>{uptime != null ? `${uptime.toFixed(1)}%` : '—'}</span>
              )}
            </Link>
            <Link href={`/admin/clients/${clientId}?tab=content`} className="co-stat">
              <span className="co-stat-label">Content pipeline<CaretRight size={10} weight="bold" aria-hidden /></span>
              {statsLoading ? <Sk w="40%" h={22} r={6} /> : (
                <span className={`co-stat-value ${pipeline > 0 ? 'co-accent' : 'co-muted'}`}>{pipeline}</span>
              )}
            </Link>
          </div>
        </Section>

        <Section title="Account manager" description="Who looks after this client day to day.">
          {currentMgr ? (
            <div className="co-person">
              <span className="co-avatar co-avatar--lg" aria-hidden>
                {currentMgr.avatar_url ? <img src={currentMgr.avatar_url} alt="" /> : initials(currentMgr.name)}
              </span>
              <span className="co-person-text">
                <span className="co-person-name">{currentMgr.name}</span>
                <span className="co-person-sub">{currentMgr.email}</span>
              </span>
            </div>
          ) : (
            <p className="co-hint" style={{ margin: '0 0 12px' }}>No one assigned yet.</p>
          )}
          <label className="sr-only" htmlFor="account-manager">Account manager</label>
          <select
            id="account-manager"
            className="input co-select"
            value={mgr ?? ''}
            onChange={e => saveManager(e.target.value || null)}
            disabled={mgrSaving}
          >
            <option value="">Unassigned</option>
            {adminUsers.map(u => (
              <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
            ))}
          </select>
        </Section>
      </div>
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Fact({ label, value, strong, href }: { label: string; value: string | null; strong?: boolean; href?: string }) {
  return (
    <div className="co-fact">
      <dt>{label}</dt>
      {!value ? (
        <dd className="co-fact-empty">Not set</dd>
      ) : href ? (
        <dd><a href={href} target="_blank" rel="noopener noreferrer">{value}<ArrowSquareOut size={12} aria-label="opens in a new tab" /></a></dd>
      ) : (
        <dd style={strong ? { fontWeight: 600 } : undefined}>{value}</dd>
      )}
    </div>
  )
}
