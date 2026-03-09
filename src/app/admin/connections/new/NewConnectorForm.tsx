'use client'

// Form for manually entering connector credentials.
// For Google Ads: accepts a Developer Token + MCC Customer ID (or OAuth later).
// For Meta Ads: accepts a System User Access Token + Business Account ID.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ConnectorType } from '@/lib/types'

interface FieldDef {
  key: string
  label: string
  type: 'text' | 'password'
  placeholder: string
  hint?: string
  authOrConfig: 'auth' | 'config'
}

const FIELDS: Record<string, FieldDef[]> = {
  google_ads: [
    {
      key: 'developer_token',
      label: 'Developer Token',
      type: 'password',
      placeholder: 'ABcd1234…',
      hint: 'Found in Google Ads API Center under your MCC account.',
      authOrConfig: 'auth',
    },
    {
      key: 'customer_id',
      label: 'MCC Customer ID',
      type: 'text',
      placeholder: '123-456-7890',
      hint: 'The top-level manager account ID (no dashes required).',
      authOrConfig: 'config',
    },
  ],
  meta_ads: [
    {
      key: 'access_token',
      label: 'System User Access Token',
      type: 'password',
      placeholder: 'EAABs…',
      hint: 'Generate a System User token in Meta Business Suite with ads_read permission.',
      authOrConfig: 'auth',
    },
    {
      key: 'business_id',
      label: 'Business Account ID',
      type: 'text',
      placeholder: '1234567890',
      hint: 'Found in Meta Business Suite settings.',
      authOrConfig: 'config',
    },
  ],
}

export default function NewConnectorForm({ type }: { type: ConnectorType }) {
  const router = useRouter()
  const fields  = FIELDS[type] ?? []
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map(f => [f.key, '']))
  )
  const [label,   setLabel]   = useState('')
  const [status,  setStatus]  = useState<'idle' | 'saving' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('saving')
    setErrorMsg('')

    const auth:   Record<string, string> = {}
    const config: Record<string, string> = {}

    for (const field of fields) {
      if (field.authOrConfig === 'auth') auth[field.key] = values[field.key]
      else config[field.key] = values[field.key]
    }

    try {
      const res = await fetch('/api/admin/connectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, label: label || undefined, auth, config }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to save connector')
      }
      router.push('/admin/connections')
      router.refresh()
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {status === 'error' && errorMsg && (
        <div
          className="rounded-xl px-4 py-3 text-sm"
          style={{ background: 'var(--red-subtle)', border: '1px solid #fecaca', color: 'var(--red)' }}
        >
          {errorMsg}
        </div>
      )}

      <div>
        <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
          Label <span style={{ color: 'var(--text-faint)' }}>(optional)</span>
        </label>
        <input
          className="input"
          placeholder="e.g. Main Agency Account"
          value={label}
          onChange={e => setLabel(e.target.value)}
        />
      </div>

      {fields.map(field => (
        <div key={field.key}>
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
            {field.label}
          </label>
          <input
            className="input"
            type={field.type}
            placeholder={field.placeholder}
            value={values[field.key]}
            onChange={e => setValues(v => ({ ...v, [field.key]: e.target.value }))}
            required
          />
          {field.hint && (
            <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>{field.hint}</p>
          )}
        </div>
      ))}

      <div className="flex items-center gap-3 pt-2">
        <button type="submit" className="btn btn-primary" disabled={status === 'saving'}>
          {status === 'saving' ? 'Connecting…' : 'Connect'}
        </button>
        <a href="/admin/connections" className="btn btn-secondary">Cancel</a>
      </div>
    </form>
  )
}
