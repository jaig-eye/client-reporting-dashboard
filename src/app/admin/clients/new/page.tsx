'use client'

// New Client — /admin/clients/new
// Light theme. Creates a new client and redirects to their detail page to connect data sources.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function NewClientPage() {
  const router = useRouter()
  const [form, setForm] = useState({ name: '', email: '', slug: '' })
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  function slugify(s: string) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/admin/clients', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(form),
    })
    const data = await res.json()
    if (data.error) { setError(data.error); setLoading(false) }
    else router.push(`/admin/clients/${data.id}`)
  }

  return (
    <div className="max-w-md">
      <div className="flex items-center gap-2 mb-6 text-sm">
        <Link href="/admin/clients" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
          Clients
        </Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>New Client</span>
      </div>

      <div className="card p-6">
        <h1 className="text-base font-semibold mb-5" style={{ color: 'var(--text-primary)' }}>
          Add Client
        </h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
              Client / Company Name
            </label>
            <input
              type="text"
              required
              className="input"
              placeholder="Acme Corp"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value, slug: slugify(e.target.value) }))}
            />
          </div>

          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
              Email
              <span className="ml-1 font-normal" style={{ color: 'var(--text-faint)' }}>— for your records</span>
            </label>
            <input
              type="email"
              required
              className="input"
              placeholder="contact@acmecorp.com"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            />
          </div>

          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
              URL Slug
              <span className="ml-1 font-normal" style={{ color: 'var(--text-faint)' }}>— auto-generated</span>
            </label>
            <input
              type="text"
              className="input font-mono text-sm"
              placeholder="acme-corp"
              value={form.slug}
              onChange={e => setForm(f => ({ ...f, slug: slugify(e.target.value) }))}
            />
          </div>

          {error && <p className="text-sm" style={{ color: 'var(--red)' }}>{error}</p>}

          <div className="flex gap-3 pt-1">
            <Link href="/admin/clients" className="btn btn-secondary flex-1 justify-center">
              Cancel
            </Link>
            <button type="submit" disabled={loading} className="btn btn-primary flex-1 justify-center">
              {loading ? 'Creating…' : 'Create → Connect Accounts'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
