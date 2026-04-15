'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  clientId: string
  name: string
  slug: string
}

export default function EditClientInfo({ clientId, name, slug }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [values,  setValues]  = useState({ name, slug })
  const [status,  setStatus]  = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  function field<K extends keyof typeof values>(key: K, val: string) {
    setValues(v => ({ ...v, [key]: val }))
    setStatus('idle')
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setStatus('saving')
    setErrorMsg('')
    try {
      const res = await fetch(`/api/admin/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      setStatus('success')
      setEditing(false)
      router.refresh()
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  if (!editing) {
    return (
      <div className="space-y-2 text-sm">
        <Row label="Name"  value={values.name} />
        <Row label="Slug"  value={values.slug} mono />
        <button
          onClick={() => setEditing(true)}
          className="btn btn-secondary mt-1"
          style={{ padding: '0.3rem 0.7rem', fontSize: '0.75rem' }}
        >
          Edit
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSave} className="space-y-3">
      {status === 'error' && errorMsg && (
        <p className="text-xs" style={{ color: 'var(--red)' }}>{errorMsg}</p>
      )}
      {(['name', 'slug'] as const).map(k => (
        <div key={k}>
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
            {k.charAt(0).toUpperCase() + k.slice(1)}
          </label>
          <input
            className="input"
            value={values[k]}
            onChange={e => field(k, e.target.value)}
            required
          />
        </div>
      ))}
      <div className="flex items-center gap-2">
        <button type="submit" className="btn btn-primary" disabled={status === 'saving'}
          style={{ padding: '0.3rem 0.7rem', fontSize: '0.75rem' }}>
          {status === 'saving' ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => { setEditing(false); setValues({ name, slug }) }}
          style={{ padding: '0.3rem 0.7rem', fontSize: '0.75rem' }}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className={mono ? 'font-mono text-xs' : 'text-sm'} style={{ color: 'var(--text-secondary)' }}>
        {value}
      </p>
    </div>
  )
}
