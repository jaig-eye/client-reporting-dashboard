'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Connector } from '@/lib/types'

// Reconnect buttons — start a fresh OAuth flow while preserving existing config
function ReconnectSection({ connector }: { connector: Connector }) {
  if (connector.type === 'google_ads') {
    const config = (connector.config ?? {}) as Record<string, string>
    const mcc    = config.mcc_customer_id ?? ''
    // Send the connector ID, never the token. This link is an href, so anything in it
    // ends up in browser history and server access logs — and reading the token here at
    // all required shipping connector.auth into a client component, which put every
    // credential on the row into the page HTML. The route now looks it up server-side.
    const params = new URLSearchParams({ connector_type: 'google_ads', connector_id: connector.id })
    if (mcc) params.set('mcc_customer_id', mcc)
    return (
      <div className="pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
          Reconnect Google Account
        </h3>
        <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
          Re-authorize if the connection has expired or you want to switch Google accounts.
        </p>
        <a href={`/api/auth/google/start?${params}`} className="btn btn-secondary">
          Reconnect with Google
        </a>
      </div>
    )
  }

  if (connector.type === 'google_analytics') {
    return (
      <div className="pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Reconnect Google Account</h3>
        <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>Re-authorize if the connection has expired.</p>
        <a href="/api/auth/google/start?connector_type=google_analytics" className="btn btn-secondary">Reconnect Google Analytics</a>
      </div>
    )
  }

  if (connector.type === 'google_search_console') {
    return (
      <div className="pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Reconnect Google Account</h3>
        <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>Re-authorize if the connection has expired.</p>
        <a href="/api/auth/google/start?connector_type=google_search_console" className="btn btn-secondary">Reconnect Search Console</a>
      </div>
    )
  }

  if (connector.type === 'google_business_profile') {
    return (
      <div className="pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Reconnect Google Account</h3>
        <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>Re-authorize if the connection has expired.</p>
        <a href="/api/auth/google/start?connector_type=google_business_profile" className="btn btn-secondary">Reconnect Business Profile</a>
      </div>
    )
  }

  if (connector.type === 'meta_ads') {
    return (
      <div className="pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
          Reconnect Facebook Account
        </h3>
        <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
          Re-authorize if the 60-day token has expired or you want to switch accounts.
        </p>
        <a href="/api/auth/meta/start" className="btn btn-secondary">
          Reconnect with Facebook
        </a>
      </div>
    )
  }

  return null
}

// Ahrefs-specific test connection button + status badge
function AhrefsStatusSection({ connector }: { connector: Connector }) {
  const [testing,   setTesting]   = useState(false)
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null)
  const config  = (connector.config ?? {}) as Record<string, string>
  const errMsg  = config.error ?? ''

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const res  = await fetch(`/api/admin/connectors/${connector.id}/test`, { method: 'POST' })
      const data = await res.json()
      setTestResult(data.ok ? 'ok' : 'fail')
    } catch {
      setTestResult('fail')
    } finally {
      setTesting(false)
    }
  }

  const isActive = connector.status === 'active' || testResult === 'ok'
  const isError  = connector.status === 'error'  || testResult === 'fail'

  return (
    <div className="pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center gap-3 mb-3">
        <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          Connection Status
        </h3>
        {isActive && (
          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: 'var(--green-subtle)', color: 'var(--green)', border: '1px solid #bbf7d0' }}>
            Connected
          </span>
        )}
        {isError && (
          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: 'var(--red-subtle)', color: 'var(--red)', border: '1px solid #fecaca' }}>
            Error
          </span>
        )}
        {!isActive && !isError && (
          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: 'var(--yellow-subtle, #fefce8)', color: 'var(--text-muted)', border: '1px solid var(--yellow-border, #fde68a)' }}>
            Pending
          </span>
        )}
      </div>
      {isError && errMsg && (
        <p className="text-xs mb-3" style={{ color: 'var(--red)' }}>{errMsg}</p>
      )}
      <button type="button" onClick={handleTest} disabled={testing} className="btn btn-secondary">
        {testing ? 'Testing…' : 'Test Connection'}
      </button>
      {testResult === 'ok'   && <span className="text-xs ml-3" style={{ color: 'var(--green)' }}>API key is valid.</span>}
      {testResult === 'fail' && <span className="text-xs ml-3" style={{ color: 'var(--red)' }}>API key invalid or unreachable.</span>}
    </div>
  )
}

// Editable config fields per connector type
const CONFIG_FIELDS: Record<string, { key: string; label: string; placeholder: string; hint: string }[]> = {
  google_ads: [
    {
      key:         'mcc_customer_id',
      label:       'MCC Customer ID',
      placeholder: '1234567890',
      hint:        'Top-level manager account ID (digits only, no dashes).',
    },
  ],
  meta_ads: [
    {
      key:         'business_manager_id',
      label:       'Business Manager ID',
      placeholder: '1234567890',
      hint:        'Found in Meta Business Suite → Settings (optional).',
    },
  ],
}

// Editable auth fields (sensitive — shown as password inputs, saved via auth_patch)
const AUTH_FIELDS: Record<string, { key: string; label: string; placeholder: string; hint: string }[]> = {
  google_ads: [
    {
      key:         'developer_token',
      label:       'Developer Token',
      placeholder: 'Leave blank to keep existing',
      hint:        'Found in Google Ads → Admin → API Center under your MCC account.',
    },
  ],
  meta_ads: [],
  ahrefs: [
    {
      key:         'api_key',
      label:       'API Key',
      placeholder: 'Leave blank to keep existing',
      hint:        'Found in Ahrefs → Account Settings → API. Requires a Standard plan or above.',
    },
  ],
}

export default function EditConnectorForm({ connector }: { connector: Connector }) {
  const router      = useRouter()
  const config      = (connector.config ?? {}) as Record<string, string>
  const fields      = CONFIG_FIELDS[connector.type] ?? []
  const authFields  = AUTH_FIELDS[connector.type]   ?? []

  const [label,         setLabel]         = useState(connector.label ?? '')
  const [configVals,    setConfigVals]     = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map(f => [f.key, (config[f.key] as string) ?? '']))
  )
  const [authVals,      setAuthVals]       = useState<Record<string, string>>(() =>
    Object.fromEntries(authFields.map(f => [f.key, '']))
  )
  const [status,        setStatus]        = useState<'idle' | 'saving' | 'deleting' | 'success' | 'error'>('idle')
  const [errorMsg,      setErrorMsg]      = useState('')
  const [showDelete,    setShowDelete]    = useState(false)
  const [discovering,   setDiscovering]   = useState(false)
  const [discoverMsg,   setDiscoverMsg]   = useState('')
  const [discoverError, setDiscoverError] = useState('')

  async function handleDiscover() {
    setDiscovering(true)
    setDiscoverMsg('')
    setDiscoverError('')
    try {
      const res  = await fetch(`/api/admin/connectors/${connector.id}/discover`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Discovery failed')
      setDiscoverMsg(`Found ${data.count} account${data.count !== 1 ? 's' : ''}.`)
      router.refresh()
    } catch (e) {
      setDiscoverError(e instanceof Error ? e.message : 'Discovery failed')
    } finally {
      setDiscovering(false)
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setStatus('saving')
    setErrorMsg('')
    try {
      const newConfig: Record<string, string> = { ...config }
      for (const f of fields) {
        if (configVals[f.key] !== undefined) newConfig[f.key] = configVals[f.key]
      }

      // Only include auth fields that were actually filled in
      const authPatch: Record<string, string> = {}
      for (const f of authFields) {
        if (authVals[f.key]?.trim()) authPatch[f.key] = authVals[f.key].trim()
      }

      const res = await fetch(`/api/admin/connectors/${connector.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label,
          config: newConfig,
          ...(Object.keys(authPatch).length > 0 ? { auth_patch: authPatch } : {}),
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to save')
      }
      setStatus('success')
      setTimeout(() => setStatus('idle'), 3000)
      router.refresh()
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  async function handleDelete() {
    setStatus('deleting')
    try {
      const res = await fetch(`/api/admin/connectors/${connector.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to delete')
      }
      window.location.href = '/admin/connections'
      router.refresh()
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div className="space-y-4">
      {status === 'success' && (
        <div className="rounded-xl px-4 py-3 text-sm"
          style={{ background: 'var(--green-subtle)', border: '1px solid #bbf7d0', color: 'var(--green)' }}>
          Saved successfully.
        </div>
      )}
      {status === 'error' && errorMsg && (
        <div className="rounded-xl px-4 py-3 text-sm"
          style={{ background: 'var(--red-subtle)', border: '1px solid #fecaca', color: 'var(--red)' }}>
          {errorMsg}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
            Label
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
              {f.label}
            </label>
            <input
              className="input"
              type="text"
              placeholder={f.placeholder}
              value={configVals[f.key] ?? ''}
              onChange={e => setConfigVals(v => ({ ...v, [f.key]: e.target.value }))}
            />
            <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>{f.hint}</p>
          </div>
        ))}

        {authFields.map(f => (
          <div key={f.key}>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
              {f.label}
            </label>
            <input
              className="input"
              type="password"
              placeholder={f.placeholder}
              value={authVals[f.key] ?? ''}
              onChange={e => setAuthVals(v => ({ ...v, [f.key]: e.target.value }))}
            />
            <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>{f.hint}</p>
          </div>
        ))}

        <div className="flex items-center gap-3">
          <button type="submit" className="btn btn-primary" disabled={status === 'saving'}>
            {status === 'saving' ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>

      {/* Ahrefs: test connection + status badge */}
      {connector.type === 'ahrefs' && <AhrefsStatusSection connector={connector} />}

      {/* Refresh discovered accounts — not applicable for domain-based connectors like Ahrefs */}
      {connector.type !== 'ahrefs' && <div className="pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
          Discovered Accounts
        </h3>
        <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
          Refresh the list of ad accounts available under this connection. Used for the account
          dropdown when connecting a client.
        </p>
        {discoverMsg && (
          <p className="text-xs mb-2" style={{ color: 'var(--green)' }}>{discoverMsg}</p>
        )}
        {discoverError && (
          <p className="text-xs mb-2" style={{ color: 'var(--red)' }}>{discoverError}</p>
        )}
        <button
          type="button"
          onClick={handleDiscover}
          disabled={discovering}
          className="btn btn-secondary"
        >
          {discovering ? 'Refreshing…' : 'Refresh Accounts'}
        </button>
      </div>}

      <ReconnectSection connector={connector} />

      <div className="pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
          Danger Zone
        </h3>
        <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
          Deleting this connector will disconnect all client accounts using it. Metrics data is preserved.
        </p>
        {!showDelete ? (
          <button onClick={() => setShowDelete(true)} className="btn btn-danger">
            Delete Connector
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <button
              onClick={handleDelete}
              className="btn btn-danger"
              disabled={status === 'deleting'}
            >
              {status === 'deleting' ? 'Deleting…' : 'Confirm Delete'}
            </button>
            <button onClick={() => setShowDelete(false)} className="btn btn-secondary">
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
