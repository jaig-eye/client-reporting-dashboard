'use client'

// Client → Profile: who the client is and who we deal with. Business info (the name, address and
// links the client's dashboard and reports show), the client's contacts, and the account manager.
// It used to sit in the Overview's side column, which crowded the numbers and notes the Overview
// is for; the Overview keeps a read-only People card that links here.

import '@/styles/admin/client-overview.css'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PencilSimple, Plus, Trash, ArrowSquareOut } from '@phosphor-icons/react'
import Section from '@/components/ui/Section'
import StatusBadge from '@/components/ui/StatusBadge'
import { ConfirmDialog } from '@/components/ui/Dialog'
import ClientLogoUpload from './ClientLogoUpload'
import { CONTACT_ROLE, initials, normalizeUrl, type AdminUser, type Contact } from './people'

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
}

export default function ProfileTab({
  clientId, name, address, phone, website, logoUrl, accountManagerId, adminUsers, contacts: initialContacts,
}: Props) {
  const router = useRouter()

  // ── Business info ─────────────────────────────────────────────────────────
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
      // The Overview's People card reads the same contacts on the server.
      router.refresh()
    } catch (err) {
      setContactError(err instanceof Error ? err.message : 'Error')
    } finally {
      setContactSaving(false)
    }
  }

  // Removing asks first (ConfirmDialog). It used to remove on one click and swallow a failure.
  const [removing, setRemoving] = useState<Contact | null>(null)

  async function deleteContact(contactId: string) {
    const res = await fetch(`/api/admin/clients/${clientId}/contacts/${contactId}`, { method: 'DELETE' }).catch(() => null)
    if (!res?.ok) throw new Error('The contact wasn’t removed. Try again.')
    setContacts(prev => prev.filter(c => c.id !== contactId))
    router.refresh()
  }

  return (
    <div className="co-profile co-scope">
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={removing ? `Remove ${removing.name}?` : 'Remove contact?'}
        confirmLabel="Remove contact"
        busyLabel="Removing…"
        tone="danger"
        onConfirm={async () => { if (removing) await deleteContact(removing.id) }}
      >
        They come off this client’s contacts. Notes and emails that mention them stay as they are.
      </ConfirmDialog>
      <Section
        title="Business info"
        description="The name, address and links the client’s dashboard and reports show."
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
          <div className="co-biz">
            <div className="co-biz-logo-wrap">
              {displayLogoUrl
                ? <img src={displayLogoUrl} alt={`${name} logo`} className="co-biz-logo" />
                : <span className="co-biz-logo co-biz-logo--none">No logo</span>}
            </div>
            <dl className="co-facts">
              <Fact label="Business name" value={name} strong />
              <Fact label="Phone" value={phone} />
              <Fact label="Address" value={address} />
              <Fact label="Website" value={website} href={website ? normalizeUrl(website) : undefined} />
            </dl>
          </div>
        )}
      </Section>

      <div className="co-profile-side">
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
            const role = CONTACT_ROLE[contact.role]
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
                    onClick={() => setRemoving(contact)}
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
