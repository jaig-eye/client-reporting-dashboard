'use client'

// The Emails page: client email campaigns, filtered by status and client, each opening in a detail
// sheet to review, score and manage. Emails waiting for review carry an amber edge, and their
// count shows on the Pending review tab.

import '@/styles/admin/emails.css'
import { useState, useEffect, useCallback, useRef } from 'react'
import { EnvelopeSimple, Plus } from '@phosphor-icons/react'
import PageHeader from '@/components/ui/PageHeader'
import StatusBadge from '@/components/ui/StatusBadge'
import EmptyState from '@/components/ui/EmptyState'
import { PillTabs } from '@/components/ui/PillTabs'
import { SkRows } from '@/components/ui/Skeleton'
import EmailUploadModal  from './EmailUploadModal'
import EmailDetailModal, { EmailStatusBadge, fmtEmailDate } from './EmailDetailModal'

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
  assigned_to:       string | null
  created_at:        string
  updated_at:        string
  clients:           { name: string } | null
  submitter:         { name: string; avatar_url: string | null } | null
  reviewer:          { name: string } | null
  assignee:          { name: string; avatar_url: string | null } | null
}

const STATUS_FILTERS = [
  { key: 'all',            label: 'All' },
  { key: 'pending_review', label: 'Pending review' },
  { key: 'approved',       label: 'Approved' },
  { key: 'rejected',       label: 'Rejected' },
  { key: 'draft',          label: 'Drafts' },
]

interface Props {
  clients: EmailClient[]
}

export default function EmailsClientShell({ clients }: Props) {
  const [emails,       setEmails]       = useState<EmailCampaign[]>([])
  const [loading,      setLoading]      = useState(true)
  const [loadError,    setLoadError]    = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [clientFilter, setClientFilter] = useState('all')
  const [showUpload,   setShowUpload]   = useState(false)
  const [detailEmail,  setDetailEmail]  = useState<EmailCampaign | null>(null)

  // Auto-open email from ?open= magic link (e.g. from Discord notification)
  const openHandled = useRef(false)
  useEffect(() => {
    if (openHandled.current) return
    const openId = new URLSearchParams(window.location.search).get('open')
    if (!openId) return
    openHandled.current = true
    fetch(`/api/admin/emails/${openId}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { email: EmailCampaign } | null) => { if (d?.email) setDetailEmail(d.email) })
      .catch(() => {})
  }, [])

  const loadEmails = useCallback(() => {
    setLoading(true)
    setLoadError(false)
    const params = new URLSearchParams()
    if (statusFilter !== 'all') params.set('status', statusFilter)
    if (clientFilter !== 'all') params.set('client_id', clientFilter)

    fetch(`/api/admin/emails?${params}`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((d: { emails: EmailCampaign[] }) => setEmails(d.emails))
      .catch(() => setLoadError(true))
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
  const filtered = statusFilter !== 'all' || clientFilter !== 'all'

  return (
    <div>
      <PageHeader
        title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>Emails <StatusBadge tone="info" dot={false}>Beta</StatusBadge></span>}
        description="Upload client email campaigns, review them before they go out, and record how they performed."
        actions={
          <button type="button" onClick={() => setShowUpload(true)} className="btn btn-primary">
            <Plus size={15} weight="bold" aria-hidden />Add email
          </button>
        }
      />

      {/* Filters */}
      <div className="em-toolbar">
        <PillTabs
          label="Filter by status"
          activeId={statusFilter}
          onSelect={setStatusFilter}
          items={STATUS_FILTERS.map(f => ({
            id: f.key,
            label: f.label,
            ...(f.key === 'pending_review' ? { count: pendingCount, alert: true } : {}),
          }))}
        />
        <label className="em-client">
          <span className="sr-only">Filter by client</span>
          <select className="input" value={clientFilter} onChange={e => setClientFilter(e.target.value)}>
            <option value="all">All clients</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>

      {loadError && (
        <div className="ui-notice ui-notice--danger" role="alert">
          <span>The emails couldn’t load.</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={loadEmails}>Try again</button>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="card em-list" aria-busy="true" aria-label="Loading emails"><SkRows rows={4} /></div>
      ) : emails.length === 0 ? (
        !loadError && (
          <div className="card">
            <EmptyState
              icon={<EnvelopeSimple size={20} />}
              title={filtered ? 'No emails match these filters' : 'No emails yet'}
              actions={filtered
                ? <button type="button" className="btn btn-secondary" onClick={() => { setStatusFilter('all'); setClientFilter('all') }}>Show all emails</button>
                : <button type="button" className="btn btn-primary" onClick={() => setShowUpload(true)}><Plus size={15} weight="bold" aria-hidden />Add email</button>}
            >
              {filtered
                ? 'Try another status or client.'
                : 'Add a client email campaign to send it for review and track how it did.'}
            </EmptyState>
          </div>
        )
      ) : (
        <div className="card em-list">
          {emails.map(email => {
            const date = fmtEmailDate(email.sent_at ?? email.created_at)
            return (
              <button
                key={email.id}
                type="button"
                className={`em-row${email.status === 'pending_review' ? ' em-row--pending' : ''}`}
                onClick={() => setDetailEmail(email)}
              >
                <span className="em-thumb" aria-hidden>
                  {email.preview_image_url
                    ? <img src={email.preview_image_url} alt="" />
                    : <EnvelopeSimple size={18} />}
                </span>
                <span className="em-row-text">
                  <span className="em-row-title">{email.title}</span>
                  <span className="em-row-sub">{email.clients?.name ?? '—'}{email.goal ? ` · ${email.goal}` : ''}</span>
                  <span className="em-row-meta">
                    <EmailStatusBadge status={email.status} />
                    <span className="em-row-date">{date}</span>
                  </span>
                </span>
                <span className="em-row-date em-wide">{date}</span>
                <span className="em-row-status em-wide"><EmailStatusBadge status={email.status} /></span>
              </button>
            )
          })}
        </div>
      )}

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
