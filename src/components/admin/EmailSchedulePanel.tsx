'use client'

// A client's email schedule: on or off, how many emails a week, who writes them, and how many days
// before the Friday due date the Discord reminder goes out.

import '@/styles/admin/emails.css'
import { useState, useEffect } from 'react'
import { CalendarBlank, Check } from '@phosphor-icons/react'
import { Sk } from '@/components/ui/Skeleton'

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
  const [saveError,  setSaveError]  = useState<string | null>(null)

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
    setSaveError(null)
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
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `Server error (${res.status})`)
      }
      const { schedule: updated } = await res.json() as { schedule: Schedule }
      setSchedule(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Couldn’t save the schedule. Try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="em-sched" aria-busy="true" aria-label="Loading the email schedule">
        <Sk w={160} h={14} />
        <Sk w={96} h={36} r={8} />
        <Sk h={36} r={8} />
      </div>
    )
  }

  return (
    <div className="em-sched">
      <div className="em-sched-head">
        <h3 className="em-sched-title"><CalendarBlank size={16} aria-hidden />Email schedule</h3>
        <label className="em-switch">
          <span>{isActive ? 'On' : 'Off'}</span>
          <input
            type="checkbox"
            role="switch"
            checked={isActive}
            aria-checked={isActive}
            aria-label="Email schedule on"
            onChange={e => { setIsActive(e.target.checked); setSaveError(null) }}
          />
          <span className="em-switch-track" aria-hidden />
        </label>
      </div>

      {isActive && (
        <>
          <div className="em-field">
            <label className="em-label" htmlFor={`em-sched-per-${clientId}`}>Emails per week</label>
            <input
              id={`em-sched-per-${clientId}`}
              className="input"
              type="number" min="1" max="7"
              value={emailsPerWeek}
              onChange={e => setEmailsPerWeek(Math.max(1, parseInt(e.target.value) || 1))}
            />
          </div>

          <div className="em-field">
            <label className="em-label" htmlFor={`em-sched-user-${clientId}`}>Assigned to</label>
            <select id={`em-sched-user-${clientId}`} className="input" value={assignedUserId} onChange={e => setAssignedUserId(e.target.value)}>
              <option value="">Unassigned</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>

          <div className="em-field">
            <label className="em-label" htmlFor={`em-sched-rem-${clientId}`}>Reminder, days before it’s due</label>
            <input
              id={`em-sched-rem-${clientId}`}
              className="input"
              type="number" min="0" max="14"
              value={reminderDaysBefore}
              onChange={e => setReminderDaysBefore(Math.max(0, parseInt(e.target.value) || 0))}
            />
            <p className="em-hint">The Discord reminder goes out this many days before the weekly due date (Friday).</p>
          </div>
        </>
      )}

      <div className="em-sched-save">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save schedule'}
        </button>
        {saved && <span className="em-ok" role="status"><Check size={13} weight="bold" aria-hidden />Saved</span>}
        {!schedule && !saveError && !saved && (
          <span className="em-hint" style={{ margin: 0 }}>No schedule yet. Saving creates one.</span>
        )}
      </div>

      {saveError && <div className="ui-notice ui-notice--danger" role="alert" style={{ margin: 0 }}>{saveError}</div>}
    </div>
  )
}
