'use client'

import { useState, useEffect, useCallback } from 'react'
import { EnvelopeSimple, Plus, FunnelSimple, CheckCircle, XCircle, Clock, Warning } from '@phosphor-icons/react'
import EmailUploadModal  from './EmailUploadModal'
import EmailDetailModal  from './EmailDetailModal'

export interface EmailClient {
  id:   string
  name: string
}

interface EmailCampaign {
  id:                string
  client_id:         string
  title:             string
  subject_line:      string | null
  goal:              string | null
  preview_image_url: string | null
  preview_url:       string | null
  html_content:      string | null
  sent_at:           string | null
  utm_campaign:      string | null
  open_rate:         number | null
  click_rate:        number | null
  conversions:       number | null
  revenue:           number | null
  status:            'draft' | 'pending_review' | 'approved' | 'rejected'
  reviewer_notes:    string | null
  reviewed_at:       string | null
  submitted_by:      string | null
  reviewed_by:       string | null
  created_at:        string
  updated_at:        string
  clients:           { name: string } | null
  submitter:         { name: string; avatar_url: string | null } | null
  reviewer:          { name: string } | null
}

const STATUS_FILTERS = [
  { key: 'all',            label: 'All' },
  { key: 'pending_review', label: 'Pending Review' },
  { key: 'approved',       label: 'Approved' },
  { key: 'rejected',       label: 'Rejected' },
  { key: 'draft',          label: 'Drafts' },
]

function StatusBadge({ status }: { status: EmailCampaign['status'] }) {
  const map = {
    pending_review: { label: 'Pending Review', color: 'var(--yellow, #ca8a04)', bg: 'rgba(234,179,8,0.1)', icon: <Clock size={11} /> },
    approved:       { label: 'Approved',       color: 'var(--green)',           bg: 'rgba(34,197,94,0.1)',  icon: <CheckCircle size={11} /> },
    rejected:       { label: 'Rejected',       color: 'var(--red)',             bg: 'rgba(239,68,68,0.1)',  icon: <XCircle size={11} /> },
    draft:          { label: 'Draft',          color: 'var(--text-faint)',      bg: 'var(--bg-subtle)',     icon: <Warning size={11} /> },
  }[status]

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 7px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 600,
      color: map.color, background: map.bg,
    }}>
      {map.icon}{map.label}
    </span>
  )
}

function relDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

interface Props {
  clients: EmailClient[]
}

export default function EmailsClientShell({ clients }: Props) {
  const [emails,       setEmails]       = useState<EmailCampaign[]>([])
  const [loading,      setLoading]      = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [clientFilter, setClientFilter] = useState('all')
  const [showUpload,   setShowUpload]   = useState(false)
  const [detailEmail,  setDetailEmail]  = useState<EmailCampaign | null>(null)

  const loadEmails = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (statusFilter !== 'all') params.set('status', statusFilter)
    if (clientFilter !== 'all') params.set('client_id', clientFilter)

    fetch(`/api/admin/emails?${params}`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((d: { emails: EmailCampaign[] }) => setEmails(d.emails))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [statusFilter, clientFilter])

  useEffect(() => { loadEmails() }, [loadEmails])

  function onEmailCreated(email: EmailCampaign) {
    setEmails(prev => [email, ...prev])
    setShowUpload(false)
  }

  function onEmailUpdated(updated: EmailCampaign) {
    setEmails(prev => prev.map(e => e.id === updated.id ? updated : e))
    setDetailEmail(updated)
  }

  function onEmailDeleted(id: string) {
    setEmails(prev => prev.filter(e => e.id !== id))
    setDetailEmail(null)
  }

  const pendingCount = emails.filter(e => e.status === 'pending_review').length

  return (
    <div style={{ padding: '1.5rem 2rem', maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <EnvelopeSimple size={22} style={{ color: 'var(--blue)' }} aria-hidden />
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
              Emails
            </h1>
            <span style={{
              fontSize: '0.5rem', fontWeight: 700, letterSpacing: '0.05em',
              background: 'var(--blue)', color: '#fff',
              padding: '2px 6px', borderRadius: 4, verticalAlign: 'middle',
            }}>BETA</span>
            {pendingCount > 0 && (
              <span style={{
                background: 'var(--red)', color: '#fff', borderRadius: 999,
                fontSize: '0.6rem', fontWeight: 700, padding: '1px 7px',
              }}>
                {pendingCount} to review
              </span>
            )}
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-faint)', margin: '4px 0 0' }}>
            Upload, review, and approve client email campaigns.
          </p>
        </div>
        <button
          onClick={() => setShowUpload(true)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '0.5rem 1rem', background: 'var(--blue)', color: '#fff',
            border: 'none', borderRadius: 7, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
          }}
        >
          <Plus size={15} aria-hidden /> Add Email
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <FunnelSimple size={15} style={{ color: 'var(--text-faint)' }} aria-hidden />
        <div style={{ display: 'flex', gap: 4 }}>
          {STATUS_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              style={{
                padding: '0.25rem 0.65rem', fontSize: '0.72rem', fontWeight: 600,
                borderRadius: 999, border: '1px solid',
                borderColor: statusFilter === f.key ? 'var(--blue)' : 'var(--border)',
                background:  statusFilter === f.key ? 'var(--blue)' : 'transparent',
                color:       statusFilter === f.key ? '#fff' : 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          value={clientFilter}
          onChange={e => setClientFilter(e.target.value)}
          style={{
            padding: '0.25rem 0.5rem', fontSize: '0.72rem', borderRadius: 6,
            border: '1px solid var(--border)', background: 'var(--bg-subtle)',
            color: 'var(--text)', cursor: 'pointer',
          }}
        >
          <option value="all">All Clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* List */}
      {loading && (
        <p style={{ color: 'var(--text-faint)', fontSize: '0.8rem' }}>Loading…</p>
      )}
      {!loading && emails.length === 0 && (
        <div style={{
          textAlign: 'center', padding: '3rem 1rem',
          border: '2px dashed var(--border)', borderRadius: 10,
        }}>
          <EnvelopeSimple size={36} style={{ color: 'var(--text-faint)', marginBottom: 8 }} aria-hidden />
          <p style={{ color: 'var(--text-faint)', fontSize: '0.85rem', margin: 0 }}>No emails yet. Click <strong>Add Email</strong> to upload the first one.</p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {emails.map(email => (
          <div
            key={email.id}
            onClick={() => setDetailEmail(email)}
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr auto auto',
              gap: '0.75rem',
              alignItems: 'center',
              padding: '0.75rem 1rem',
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              cursor: 'pointer',
              transition: 'border-color 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--blue)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
          >
            {/* Preview thumbnail */}
            <div style={{
              width: 52, height: 38, borderRadius: 4, overflow: 'hidden',
              background: 'var(--border)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {email.preview_image_url
                ? <img src={email.preview_image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <EnvelopeSimple size={18} style={{ color: 'var(--text-faint)' }} aria-hidden />}
            </div>

            {/* Main info */}
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontWeight: 600, fontSize: '0.85rem', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {email.title}
              </p>
              <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--text-faint)' }}>
                {email.clients?.name ?? '—'}{email.goal ? ` · ${email.goal}` : ''}
              </p>
            </div>

            {/* Date */}
            <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
              {relDate(email.sent_at ?? email.created_at)}
            </p>

            {/* Status */}
            <StatusBadge status={email.status} />
          </div>
        ))}
      </div>

      {/* Modals */}
      {showUpload && (
        <EmailUploadModal
          clients={clients}
          onClose={() => setShowUpload(false)}
          onCreated={email => onEmailCreated(email as EmailCampaign)}
        />
      )}
      {detailEmail && (
        <EmailDetailModal
          email={detailEmail}
          onClose={() => setDetailEmail(null)}
          onUpdated={onEmailUpdated}
          onDeleted={() => onEmailDeleted(detailEmail.id)}
        />
      )}
    </div>
  )
}
