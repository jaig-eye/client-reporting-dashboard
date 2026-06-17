'use client'

import { useState, useEffect, useCallback } from 'react'

interface Token {
  id:           string
  token_prefix: string
  label:        string
  created_at:   string
  last_used_at: string | null
}

interface Props {
  appUrl: string
}

export default function McpTokens({ appUrl }: Props) {
  const [tokens,    setTokens]    = useState<Token[]>([])
  const [loading,   setLoading]   = useState(true)
  const [label,     setLabel]     = useState('')
  const [generating, setGenerating] = useState(false)
  const [newToken,  setNewToken]  = useState<string | null>(null)
  const [copied,    setCopied]    = useState(false)
  const [revoking,  setRevoking]  = useState<string | null>(null)

  const fetchTokens = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/mcp-tokens')
    const data = await res.json()
    setTokens(data.tokens ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchTokens() }, [fetchTokens])

  async function handleGenerate() {
    setGenerating(true)
    const res  = await fetch('/api/admin/mcp-tokens', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ label: label.trim() || 'My Token' }),
    })
    const data = await res.json()
    setNewToken(data.token)
    setLabel('')
    setGenerating(false)
    fetchTokens()
  }

  async function handleRevoke(id: string) {
    setRevoking(id)
    await fetch(`/api/admin/mcp-tokens/${id}`, { method: 'DELETE' })
    setRevoking(null)
    fetchTokens()
  }

  function copySnippet() {
    if (!newToken) return
    const snippet = `DASHBOARD_MCP_SECRET=${newToken}\nDASHBOARD_MCP_URL=${appUrl}`
    navigator.clipboard.writeText(snippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="card p-6">
      <h2 className="section-title mb-1">Claude Code MCP</h2>
      <p className="section-desc mb-5">
        Generate a personal access token to connect Claude Code to this dashboard.
        Each team member should have their own token.
      </p>

      {newToken ? (
        <div className="space-y-3 mb-6">
          <div
            className="rounded-lg px-4 py-3 text-sm"
            style={{ background: 'var(--green-subtle)', border: '1px solid #bbf7d0', color: 'var(--green)' }}
          >
            Token generated — copy it now. It won&apos;t be shown again.
          </div>

          <div>
            <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-muted)' }}>
              Add to your <code className="font-mono">.env.local</code>
            </label>
            <div className="relative">
              <pre
                className="rounded-lg px-3 py-3 text-xs font-mono leading-relaxed"
                style={{ background: 'var(--bg-subtle)', color: 'var(--text-primary)', overflowX: 'auto' }}
              >
                {`DASHBOARD_MCP_SECRET=${newToken}`}{'\n'}{`DASHBOARD_MCP_URL=${appUrl}`}
              </pre>
              <button
                onClick={copySnippet}
                className="btn btn-secondary absolute top-2 right-2"
                style={{ padding: '0.25rem 0.625rem', fontSize: '0.7rem' }}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
            Restart Claude Code after saving. The dashboard MCP will appear in{' '}
            <code className="font-mono">/mcp</code>.
          </p>

          <button
            className="btn btn-secondary"
            style={{ fontSize: '0.8rem' }}
            onClick={() => setNewToken(null)}
          >
            Done
          </button>
        </div>
      ) : (
        <div className="flex gap-2 mb-5">
          <input
            className="input flex-1"
            placeholder="Label (e.g. MacBook Pro)"
            value={label}
            onChange={e => setLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleGenerate() }}
          />
          <button className="btn btn-primary" onClick={handleGenerate} disabled={generating}>
            {generating ? 'Generating…' : 'Generate Token'}
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
      ) : tokens.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-faint)' }}>No active tokens.</p>
      ) : (
        <div className="space-y-2">
          {tokens.map(t => (
            <div
              key={t.id}
              className="flex items-center justify-between rounded-lg px-3 py-2.5"
              style={{ background: 'var(--bg-subtle)' }}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                  {t.label}
                </p>
                <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {t.token_prefix}…
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>
                  Created {new Date(t.created_at).toLocaleDateString()}
                  {t.last_used_at && (
                    <> · Last used {new Date(t.last_used_at).toLocaleDateString()}</>
                  )}
                </p>
              </div>
              <button
                className="btn btn-danger flex-shrink-0 ml-3"
                style={{ padding: '0.25rem 0.625rem', fontSize: '0.75rem' }}
                onClick={() => handleRevoke(t.id)}
                disabled={revoking === t.id}
              >
                {revoking === t.id ? 'Revoking…' : 'Revoke'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
