'use client'

// One email campaign, in a sheet from the right (the shared Dialog): the preview on the left;
// details, performance, review and delete on the right. Under 900px the two columns stack and the
// sheet scrolls as one. Also home to the pieces the other email files share: the status badge and
// the date format.

import '@/styles/admin/emails.css'
import { useState, useEffect } from 'react'
import { CheckCircle, XCircle, Trash, ArrowSquareOut, PencilSimple, EnvelopeSimple } from '@phosphor-icons/react'
import StatusBadge, { type StatusTone } from '@/components/ui/StatusBadge'
import Dialog, { ConfirmDialog } from '@/components/ui/Dialog'

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

interface Props {
  email:      EmailCampaign
  onClose:    () => void
  onUpdated:  (e: EmailCampaign) => void
  onDeleted:  () => void
}

// ─── shared pieces ────────────────────────────────────────────────────────────

const STATUS_META: Record<EmailCampaign['status'], { label: string; tone: StatusTone }> = {
  pending_review: { label: 'Pending review', tone: 'warning' },
  approved:       { label: 'Approved',       tone: 'success' },
  rejected:       { label: 'Rejected',       tone: 'danger' },
  draft:          { label: 'Draft',          tone: 'neutral' },
}

export function EmailStatusBadge({ status }: { status: EmailCampaign['status'] }) {
  const m = STATUS_META[status] ?? { label: status, tone: 'neutral' as const }
  return <StatusBadge tone={m.tone}>{m.label}</StatusBadge>
}

/**
 * "Sep 20, 2026". A date-only value (sent_at is a plain date) is read as that calendar day: parsed
 * as UTC midnight and shown in local time, it used to come out a day early anywhere west of UTC.
 */
export function fmtEmailDate(iso: string | null): string {
  if (!iso) return '—'
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso)
  return new Date(dateOnly ? `${iso}T00:00:00Z` : iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', ...(dateOnly ? { timeZone: 'UTC' } : {}),
  })
}

function fmt(n: number | null, suffix = ''): string {
  return n != null ? `${n}${suffix}` : '—'
}

// ─── the sheet ────────────────────────────────────────────────────────────────

export default function EmailDetailModal({ email: initial, onClose, onUpdated, onDeleted }: Props) {
  const [email,         setEmail]         = useState(initial)
  const [reviewNotes,   setReviewNotes]   = useState('')
  const [reviewing,     setReviewing]     = useState(false)
  const [deleting,      setDeleting]      = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error,         setError]         = useState<string | null>(null)

  // Assignee
  const [users,          setUsers]          = useState<{ id: string; name: string }[]>([])
  const [assignSaving,   setAssignSaving]   = useState(false)

  useEffect(() => {
    fetch('/api/admin/users')
      .then(r => r.ok ? r.json() : null)
      .then((d: { users: { id: string; name: string }[] } | null) => { if (d?.users) setUsers(d.users) })
      .catch(() => {})
  }, [])

  async function reassign(assignedTo: string | null) {
    setAssignSaving(true)
    try {
      const res = await fetch(`/api/admin/emails/${email.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigned_to: assignedTo }),
      })
      if (!res.ok) throw new Error()
      const { email: updated } = await res.json() as { email: EmailCampaign }
      setEmail(updated)
      onUpdated(updated)
    } catch {
      setError('Couldn’t reassign the email. Try again.')
    } finally {
      setAssignSaving(false)
    }
  }

  // Inline stats editing
  const [editingStats, setEditingStats]   = useState(false)
  const [openRate,     setOpenRate]       = useState(email.open_rate?.toString() ?? '')
  const [clickRate,    setClickRate]      = useState(email.click_rate?.toString() ?? '')
  const [conversions,  setConversions]    = useState(email.conversions?.toString() ?? '')
  const [revenue,      setRevenue]        = useState(email.revenue?.toString() ?? '')
  const [savingStats,  setSavingStats]    = useState(false)

  // Escape backs out of a pending delete or a stats edit before it closes the sheet.
  function onEscape() {
    if (confirmDelete) setConfirmDelete(false)
    else if (editingStats) setEditingStats(false)
    else onClose()
  }

  async function review(action: 'approve' | 'reject') {
    if (action === 'reject' && !reviewNotes.trim()) {
      setError('Add a note saying what to change before rejecting.')
      return
    }
    setReviewing(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/emails/${email.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, notes: reviewNotes.trim() || undefined }),
      })
      if (!res.ok) throw new Error()
      const { email: updated } = await res.json() as { email: Partial<EmailCampaign> }
      const merged = { ...email, ...updated }
      setEmail(merged)
      onUpdated(merged)
    } catch {
      setError('The review didn’t go through. Try again.')
    } finally {
      setReviewing(false)
    }
  }

  async function saveStats() {
    setSavingStats(true)
    try {
      const res = await fetch(`/api/admin/emails/${email.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          open_rate:   openRate   ? parseFloat(openRate)   : null,
          click_rate:  clickRate  ? parseFloat(clickRate)  : null,
          conversions: conversions ? parseInt(conversions)  : null,
          revenue:     revenue    ? parseFloat(revenue)    : null,
        }),
      })
      if (!res.ok) throw new Error()
      const { email: updated } = await res.json() as { email: EmailCampaign }
      setEmail(updated)
      onUpdated(updated)
      setEditingStats(false)
    } catch {
      setError('Couldn’t save the performance numbers. Try again.')
    } finally {
      setSavingStats(false)
    }
  }

  // Throws so the ConfirmDialog shows the error and stays open. It used to report success
  // whatever happened (.catch(() => {}) then onDeleted()).
  async function deleteEmail() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/emails/${email.id}`, { method: 'DELETE' }).catch(() => null)
      if (!res?.ok) throw new Error('The email wasn’t deleted. Try again.')
      setConfirmDelete(false)
      onDeleted()
    } finally {
      setDeleting(false)
    }
  }

  const meta = [
    email.clients?.name ?? '—',
    email.sent_at ? `sent ${fmtEmailDate(email.sent_at)}` : null,
    email.submitter ? `uploaded by ${email.submitter.name}` : null,
  ].filter(Boolean).join(', ')

  return (
    <Dialog
      open
      onClose={onClose}
      onEscape={onEscape}
      // A details view: start on the sheet, not on the assignee picker.
      initialFocus="dialog"
      variant="side"
      size="xl"
      className="em-scope"
      bodyClassName="em-detail"
      title={email.title}
      description={<>
        {meta}
        {email.reviewed_at && (
          <span className="em-reviewed">Reviewed by {email.reviewer?.name ?? 'an admin'}, {fmtEmailDate(email.reviewed_at)}</span>
        )}
      </>}
      actions={<EmailStatusBadge status={email.status} />}
    >
          {/* Preview */}
          <div className="em-preview">
            {email.preview_image_url && (
              <img src={email.preview_image_url} alt={`Preview of ${email.title}`} />
            )}
            {!email.preview_image_url && email.html_content && (
              <iframe srcDoc={email.html_content} sandbox="" className="em-frame" title="Email HTML preview" />
            )}
            {!email.preview_image_url && !email.html_content && email.preview_url && (
              <div className="em-preview-empty">
                <EnvelopeSimple size={28} aria-hidden />
                <a href={email.preview_url} target="_blank" rel="noopener noreferrer">
                  Open the external preview<ArrowSquareOut size={14} aria-label="opens in a new tab" />
                </a>
              </div>
            )}
            {!email.preview_image_url && !email.html_content && !email.preview_url && (
              <div className="em-preview-empty">
                <EnvelopeSimple size={28} aria-hidden />
                No preview yet. Add an image, HTML or a preview link when uploading.
              </div>
            )}
          </div>

          {/* Details, performance, review */}
          <div className="em-side">
            <section>
              <h3 className="em-group-title" style={{ marginBottom: 10 }}>Details</h3>
              <dl className="em-meta">
                {email.subject_line && (
                  <div><dt>Subject line</dt><dd>&ldquo;{email.subject_line}&rdquo;</dd></div>
                )}
                {email.goal && (
                  <div><dt>Goal</dt><dd>{email.goal}</dd></div>
                )}
                {email.utm_campaign && (
                  <div><dt>UTM campaign</dt><dd className="em-mono">{email.utm_campaign}</dd></div>
                )}
                <div>
                  <dt><label htmlFor="em-assignee">Assigned to</label></dt>
                  <dd style={{ marginTop: 4 }}>
                    <select
                      id="em-assignee"
                      className="input"
                      value={email.assigned_to ?? ''}
                      onChange={e => void reassign(e.target.value || null)}
                      disabled={assignSaving}
                      style={{ fontSize: '0.8125rem' }}
                    >
                      <option value="">Unassigned</option>
                      {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </dd>
                </div>
              </dl>
            </section>

            {/* Performance stats */}
            <section>
              <div className="em-group-head">
                <h3 className="em-group-title">Performance</h3>
                {!editingStats && (
                  <button type="button" className="em-linkbtn" onClick={() => setEditingStats(true)}>
                    <PencilSimple size={13} aria-hidden />Edit
                  </button>
                )}
              </div>
              {editingStats ? (
                <div className="em-form" style={{ gap: 12 }}>
                  <div className="em-stats">
                    {[
                      { id: 'open',  label: 'Open rate (%)',  val: openRate,    set: setOpenRate },
                      { id: 'click', label: 'Click rate (%)', val: clickRate,   set: setClickRate },
                      { id: 'conv',  label: 'Conversions',    val: conversions, set: setConversions },
                      { id: 'rev',   label: 'Revenue ($)',    val: revenue,     set: setRevenue },
                    ].map(f => (
                      <div key={f.id} className="em-field">
                        <label className="em-label" htmlFor={`em-stat-${f.id}`}>{f.label}</label>
                        <input id={`em-stat-${f.id}`} className="input" type="number" value={f.val} onChange={e => f.set(e.target.value)} />
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingStats(false)}>Cancel</button>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => void saveStats()} disabled={savingStats}>
                      {savingStats ? 'Saving…' : 'Save performance'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="em-stats">
                  {[
                    { label: 'Open rate',   value: fmt(email.open_rate,  '%') },
                    { label: 'Click rate',  value: fmt(email.click_rate, '%') },
                    { label: 'Conversions', value: fmt(email.conversions) },
                    { label: 'Revenue',     value: email.revenue != null ? `$${email.revenue.toLocaleString()}` : '—' },
                  ].map(s => (
                    <div key={s.label} className="em-stat">
                      <span className="em-stat-label">{s.label}</span>
                      <span className="em-stat-value">{s.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Reviewer notes (existing) */}
            {email.reviewer_notes && (
              <section>
                <h3 className="em-group-title" style={{ marginBottom: 8 }}>Reviewer notes</h3>
                <p className="em-quote">{email.reviewer_notes}</p>
              </section>
            )}

            {/* Review actions */}
            {email.status === 'pending_review' && (
              <section className="em-review">
                <label className="em-group-title" htmlFor="em-review-notes" style={{ display: 'block', marginBottom: 4 }}>Review</label>
                <p className="em-hint" style={{ margin: '0 0 10px' }}>Approve it as is, or reject it with a note saying what to change.</p>
                <textarea
                  id="em-review-notes"
                  className="input"
                  value={reviewNotes}
                  onChange={e => setReviewNotes(e.target.value)}
                  placeholder="Notes for the uploader (needed to reject)"
                  rows={3}
                />
                <div className="em-review-actions">
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => void review('reject')} disabled={reviewing}>
                    <XCircle size={15} aria-hidden />Reject
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => void review('approve')} disabled={reviewing}>
                    <CheckCircle size={15} aria-hidden />{reviewing ? 'Saving…' : 'Approve'}
                  </button>
                </div>
              </section>
            )}

            {error && <div className="ui-notice ui-notice--danger" role="alert">{error}</div>}

            {/* Delete */}
            <div className="em-delete">
              <button type="button" className="btn btn-ghost btn-sm em-danger-text" onClick={() => setConfirmDelete(true)} disabled={deleting}>
                <Trash size={14} aria-hidden />Delete email
              </button>
            </div>
            <ConfirmDialog
              open={confirmDelete}
              onClose={() => setConfirmDelete(false)}
              title="Delete this email?"
              confirmLabel="Delete email"
              busyLabel="Deleting…"
              tone="danger"
              onConfirm={deleteEmail}
            >
              It comes off the client’s email list for good, with its results. This can’t be undone.
            </ConfirmDialog>
          </div>
    </Dialog>
  )
}
