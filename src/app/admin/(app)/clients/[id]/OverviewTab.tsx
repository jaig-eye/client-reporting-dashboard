'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import CopyButton from '@/components/CopyButton'

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
  adFuelBalance:      number | null
  mtdSpend:           number | null
  gscImpressions28d:  number | null
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
  adminUsers:       AdminUser[]
  contacts:         Contact[]
  stats:            Stats
  dashUrl:          string
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

export default function OverviewTab({
  clientId, name, address, phone, website, logoUrl,
  accountManagerId, adminUsers, contacts: initialContacts,
  stats, dashUrl,
}: Props) {
  const router = useRouter()

  // ── Business info editing ─────────────────────────────────────────────────
  const [editingBiz, setEditingBiz] = useState(false)
  const [bizForm,    setBizForm]    = useState({ name, address: address ?? '', phone: phone ?? '', website: website ?? '' })
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
          name:    bizForm.name    || undefined,
          address: bizForm.address || null,
          phone:   bizForm.phone   || null,
          website: bizForm.website || null,
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
  const [mgr,        setMgr]        = useState(accountManagerId)
  const [mgrSaving,  setMgrSaving]  = useState(false)

  async function saveManager(newId: string | null) {
    setMgr(newId)
    setMgrSaving(true)
    try {
      await fetch(`/api/admin/clients/${clientId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ account_manager_id: newId }),
      })
      router.refresh()
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
    setContacts(prev => prev.filter(c => c.id !== contactId))
    await fetch(`/api/admin/clients/${clientId}/contacts/${contactId}`, { method: 'DELETE' })
  }

  const roleLabel = (r: string) =>
    r === 'primary' ? 'Primary' : r === 'billing' ? 'Billing' : 'Contact'

  const roleColor = (r: string) =>
    r === 'primary' ? { bg: '#dbeafe', color: '#1d4ed8' }
    : r === 'billing' ? { bg: '#fef3c7', color: '#92400e' }
    : { bg: 'var(--bg-subtle)', color: 'var(--text-muted)' }

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
                  onClick={() => { setEditingBiz(false); setBizForm({ name, address: address ?? '', phone: phone ?? '', website: website ?? '' }) }}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
              {logoUrl && (
                <img src={logoUrl} alt={name} style={{ height: 40, objectFit: 'contain', objectPosition: 'left' }} />
              )}
              <InfoRow label="Business Name" value={name} bold />
              <InfoRow label="Address"  value={address} />
              <InfoRow label="Phone"    value={phone} />
              <InfoRow label="Website"  value={website} link />
            </div>
          )}
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
      </div>

      {/* ── RIGHT COLUMN ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

        {/* Key stats */}
        <div className="card p-5">
          <h2 className="section-title mb-3">At a Glance</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <StatTile
              label="Ad Fuel Balance"
              value={fmt$(stats.adFuelBalance)}
              valueColor={stats.adFuelBalance != null && stats.adFuelBalance < 0 ? 'var(--red)' : stats.adFuelBalance != null && stats.adFuelBalance < 200 ? '#d97706' : 'var(--green)'}
            />
            <StatTile
              label="MTD Spend"
              value={fmt$(stats.mtdSpend)}
            />
            <StatTile
              label="GSC Impressions (28d)"
              value={fmtNum(stats.gscImpressions28d)}
            />
            <StatTile
              label="Content Pipeline"
              value={String(stats.contentPipelineCount)}
              valueColor={stats.contentPipelineCount > 0 ? 'var(--blue)' : 'var(--text-muted)'}
            />
          </div>
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
        <a href={value} target="_blank" rel="noopener noreferrer" className="text-sm" style={{ color: 'var(--blue)' }}>
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
