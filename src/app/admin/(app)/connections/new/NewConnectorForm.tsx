'use client'

// Connector setup — manual credential entry for Google Ads and Meta Ads.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ConnectorType } from '@/lib/types'

interface Field {
  key: string
  label: string
  type: 'text' | 'password'
  placeholder: string
  hint?: string
  required?: boolean
  authOrConfig: 'auth' | 'config'
}

const FIELDS: Record<string, Field[]> = {
  google_ads: [
    {
      key: 'developer_token',
      label: 'Developer Token',
      type: 'password',
      placeholder: 'ABcd1234…',
      hint: 'Found in Google Ads → Admin → API Center under your MCC account.',
      required: true,
      authOrConfig: 'auth',
    },
    {
      key: 'client_id',
      label: 'OAuth Client ID',
      type: 'text',
      placeholder: '1234567890-abc.apps.googleusercontent.com',
      hint: 'From Google Cloud Console → APIs & Services → Credentials → your OAuth 2.0 Client ID.',
      required: true,
      authOrConfig: 'auth',
    },
    {
      key: 'client_secret',
      label: 'OAuth Client Secret',
      type: 'password',
      placeholder: 'GOCSPX-…',
      hint: 'Client secret from the same OAuth 2.0 credential in Google Cloud Console.',
      required: true,
      authOrConfig: 'auth',
    },
    {
      key: 'refresh_token',
      label: 'OAuth Refresh Token',
      type: 'password',
      placeholder: '1//0g…',
      hint: 'One-time setup: go to developers.google.com/oauthplayground → ⚙ → check "Use your own OAuth credentials" → enter your Client ID & Secret → select scope "https://www.googleapis.com/auth/adwords" → authorize → exchange code for tokens → copy Refresh Token.',
      required: true,
      authOrConfig: 'auth',
    },
    {
      key: 'mcc_customer_id',
      label: 'MCC Customer ID',
      type: 'text',
      placeholder: '1234567890',
      hint: 'Top-level manager account ID (digits only, no dashes).',
      required: true,
      authOrConfig: 'config',
    },
  ],
  meta_ads: [
    {
      key: 'system_user_token',
      label: 'System User Access Token',
      type: 'password',
      placeholder: 'EAABs…',
      hint: 'Generate in Meta Business Suite → Business Settings → Users → System Users. Grant ads_read + ads_management permissions and generate a token for your App.',
      required: true,
      authOrConfig: 'auth',
    },
    {
      key: 'app_id',
      label: 'App ID',
      type: 'text',
      placeholder: '1234567890',
      hint: 'Your Meta App ID from developers.facebook.com.',
      required: false,
      authOrConfig: 'config',
    },
    {
      key: 'app_secret',
      label: 'App Secret',
      type: 'password',
      placeholder: 'abc123…',
      hint: 'Your Meta App Secret (optional).',
      required: false,
      authOrConfig: 'auth',
    },
  ],
}

export default function NewConnectorForm({ type }: { type: ConnectorType }) {
  const router = useRouter()
  const fields = FIELDS[type] ?? []

  const [values,   setValues]   = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map(f => [f.key, '']))
  )
  const [label,    setLabel]    = useState('')
  const [status,   setStatus]   = useState<'idle' | 'saving' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('saving')
    setErrorMsg('')

    const auth:   Record<string, string> = {}
    const config: Record<string, string> = {}

    for (const f of fields) {
      const v = values[f.key]?.trim()
      if (!v) continue
      if (f.authOrConfig === 'auth') auth[f.key] = v
      else config[f.key] = v
    }

    try {
      const res = await fetch('/api/admin/connectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, label: label.trim() || undefined, auth, config }),
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

  if (!fields.length) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        This connector type is not yet supported.
      </p>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {status === 'error' && errorMsg && (
        <div className="rounded-xl px-4 py-3 text-sm"
          style={{ background: 'var(--red-subtle)', border: '1px solid #fecaca', color: 'var(--red)' }}>
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

      {fields.map(f => (
        <div key={f.key}>
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
            {f.label}{' '}
            {!f.required && <span style={{ color: 'var(--text-faint)' }}>(optional)</span>}
          </label>
          <input
            className="input"
            type={f.type}
            placeholder={f.placeholder}
            value={values[f.key]}
            onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
            required={f.required}
          />
          {f.hint && (
            <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>{f.hint}</p>
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
