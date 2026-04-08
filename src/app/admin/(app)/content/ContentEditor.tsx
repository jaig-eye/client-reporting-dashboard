'use client'

import { useState } from 'react'

interface Site {
  connectionId: string
  siteUrl: string
  siteName: string
  clientId: string
  clientName: string
}

interface Props {
  sites: Site[]
  aiConfigured: boolean
}

export default function ContentEditor({ sites, aiConfigured }: Props) {
  const [selectedSite, setSelectedSite] = useState(sites[0]?.connectionId ?? '')
  const [title,    setTitle]    = useState('')
  const [content,  setContent]  = useState('')
  const [status,   setStatus]   = useState<'draft' | 'publish'>('draft')
  const [saving,   setSaving]   = useState(false)
  const [result,   setResult]   = useState<{ link: string; status: string } | null>(null)
  const [error,    setError]    = useState('')
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  async function handlePublish() {
    if (!selectedSite || !title.trim() || !content.trim()) return
    setSaving(true)
    setError('')
    setResult(null)

    try {
      const res = await fetch('/api/admin/content/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connection_id: selectedSite,
          title:   title.trim(),
          content: content.trim(),
          status,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to publish')
      }
      const data = await res.json()
      setResult({ link: data.link, status: data.status })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  async function handleAiGenerate() {
    if (!aiPrompt.trim()) return
    setAiLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/content/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiPrompt.trim() }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'AI generation failed')
      }
      const data = await res.json()
      if (data.title) setTitle(data.title)
      if (data.content) setContent(data.content)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI generation failed')
    } finally {
      setAiLoading(false)
    }
  }

  const site = sites.find(s => s.connectionId === selectedSite)

  return (
    <div className="space-y-4">
      {/* Site selector */}
      <div className="card p-5">
        <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--text-muted)' }}>
          Publish to
        </label>
        <select
          className="input"
          value={selectedSite}
          onChange={e => setSelectedSite(e.target.value)}
        >
          {sites.map(s => (
            <option key={s.connectionId} value={s.connectionId}>
              {s.siteName} ({s.clientName})
            </option>
          ))}
        </select>
        {site && (
          <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
            {site.siteUrl} — Client: {site.clientName}
          </p>
        )}
      </div>

      {/* AI writing assistant */}
      {aiConfigured && (
        <div className="card p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
            AI Writing Assistant
          </h2>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              type="text"
              placeholder="Describe the blog post you want to write…"
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAiGenerate()}
            />
            <button
              type="button"
              onClick={handleAiGenerate}
              disabled={aiLoading || !aiPrompt.trim()}
              className="btn btn-primary flex-shrink-0"
            >
              {aiLoading ? 'Writing…' : 'Generate'}
            </button>
          </div>
        </div>
      )}

      {/* Post editor */}
      <div className="card p-5 space-y-4">
        <div>
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
            Title
          </label>
          <input
            className="input"
            type="text"
            placeholder="Enter post title…"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
        </div>

        <div>
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
            Content (HTML)
          </label>
          <textarea
            className="input"
            rows={16}
            placeholder="Write your content here. Supports HTML formatting."
            value={content}
            onChange={e => setContent(e.target.value)}
            style={{ fontFamily: 'monospace', fontSize: '0.8125rem', resize: 'vertical' }}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="status"
                checked={status === 'draft'}
                onChange={() => setStatus('draft')}
              />
              <span className="text-sm" style={{ color: 'var(--text-primary)' }}>Save as Draft</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="status"
                checked={status === 'publish'}
                onChange={() => setStatus('publish')}
              />
              <span className="text-sm" style={{ color: 'var(--text-primary)' }}>Publish Immediately</span>
            </label>
          </div>

          <button
            type="button"
            onClick={handlePublish}
            disabled={saving || !title.trim() || !content.trim()}
            className="btn btn-primary"
          >
            {saving ? 'Publishing…' : status === 'publish' ? 'Publish Post' : 'Save Draft'}
          </button>
        </div>

        {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}

        {result && (
          <div className="rounded-lg p-3" style={{ background: 'var(--green-subtle)', border: '1px solid var(--green)' }}>
            <p className="text-sm font-medium" style={{ color: 'var(--green)' }}>
              Post {result.status === 'publish' ? 'published' : 'saved as draft'}!
            </p>
            {result.link && (
              <a
                href={result.link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs underline"
                style={{ color: 'var(--green)' }}
              >
                View post →
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
