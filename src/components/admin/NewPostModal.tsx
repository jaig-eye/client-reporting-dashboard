'use client'

import { useState } from 'react'
import Dialog from '@/components/ui/Dialog'
import Field from '@/components/ui/Field'

// Manual "pick a day + prompt" single-post generation.
// Generates ONE blog post that lands in the pipeline exactly like an automated
// post (status 'for_review', dated, image auto-gens per settings) via the shared
// POST /api/admin/content/generate Path B (extended to persist date + content_type).
// Built on the shared Dialog (a form: Enter in a field writes the post).

const LENGTHS = [
  { value: '',       label: 'The client’s default' },
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
    <Dialog
      open
      onClose={onClose}
      title="New blog post"
      description="Writes one post for the date you choose. It lands in the pipeline for review, like an automated post."
      busy={busy}
      onSubmit={() => void handleGenerate()}
      bodyClassName="ui-stack-sm"
      footer={<>
        {error && <p className="ui-dialog-error" role="alert">{error}</p>}
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={!canSubmit}>{busy ? 'Writing…' : 'Write the post'}</button>
      </>}
    >
      {clients && clients.length > 0 && !presetClientId ? (
        <Field label="Client" id="np-client">
          <select id="np-client" className="input" value={clientId} onChange={e => setClientId(e.target.value)}>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      ) : presetClientName ? (
        <Field label="Client">
          <p className="np-client">{presetClientName}</p>
        </Field>
      ) : null}

      <Field label="Publish date" id="np-date">
        <input id="np-date" className="input" type="date" value={date} min={tomorrow()} onChange={e => setDate(e.target.value)} />
      </Field>

      <Field label="What it’s about" id="np-brief">
        <textarea
          id="np-brief"
          className="input"
          rows={4}
          value={brief}
          onChange={e => setBrief(e.target.value)}
          placeholder="e.g. Explain how homeowners should prepare their HVAC system for winter, common mistakes, and when to call a pro."
          style={{ resize: 'vertical' }}
        />
      </Field>

      <div className="ui-grid-2">
        <Field label="Focus keyword (optional)" id="np-keyword">
          <input id="np-keyword" className="input" type="text" value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="e.g. winter hvac prep" />
        </Field>
        <Field label="Length" id="np-length">
          <select id="np-length" className="input" value={length} onChange={e => setLength(e.target.value)}>
            {LENGTHS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </Field>
      </div>
    </Dialog>
  )
}
