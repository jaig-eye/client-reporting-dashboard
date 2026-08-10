'use client'

import { useState } from 'react'

// Manual "pick a day + prompt" single-post generation.
// Generates ONE blog post that lands in the pipeline exactly like an automated
// post (status 'for_review', dated, image auto-gens per settings) via the shared
// POST /api/admin/content/generate Path B (extended to persist date + content_type).

const LENGTHS = [
  { value: '',       label: 'Use client default' },
  { value: 'short',  label: 'Short (~600 words)' },
  { value: 'medium', label: 'Medium (~1,200 words)' },
  { value: 'long',   label: 'Long (~2,000 words)' },
]

interface Props {
  clients?:          { id: string; name: string }[]  // global mount → client dropdown
  presetClientId?:   string                           // per-client mount → hide dropdown
  presetClientName?: string
  onClose:   () => void
  onCreated: () => void                               // caller runs router.refresh()
}

function tomorrow(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

const inputStyle: React.CSSProperties = {
  width: '100%', fontSize: '0.875rem', padding: '0.5rem 0.75rem', borderRadius: 6,
  border: '1px solid var(--border)', background: 'var(--bg-surface)',
  color: 'var(--text-primary)', boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = {
  fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4,
}

export default function NewPostModal({ clients, presetClientId, presetClientName, onClose, onCreated }: Props) {
  const [clientId, setClientId] = useState(presetClientId ?? clients?.[0]?.id ?? '')
  const [date,     setDate]     = useState(tomorrow())
  const [brief,    setBrief]    = useState('')
  const [keyword,  setKeyword]  = useState('')
  const [length,   setLength]   = useState('')
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState('')

  const canSubmit = !!clientId && !!brief.trim() && !busy

  async function handleGenerate() {
    if (!canSubmit) return
    setBusy(true)
    setError('')

    // Build the free-text brief the same way the manual ContentEditor does.
    const lines: string[] = []
    lines.push(`Write a blog post about: ${brief.trim()}`)
    if (keyword.trim()) lines.push(`Focus keyword: ${keyword.trim()}`)
    if (length) lines.push(`Target length: ${LENGTHS.find(l => l.value === length)?.label ?? length}`)
    const prompt = lines.join('\n')

    try {
      const res = await fetch('/api/admin/content/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ prompt, client_id: clientId, target_publish_date: date, content_type: 'blog' }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Generation failed')
      }
      onCreated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div className="card" style={{ maxWidth: 480, width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700 }}>New Blog Post</h3>
          <button onClick={() => { if (!busy) onClose() }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.125rem', padding: 4 }}>×</button>
        </div>

        <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
            Generates one blog post for the chosen date. It lands in the pipeline for review just like an automated post.
          </p>

          {clients && clients.length > 0 && !presetClientId ? (
            <div>
              <label style={labelStyle}>Client</label>
              <select value={clientId} onChange={e => setClientId(e.target.value)} style={inputStyle}>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          ) : presetClientName ? (
            <div>
              <label style={labelStyle}>Client</label>
              <div style={{ ...inputStyle, background: 'var(--bg-subtle)', color: 'var(--text-muted)' }}>{presetClientName}</div>
            </div>
          ) : null}

          <div>
            <label style={labelStyle}>Target publish date</label>
            <input type="date" value={date} min={tomorrow()} onChange={e => setDate(e.target.value)} style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Brief / prompt</label>
            <textarea
              rows={4}
              value={brief}
              onChange={e => setBrief(e.target.value)}
              placeholder="e.g. Explain how homeowners should prepare their HVAC system for winter, common mistakes, and when to call a pro."
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>Focus keyword (optional)</label>
              <input type="text" value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="e.g. winter hvac prep" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Length</label>
              <select value={length} onChange={e => setLength(e.target.value)} style={inputStyle}>
                {LENGTHS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </div>
          </div>

          {error && (
            <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--red)' }}>{error}</p>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => { if (!busy) onClose() }} disabled={busy}>Cancel</button>
            <button className="btn btn-primary" onClick={handleGenerate} disabled={!canSubmit}>
              {busy ? 'Writing…' : 'Generate →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
