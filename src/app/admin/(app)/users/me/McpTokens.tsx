'use client'

// Personal access tokens for the dashboard's MCP server (Claude Code). A new token is shown once,
// as the two lines to paste into .env.local; after that only its first characters are kept.

import { useState, useEffect, useCallback } from 'react'
import { Check, Copy, Key, Plus } from '@phosphor-icons/react'
import Section from '@/components/ui/Section'
import Field from '@/components/ui/Field'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { copyText } from '@/components/ui/ActionMenu'
import { Sk } from '@/components/ui/Skeleton'

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

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export default function McpTokens({ appUrl }: Props) {
  const [tokens,    setTokens]    = useState<Token[]>([])
  const [loading,   setLoading]   = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [label,     setLabel]     = useState('')
  const [generating, setGenerating] = useState(false)
  const [newToken,  setNewToken]  = useState<string | null>(null)
  const [copied,    setCopied]    = useState(false)
  const [revoking,  setRevoking]  = useState<Token | null>(null)
  const [errorMsg,  setErrorMsg]  = useState<string | null>(null)

  const fetchTokens = useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const res = await fetch('/api/admin/mcp-tokens')
      if (!res.ok) throw new Error()
      const data = await res.json()
      setTokens(data.tokens ?? [])
    } catch {
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchTokens() }, [fetchTokens])

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault()
    setGenerating(true)
    setErrorMsg(null)
    try {
      const res  = await fetch('/api/admin/mcp-tokens', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ label: label.trim() || 'My Token' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'The token wasn’t created. Try again.')
      setNewToken(data.token)
      setLabel('')
      fetchTokens()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'The token wasn’t created. Try again.')
    } finally {
      setGenerating(false)
    }
  }

  async function revoke() {
    if (!revoking) return
    const res = await fetch(`/api/admin/mcp-tokens/${revoking.id}`, { method: 'DELETE' }).catch(() => null)
    if (!res) throw new Error('No answer from the server. Check your connection and try again.')
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error ?? 'The token wasn’t revoked. Try again.')
    }
    setRevoking(null)
    fetchTokens()
  }

  async function copySnippet() {
    if (!newToken) return
    // copyText falls back to the older copy command where the Clipboard API is refused, as
    // inside the CRM's iframe.
    if (await copyText(`DASHBOARD_MCP_SECRET=${newToken}\nDASHBOARD_MCP_URL=${appUrl}`)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <Section
      title="Claude Code access"
      description="A personal token connects Claude Code to this dashboard through its MCP server. Each person should have their own."
    >
      <div className="ui-fields">
        {errorMsg && <div className="ui-notice ui-notice--danger" role="alert" style={{ margin: 0 }}>{errorMsg}</div>}

        {newToken ? (
          <div className="ui-fields" style={{ gap: 12 }}>
            <div className="ui-notice ui-notice--success" role="status" style={{ margin: 0 }}>
              Token created. Copy it now: it won’t be shown again.
            </div>
            <Field label={<>Add these lines to your <code>.env.local</code></>} hint={<>Then restart Claude Code. The dashboard appears under <code>/mcp</code>.</>}>
              <pre className="us-snippet">
                {`DASHBOARD_MCP_SECRET=${newToken}`}{'\n'}{`DASHBOARD_MCP_URL=${appUrl}`}
                <button type="button" className="btn btn-secondary btn-sm us-snippet-copy" onClick={copySnippet}>
                  {copied ? <Check size={14} weight="bold" aria-hidden /> : <Copy size={14} aria-hidden />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </pre>
            </Field>
            <div className="us-actions" style={{ justifyContent: 'flex-start' }}>
              <button type="button" className="btn btn-secondary" onClick={() => { setNewToken(null); setCopied(false) }}>Done</button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleGenerate}>
            <Field label="New token" id="mcp-label" hint="Name it after the computer it’s for, so you know which one to revoke.">
              <div className="us-new-token">
                <input id="mcp-label" className="input" placeholder="MacBook Pro" aria-describedby="mcp-label-hint"
                  value={label} onChange={e => setLabel(e.target.value)} />
                <button type="submit" className="btn btn-primary" disabled={generating}>
                  <Plus size={15} weight="bold" aria-hidden />{generating ? 'Creating…' : 'Create token'}
                </button>
              </div>
            </Field>
          </form>
        )}

        <div>
          <p className="ui-field-label" style={{ margin: '0 0 2px' }}>Your tokens</p>
          {loading ? (
            <div aria-busy="true" aria-label="Loading tokens">
              {[0, 1].map(i => (
                <div key={i} className="us-token"><span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}><Sk w="30%" h={12} /><Sk w="55%" h={10} /></span><Sk w={72} h={32} r={6} /></div>
              ))}
            </div>
          ) : loadFailed ? (
            <div className="ui-notice ui-notice--danger" role="alert" style={{ margin: '8px 0 0' }}>
              <span>Your tokens didn’t load.</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={fetchTokens}>Try again</button>
            </div>
          ) : tokens.length === 0 ? (
            <p className="ui-field-hint" style={{ padding: '6px 0' }}>None yet. Create one above when you set Claude Code up.</p>
          ) : (
            tokens.map(t => (
              <div key={t.id} className="us-token">
                <span className="ui-tile ui-tile--sm" aria-hidden><Key size={14} /></span>
                <div className="us-token-text">
                  <p className="us-token-name">{t.label}</p>
                  <p className="us-token-meta">
                    <code>{t.token_prefix}…</code> · Created {day(t.created_at)} · {t.last_used_at ? `Last used ${day(t.last_used_at)}` : 'Never used'}
                  </p>
                </div>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => setRevoking(t)}>Revoke</button>
              </div>
            ))
          )}
        </div>
      </div>

      <ConfirmDialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        title={`Revoke “${revoking?.label ?? ''}”?`}
        confirmLabel="Revoke token"
        busyLabel="Revoking…"
        tone="danger"
        onConfirm={revoke}
      >
        <p>Any Claude Code session using it loses access to the dashboard straight away.</p>
      </ConfirmDialog>
    </Section>
  )
}
