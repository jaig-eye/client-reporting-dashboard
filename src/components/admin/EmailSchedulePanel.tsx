'use client'

import { useState, useEffect } from 'react'
import { CalendarBlank, User, Bell } from '@phosphor-icons/react'

interface AdminUser {
  id:         string
  name:       string
  avatar_url: string | null
}

interface Schedule {
  id?:                 string
  client_id:           string
  is_active:           boolean
  emails_per_week:     number
  assigned_user_id:    string | null
  reminder_days_before: number
  users?:              AdminUser | null
}

interface Props {
  clientId: string
}

export default function EmailSchedulePanel({ clientId }: Props) {
  const [schedule,   setSchedule]   = useState<Schedule | null>(null)
  const [users,      setUsers]      = useState<AdminUser[]>([])
  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [saved,      setSaved]      = useState(false)

  // local form state
  const [isActive,          setIsActive]          = useState(true)
  const [emailsPerWeek,     setEmailsPerWeek]     = useState(1)
  const [assignedUserId,    setAssignedUserId]    = useState<string>('')
  const [reminderDaysBefore, setReminderDaysBefore] = useState(2)

  useEffect(() => {
    Promise.all([
      fetch(`/api/admin/email-schedules/${clientId}`).then(r => r.json() as Promise<{ schedule: Schedule | null }>),
      fetch('/api/admin/users').then(r => r.json() as Promise<{ users: AdminUser[] }>),
    ]).then(([schedRes, usersRes]) => {
      setUsers(usersRes.users ?? [])
      if (schedRes.schedule) {
        const s = schedRes.schedule
        setSchedule(s)
        setIsActive(s.is_active)
        setEmailsPerWeek(s.emails_per_week)
        setAssignedUserId(s.assigned_user_id ?? '')
        setReminderDaysBefore(s.reminder_days_before)
      }
    }).catch(() => {}).finally(() => setLoading(false))
  }, [clientId])

  async function save() {
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch(`/api/admin/email-schedules/${clientId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_active:            isActive,
          emails_per_week:      emailsPerWeek,
          assigned_user_id:     assignedUserId || null,
          reminder_days_before: reminderDaysBefore,
        }),
      })
      if (!res.ok) throw new Error()
      const { schedule: updated } = await res.json() as { schedule: Schedule }
      setSchedule(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      // swallow — user can retry
    } finally {
      setSaving(false)
    }
  }

  const labelStyle: React.CSSProperties = {
    fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4,
  }
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.4rem 0.6rem', boxSizing: 'border-box',
    background: 'var(--bg-subtle)', border: '1px solid var(--border)',
    borderRadius: 6, fontSize: '0.8rem', color: 'var(--text)', fontFamily: 'inherit',
  }

  if (loading) return <p style={{ fontSize: '0.78rem', color: 'var(--text-faint)' }}>Loading schedule…</p>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem' }}>
        <CalendarBlank size={16} style={{ color: 'var(--blue)' }} aria-hidden />
        <p style={{ margin: 0, fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>
          Email Schedule
        </p>
        {/* Active toggle */}
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          <span>{isActive ? 'Active' : 'Inactive'}</span>
          <span style={{ position: 'relative', display: 'inline-block', width: 32, height: 18 }}>
            <input
              type="checkbox"
              checked={isActive}
              onChange={e => setIsActive(e.target.checked)}
              style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}
            />
            <span style={{
              position: 'absolute', inset: 0, borderRadius: 999,
              background: isActive ? 'var(--blue)' : 'var(--border)', transition: 'background 0.2s',
            }} />
            <span style={{
              position: 'absolute', top: 2, left: isActive ? 16 : 2, width: 14, height: 14,
              borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
            }} />
          </span>
        </label>
      </div>

      {isActive && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>Emails per week</label>
            <input
              type="number" min="1" max="7"
              value={emailsPerWeek}
              onChange={e => setEmailsPerWeek(Math.max(1, parseInt(e.target.value) || 1))}
              style={{ ...inputStyle, width: 80 }}
            />
          </div>

          <div>
            <label style={labelStyle}><User size={11} style={{ marginRight: 4 }} aria-hidden />Assigned to</label>
            <select value={assignedUserId} onChange={e => setAssignedUserId(e.target.value)} style={inputStyle}>
              <option value="">Unassigned</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>

          <div>
            <label style={labelStyle}><Bell size={11} style={{ marginRight: 4 }} aria-hidden />Reminder (days before due)</label>
            <input
              type="number" min="0" max="14"
              value={reminderDaysBefore}
              onChange={e => setReminderDaysBefore(Math.max(0, parseInt(e.target.value) || 0))}
              style={{ ...inputStyle, width: 80 }}
            />
            <p style={{ margin: '3px 0 0', fontSize: '0.68rem', color: 'var(--text-faint)' }}>
              Discord reminder fires this many days before the weekly due date (Friday).
            </p>
          </div>
        </div>
      )}

      <button
        onClick={() => void save()}
        disabled={saving}
        style={{
          marginTop: 14, padding: '0.4rem 1rem',
          background: saving ? 'var(--border)' : saved ? 'var(--green)' : 'var(--blue)',
          color: '#fff', border: 'none', borderRadius: 6,
          fontSize: '0.78rem', fontWeight: 600, cursor: saving ? 'wait' : 'pointer',
          transition: 'background 0.2s',
        }}
      >
        {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Schedule'}
      </button>

      {!schedule && (
        <p style={{ margin: '6px 0 0', fontSize: '0.68rem', color: 'var(--text-faint)' }}>
          No schedule set yet. Save to create one.
        </p>
      )}
    </div>
  )
}
