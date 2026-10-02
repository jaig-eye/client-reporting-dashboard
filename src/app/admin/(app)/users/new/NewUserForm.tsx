'use client'

// The add-user form. The page in front of it (page.tsx) decides who may see it; the API
// decides who may use it. Both admit admins and the super admin, and refuse viewers.

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import PageHeader from '@/components/ui/PageHeader'
import Section from '@/components/ui/Section'
import Field from '@/components/ui/Field'

export default function NewUserForm() {
  const router = useRouter()
  const [form, setForm] = useState({
    name:     '',
    email:    '',
    username: '',
    password: '',
    role:     'admin' as 'admin' | 'viewer',
  })
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (form.password.length < 8) {
      setError('The temporary password needs at least 8 characters.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/users', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok || data.error) {
        setError(data.error || 'The user wasn’t created. Try again.')
        setLoading(false)
      } else {
        router.push('/admin/users')
        router.refresh()
      }
    } catch {
      setError('The user wasn’t created. Check your connection and try again.')
      setLoading(false)
    }
  }

  return (
    <div className="us-page">
      <PageHeader
        back={{ href: '/admin/users', label: 'Users' }}
        title="Add a user"
        description="They sign in with their email and the temporary password, then choose their own."
      />

      <form onSubmit={handleSubmit} className="ui-stack">
        <Section title="Their details">
          <div className="ui-fields">
            <Field label="Full name" id="nu-name">
              <input id="nu-name" className="input" required placeholder="Jane Smith" autoComplete="off"
                value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </Field>
            <Field label="Email" id="nu-email">
              <input id="nu-email" className="input" type="email" required placeholder="jane@agency.com" autoComplete="off"
                value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </Field>
            <Field label="Username" id="nu-username" hint="Optional. A shorter name they can sign in with instead of their email.">
              <input id="nu-username" className="input" type="text" placeholder="jane" autoComplete="off" aria-describedby="nu-username-hint"
                value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
            </Field>
            <Field label="Temporary password" id="nu-password" hint="At least 8 characters. The first time they sign in, we email them a code to choose their own.">
              <input id="nu-password" className="input" type="password" required minLength={8} autoComplete="new-password" aria-describedby="nu-password-hint"
                value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
            </Field>
            <Field label="Role" id="nu-role" hint={form.role === 'admin' ? 'Full access, including adding users.' : 'Can look at everything and change nothing.'}>
              <select id="nu-role" className="input" aria-describedby="nu-role-hint"
                value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as 'admin' | 'viewer' }))}>
                <option value="admin">Admin</option>
                <option value="viewer">Viewer</option>
              </select>
            </Field>
          </div>
        </Section>

        {error && <div className="ui-notice ui-notice--danger" role="alert" style={{ margin: 0 }}>{error}</div>}

        <div className="us-actions">
          <Link href="/admin/users" className="btn btn-secondary">Cancel</Link>
          <button type="submit" disabled={loading} className="btn btn-primary">{loading ? 'Adding…' : 'Add user'}</button>
        </div>
      </form>
    </div>
  )
}
