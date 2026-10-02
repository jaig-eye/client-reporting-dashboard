'use client'

// New Client — /admin/clients/new
// Creates a new client and opens their page, where their accounts get connected.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import PageHeader from '@/components/ui/PageHeader'
import Section from '@/components/ui/Section'
import Field from '@/components/ui/Field'

export default function NewClientPage() {
  const router = useRouter()
  const [form, setForm] = useState({ name: '', slug: '' })
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  function slugify(s: string) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/clients', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({})) as { id?: string; error?: string }
      if (!res.ok || data.error || !data.id) {
        setError(data.error || 'The client wasn’t created. Try again.')
        setLoading(false)
      } else {
        router.push(`/admin/clients/${data.id}`)
      }
    } catch {
      setError('The client wasn’t created. Check your connection and try again.')
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <PageHeader
        back={{ href: '/admin/clients', label: 'Clients' }}
        title="Add a client"
        description="Next you’ll connect their ad and analytics accounts on their page."
      />

      <form onSubmit={handleSubmit} className="ui-stack">
        <Section title="The client">
          <div className="ui-fields">
            <Field label="Company name" id="nc-name">
              <input
                id="nc-name"
                type="text"
                required
                className="input"
                placeholder="Acme Corp"
                autoComplete="off"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value, slug: slugify(e.target.value) }))}
              />
            </Field>
            <Field label="Slug" id="nc-slug" hint="A short ID made from the company name. Lowercase letters, numbers and dashes.">
              <input
                id="nc-slug"
                type="text"
                className="input"
                placeholder="acme-corp"
                autoComplete="off"
                spellCheck={false}
                aria-describedby="nc-slug-hint"
                style={{ fontVariantNumeric: 'tabular-nums' }}
                value={form.slug}
                onChange={e => setForm(f => ({ ...f, slug: slugify(e.target.value) }))}
              />
            </Field>
          </div>
        </Section>

        {error && <div className="ui-notice ui-notice--danger" role="alert" style={{ margin: 0 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          <Link href="/admin/clients" className="btn btn-secondary">Cancel</Link>
          <button type="submit" disabled={loading || !form.name.trim()} className="btn btn-primary">
            {loading ? 'Creating…' : 'Create client'}
          </button>
        </div>
      </form>
    </div>
  )
}
