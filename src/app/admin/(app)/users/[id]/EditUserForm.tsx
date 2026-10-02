'use client'

// Edit User Form — used by super admin on /admin/users/[id]
// Can update name, email, role, active status, and reset password.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle } from '@phosphor-icons/react'
import type { User } from '@/lib/types'
import Section from '@/components/ui/Section'
import Field from '@/components/ui/Field'
import { SwitchRow } from '@/components/ui/Switch'
import { ConfirmDialog } from '@/components/ui/Dialog'

export default function EditUserForm({ user }: { user: User }) {
  const router = useRouter()

  const [form, setForm] = useState({
    name:      user.name,
    email:     user.email,
    username:  user.username ?? '',
    role:      user.role as 'admin' | 'viewer',
    is_active: user.is_active,
  })
  const [newPassword, setNewPassword] = useState('')
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setSaved(false)
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    setError('')

    const body: Record<string, unknown> = { ...form }
    if (newPassword) {
      if (newPassword.length < 8) {
        setError('The new password needs at least 8 characters.')
        setSaving(false)
        return
      }
      body.password = newPassword
    }

    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok || data.error) {
        setError(data.error || 'The changes weren’t saved. Try again.')
      } else {
        setSaved(true)
        setNewPassword('')
        router.refresh()
      }
    } catch {
      setError('The changes weren’t saved. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    const res = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' }).catch(() => null)
    if (!res) throw new Error('No answer from the server. Check your connection and try again.')
    if (!res.ok) {
      const d = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(d.error || `${user.name} wasn’t deleted.`)
    }
    router.push('/admin/users')
    router.refresh()
  }

  return (
    <div className="ui-stack">
      <form onSubmit={handleSave} className="ui-stack">
        <Section title="Account" description="Who this is and how they sign in.">
          <div className="ui-fields">
            <Field label="Full name" id="eu-name">
              <input id="eu-name" className="input" required autoComplete="off"
                value={form.name} onChange={e => set('name', e.target.value)} />
            </Field>
            <Field label="Email" id="eu-email">
              <input id="eu-email" className="input" type="email" required autoComplete="off"
                value={form.email} onChange={e => set('email', e.target.value)} />
            </Field>
            <Field label="Username" id="eu-username" hint="Optional. A shorter name they can sign in with instead of their email.">
              <input id="eu-username" className="input" type="text" placeholder="rob" autoComplete="off" aria-describedby="eu-username-hint"
                value={form.username} onChange={e => set('username', e.target.value)} />
            </Field>
            <Field label="Role" id="eu-role" hint={form.role === 'admin' ? 'Full access, including adding users.' : 'Can look at everything and change nothing.'}>
              <select id="eu-role" className="input" aria-describedby="eu-role-hint"
                value={form.role} onChange={e => set('role', e.target.value as 'admin' | 'viewer')}>
                <option value="admin">Admin</option>
                <option value="viewer">Viewer</option>
              </select>
            </Field>
          </div>
        </Section>

        <Section title="Access">
          <SwitchRow
            title="Active"
            description="When it’s off, they can’t sign in."
            checked={form.is_active}
            onChange={v => set('is_active', v)}
          />
          <div className="ui-setting" style={{ display: 'block' }}>
            <Field label="New password" id="eu-password" hint="Leave it blank to keep their current password. At least 8 characters.">
              <input id="eu-password" className="input" type="password" minLength={8} autoComplete="new-password" aria-describedby="eu-password-hint"
                value={newPassword} onChange={e => { setSaved(false); setNewPassword(e.target.value) }} />
            </Field>
          </div>
        </Section>

        {error && <div className="ui-notice ui-notice--danger" role="alert" style={{ margin: 0 }}>{error}</div>}

        <div className="us-actions">
          {saved && <span className="us-saved" role="status"><CheckCircle size={16} weight="fill" aria-hidden />Saved</span>}
          <Link href="/admin/users" className="btn btn-secondary">Back to users</Link>
          <button type="submit" disabled={saving} className="btn btn-primary">{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>

      <Section
        title="Delete user"
        description={`${user.name} won’t be able to sign in again. This can’t be undone.`}
        actions={<button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>Delete user</button>}
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${user.name}?`}
        confirmLabel="Delete user"
        busyLabel="Deleting…"
        tone="danger"
        onConfirm={handleDelete}
      >
        <p>{user.name.split(' ')[0]} won’t be able to sign in again. This can’t be undone.</p>
      </ConfirmDialog>
    </div>
  )
}
