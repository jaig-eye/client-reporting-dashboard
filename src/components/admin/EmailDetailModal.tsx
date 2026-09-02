'use client'

import { useState, useEffect } from 'react'
import { X, CheckCircle, XCircle, Trash, ArrowSquareOut, PencilSimple, FloppyDisk, UserCircle } from '@phosphor-icons/react'

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

const STATUS_COLORS: Record<string, string> = {
  pending_review: 'var(--yellow, #ca8a04)',
  approved:       'var(--green)',
  rejected:       'var(--red)',
  draft:          'var(--text-faint)',
}

function fmt(n: number | null, suffix = ''): string {
  return n != null ? `${n}${suffix}` : '—'
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

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
      setError('Failed to reassign.')
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

  async function review(action: 'approve' | 'reject') {
    if (action === 'reject' && !reviewNotes.trim()) {
      setError('Add review notes before rejecting.')
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
      setError('Review action failed.')
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
      setError('Failed to save stats.')
    } finally {
      setSavingStats(false)
    }
  }

  async function deleteEmail() {
    setDeleting(true)
    await fetch(`/api/admin/emails/${email.id}`, { method: 'DELETE' }).catch(() => {})
    onDeleted()
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.35rem 0.5rem', boxSizing: 'border-box',
    background: 'var(--bg-subtle)', border: '1px solid var(--border)',
    borderRadius: 5, fontSize: '0.78rem', color: 'var(--text)', fontFamily: 'inherit',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'stretch',
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        marginLeft: 'auto', width: '100%', maxWidth: 900,
        background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 12,
          padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', flexShrink: 0,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: '0.65rem', fontWeight: 700, padding: '2px 7px',
                borderRadius: 999, background: 'transparent',
                border: `1px solid ${STATUS_COLORS[email.status]}`,
                color: STATUS_COLORS[email.status],
              }}>
                {email.status.replace('_', ' ').toUpperCase()}
              </span>
              {email.reviewed_at && (
                <span style={{ fontSize: '0.65rem', color: 'var(--text-faint)' }}>
                  Reviewed by {email.reviewer?.name ?? 'Admin'} · {fmtDate(email.reviewed_at)}
                </span>
              )}
            </div>
            <h2 style={{ margin: '4px 0 2px', fontSize: '1.05rem', fontWeight: 700 }}>{email.title}</h2>
            <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-faint)' }}>
              {email.clients?.name ?? '—'}
              {email.sent_at ? ` · Sent ${fmtDate(email.sent_at)}` : ''}
              {email.submitter ? ` · Uploaded by ${email.submitter.name}` : ''}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, flexShrink: 0 }}>
            <X size={18} aria-hidden />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', flex: 1, minHeight: 0 }}>
          {/* Left — preview */}
          <div style={{ padding: '1.25rem', borderRight: '1px solid var(--border)', overflowY: 'auto' }}>
            {email.preview_image_url && (
              <img
                src={email.preview_image_url}
                alt="Email preview"
                style={{ width: '100%', borderRadius: 6, border: '1px solid var(--border)', display: 'block' }}
              />
            )}
            {!email.preview_image_url && email.html_content && (
              <iframe
                srcDoc={email.html_content}
                sandbox=""
                style={{ width: '100%', height: 600, border: '1px solid var(--border)', borderRadius: 6 }}
                title="Email HTML preview"
              />
            )}
            {!email.preview_image_url && !email.html_content && email.preview_url && (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-faint)' }}>
                <a href={email.preview_url} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--blue)', fontSize: '0.85rem', fontWeight: 600 }}>
                  <ArrowSquareOut size={16} /> Open external preview
                </a>
              </div>
            )}
            {!email.preview_image_url && !email.html_content && !email.preview_url && (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-faint)', fontSize: '0.8rem' }}>
                No preview available.
              </div>
            )}
          </div>

          {/* Right — metadata + review */}
          <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto' }}>
            {/* Details */}
            <div>
              <p style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-faint)', margin: '0 0 8px' }}>Details</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {email.subject_line && (
                  <div>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-faint)' }}>Subject line</span>
                    <p style={{ margin: 0, fontSize: '0.8rem', fontStyle: 'italic' }}>&ldquo;{email.subject_line}&rdquo;</p>
                  </div>
                )}
                {email.goal && (
                  <div>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-faint)' }}>Goal</span>
                    <p style={{ margin: 0, fontSize: '0.8rem' }}>{email.goal}</p>
                  </div>
                )}
                {email.utm_campaign && (
                  <div>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-faint)' }}>UTM Campaign</span>
                    <p style={{ margin: 0, fontSize: '0.78rem', fontFamily: 'monospace' }}>{email.utm_campaign}</p>
                  </div>
                )}
                <div>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                    <UserCircle size={11} aria-hidden /> Assigned to
                  </span>
                  <select
                    value={email.assigned_to ?? ''}
                    onChange={e => void reassign(e.target.value || null)}
                    disabled={assignSaving}
                    style={{
                      width: '100%', padding: '0.3rem 0.5rem', borderRadius: 5,
                      border: '1px solid var(--border)', background: 'var(--bg-subtle)',
                      fontSize: '0.78rem', color: 'var(--text)', fontFamily: 'inherit',
                    }}
                  >
                    <option value="">Unassigned</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Performance stats */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <p style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-faint)', margin: 0 }}>Performance</p>
                <button
                  onClick={() => setEditingStats(!editingStats)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', padding: 2 }}
                >
                  <PencilSimple size={13} aria-hidden />
                </button>
              </div>
              {editingStats ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    {[
                      { label: 'Open Rate (%)', val: openRate,    set: setOpenRate,    type: 'number' },
                      { label: 'Click Rate (%)', val: clickRate,   set: setClickRate,   type: 'number' },
                      { label: 'Conversions',    val: conversions, set: setConversions, type: 'number' },
                      { label: 'Revenue ($)',    val: revenue,     set: setRevenue,     type: 'number' },
                    ].map(f => (
                      <div key={f.label}>
                        <label style={{ fontSize: '0.62rem', color: 'var(--text-faint)', display: 'block', marginBottom: 2 }}>{f.label}</label>
                        <input type={f.type} value={f.val} onChange={e => f.set(e.target.value)} style={inputStyle} />
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => setEditingStats(false)} style={{ flex: 1, padding: '0.35rem', fontSize: '0.72rem', cursor: 'pointer', borderRadius: 5, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)' }}>Cancel</button>
                    <button onClick={() => void saveStats()} disabled={savingStats} style={{ flex: 1, padding: '0.35rem', fontSize: '0.72rem', cursor: 'pointer', borderRadius: 5, border: 'none', background: 'var(--blue)', color: '#fff', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                      <FloppyDisk size={12} /> {savingStats ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {[
                    { label: 'Open Rate',   value: fmt(email.open_rate,  '%') },
                    { label: 'Click Rate',  value: fmt(email.click_rate, '%') },
                    { label: 'Conversions', value: fmt(email.conversions) },
                    { label: 'Revenue',     value: email.revenue != null ? `$${email.revenue.toLocaleString()}` : '—' },
                  ].map(s => (
                    <div key={s.label} style={{ background: 'var(--bg-subtle)', borderRadius: 6, padding: '0.5rem 0.6rem' }}>
                      <p style={{ margin: 0, fontSize: '0.6rem', color: 'var(--text-faint)' }}>{s.label}</p>
                      <p style={{ margin: 0, fontSize: '0.88rem', fontWeight: 700 }}>{s.value}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Reviewer notes (existing) */}
            {email.reviewer_notes && (
              <div>
                <p style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-faint)', margin: '0 0 6px' }}>Reviewer Notes</p>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text)', background: 'var(--bg-subtle)', padding: '0.5rem 0.625rem', borderRadius: 6, borderLeft: '3px solid var(--border)' }}>
                  {email.reviewer_notes}
                </p>
              </div>
            )}

            {/* Review actions */}
            {email.status === 'pending_review' && (
              <div>
                <p style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-faint)', margin: '0 0 8px' }}>Review</p>
                <textarea
                  value={reviewNotes}
                  onChange={e => setReviewNotes(e.target.value)}
                  placeholder="Add notes (required to reject)…"
                  rows={3}
                  style={{
                    ...inputStyle, resize: 'vertical', marginBottom: 8,
                    display: 'block',
                  }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => void review('reject')}
                    disabled={reviewing}
                    style={{
                      flex: 1, padding: '0.45rem', borderRadius: 6, border: '1px solid var(--red)',
                      background: 'transparent', color: 'var(--red)', fontWeight: 600, fontSize: '0.78rem',
                      cursor: reviewing ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                    }}
                  >
                    <XCircle size={14} /> Reject
                  </button>
                  <button
                    onClick={() => void review('approve')}
                    disabled={reviewing}
                    style={{
                      flex: 1, padding: '0.45rem', borderRadius: 6, border: 'none',
                      background: 'var(--green)', color: '#fff', fontWeight: 600, fontSize: '0.78rem',
                      cursor: reviewing ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                    }}
                  >
                    <CheckCircle size={14} /> Approve
                  </button>
                </div>
              </div>
            )}

            {error && (
              <p style={{ fontSize: '0.78rem', color: 'var(--red)', margin: 0 }}>{error}</p>
            )}

            {/* Delete */}
            <div style={{ marginTop: 'auto', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
              {!confirmDelete ? (
                <button
                  onClick={() => setConfirmDelete(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.35rem 0.6rem', borderRadius: 5, border: '1px solid var(--border)', background: 'none', color: 'var(--text-faint)', fontSize: '0.72rem', cursor: 'pointer' }}
                >
                  <Trash size={13} /> Delete email
                </button>
              ) : (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Sure?</span>
                  <button onClick={() => setConfirmDelete(false)} style={{ padding: '0.25rem 0.6rem', fontSize: '0.72rem', borderRadius: 5, border: '1px solid var(--border)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>Cancel</button>
                  <button onClick={() => void deleteEmail()} disabled={deleting} style={{ padding: '0.25rem 0.6rem', fontSize: '0.72rem', borderRadius: 5, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 600, cursor: deleting ? 'wait' : 'pointer' }}>
                    {deleting ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
