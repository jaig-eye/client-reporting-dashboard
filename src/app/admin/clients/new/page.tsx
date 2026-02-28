'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function NewClientPage() {
  const router = useRouter()
  const [form, setForm] = useState({ name: '', email: '', slug: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function slugify(s: string) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/admin/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    if (data.error) { setError(data.error); setLoading(false) }
    else router.push(`/admin/clients/${data.id}`)
  }

  return (
    <div className="max-w-md">
      <h1 className="text-lg font-semibold text-white mb-6">Add Client</h1>
      <form onSubmit={handleSubmit} className="bg-[#0f1525] border border-[#1e2a40] rounded-xl p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1">Client / Company name</label>
          <input
            type="text" value={form.name} required
            onChange={e => setForm(f => ({ ...f, name: e.target.value, slug: slugify(e.target.value) }))}
            placeholder="Acme Corp"
            className="w-full bg-[#080c18] border border-[#1e2a40] text-slate-200 placeholder-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 transition-colors"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1">Email <span className="text-slate-600 font-normal">(for your records)</span></label>
          <input
            type="email" value={form.email} required
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            placeholder="contact@acmecorp.com"
            className="w-full bg-[#080c18] border border-[#1e2a40] text-slate-200 placeholder-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 transition-colors"
          />
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <div className="flex gap-3 pt-1">
          <button type="button" onClick={() => router.back()}
            className="flex-1 border border-[#1e2a40] text-slate-400 text-sm py-2.5 rounded-lg hover:border-[#2a3a54] hover:text-slate-300 transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={loading}
            className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium py-2.5 rounded-lg disabled:opacity-50 transition-colors">
            {loading ? 'Creating...' : 'Create → Connect Accounts'}
          </button>
        </div>
      </form>
    </div>
  )
}
