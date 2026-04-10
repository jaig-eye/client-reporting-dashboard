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

const TONES = [
  { value: 'professional',      label: 'Professional' },
  { value: 'conversational',    label: 'Conversational' },
  { value: 'authoritative',     label: 'Authoritative' },
  { value: 'casual_friendly',   label: 'Casual & Friendly' },
  { value: 'technical',         label: 'Technical' },
]

const LENGTHS = [
  { value: 'short',  label: 'Short (~600 words)' },
  { value: 'medium', label: 'Medium (~1,200 words)' },
  { value: 'long',   label: 'Long (~2,000 words)' },
]

export default function ContentEditor({ sites, aiConfigured }: Props) {
  const [selectedSite, setSelectedSite] = useState(sites[0]?.connectionId ?? '')
  const [title,        setTitle]        = useState('')
  const [content,      setContent]      = useState('')
  const [metaDesc,     setMetaDesc]     = useState('')
  const [slug,         setSlug]         = useState('')
  const [status,       setStatus]       = useState<'draft' | 'publish'>('draft')
  const [saving,       setSaving]       = useState(false)
  const [result,       setResult]       = useState<{ link: string; status: string } | null>(null)
  const [error,        setError]        = useState('')

  // AI fields
  const [aiTopic,       setAiTopic]       = useState('')
  const [aiKeywords,    setAiKeywords]    = useState('')
  const [aiTone,        setAiTone]        = useState('professional')
  const [aiLength,      setAiLength]      = useState('medium')
  const [aiGeo,         setAiGeo]         = useState('')
  const [aiAudience,    setAiAudience]    = useState('')
  const [aiAngle,       setAiAngle]       = useState('')
  const [aiExtra,       setAiExtra]       = useState('')
  const [aiLoading,     setAiLoading]     = useState(false)
  const [aiOpen,        setAiOpen]        = useState(true)

  const site = sites.find(s => s.connectionId === selectedSite)

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
    if (!aiTopic.trim()) return
    setAiLoading(true)
    setError('')

    // Build a structured prompt from the field values
    const lines: string[] = []
    lines.push(`Write a blog post about: ${aiTopic.trim()}`)
    if (site?.clientName) lines.push(`Client / business: ${site.clientName}`)
    if (aiKeywords.trim())  lines.push(`Focus keywords: ${aiKeywords.trim()}`)
    lines.push(`Tone: ${TONES.find(t => t.value === aiTone)?.label ?? aiTone}`)
    lines.push(`Target length: ${LENGTHS.find(l => l.value === aiLength)?.label ?? aiLength}`)
    if (aiGeo.trim())       lines.push(`Geographic focus: ${aiGeo.trim()}`)
    if (aiAudience.trim())  lines.push(`Target audience: ${aiAudience.trim()}`)
    if (aiAngle.trim())     lines.push(`Unique angle or hook: ${aiAngle.trim()}`)
    if (aiExtra.trim())     lines.push(`Additional instructions: ${aiExtra.trim()}`)

    const prompt = lines.join('\n')

    try {
      const res = await fetch('/api/admin/content/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'AI generation failed')
      }
      const data = await res.json()
      if (data.title)           setTitle(data.title)
      if (data.content)         setContent(data.content)
      if (data.metaDescription) setMetaDesc(data.metaDescription)
      if (data.slug)            setSlug(data.slug)
      setAiOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI generation failed')
    } finally {
      setAiLoading(false)
    }
  }

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
          <button
            type="button"
            onClick={() => setAiOpen(o => !o)}
            className="flex items-center justify-between w-full"
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            <h2
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: 'var(--text-muted)', letterSpacing: '0.05em' }}
            >
              AI Writing Assistant
            </h2>
            <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
              {aiOpen ? '▲ Hide' : '▼ Show'}
            </span>
          </button>

          {aiOpen && (
            <div className="mt-4 space-y-3">
              {/* Topic (required) */}
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
                  Topic <span style={{ color: 'var(--red)' }}>*</span>
                </label>
                <input
                  className="input"
                  type="text"
                  placeholder="e.g. Why your business needs a new website in 2025"
                  value={aiTopic}
                  onChange={e => setAiTopic(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAiGenerate()}
                />
              </div>

              {/* Focus Keywords */}
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
                  Focus Keywords
                </label>
                <input
                  className="input"
                  type="text"
                  placeholder="web design Toronto, affordable website redesign"
                  value={aiKeywords}
                  onChange={e => setAiKeywords(e.target.value)}
                />
              </div>

              {/* Tone + Length — two columns */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
                    Writing Tone
                  </label>
                  <select className="input" value={aiTone} onChange={e => setAiTone(e.target.value)}>
                    {TONES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
                    Target Length
                  </label>
                  <select className="input" value={aiLength} onChange={e => setAiLength(e.target.value)}>
                    {LENGTHS.map(l => (
                      <option key={l.value} value={l.value}>{l.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Geo + Audience — two columns */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
                    Geographic Focus
                  </label>
                  <input
                    className="input"
                    type="text"
                    placeholder="Toronto, ON"
                    value={aiGeo}
                    onChange={e => setAiGeo(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
                    Target Audience
                  </label>
                  <input
                    className="input"
                    type="text"
                    placeholder="small business owners"
                    value={aiAudience}
                    onChange={e => setAiAudience(e.target.value)}
                  />
                </div>
              </div>

              {/* Unique angle */}
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
                  Unique Angle or Hook
                </label>
                <input
                  className="input"
                  type="text"
                  placeholder="Focus on ROI, use a case study with a 40% traffic increase"
                  value={aiAngle}
                  onChange={e => setAiAngle(e.target.value)}
                />
              </div>

              {/* Additional instructions */}
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
                  Additional Instructions
                </label>
                <textarea
                  className="input"
                  rows={2}
                  placeholder="Any extra context, formatting preferences, or requirements…"
                  value={aiExtra}
                  onChange={e => setAiExtra(e.target.value)}
                  style={{ resize: 'vertical' }}
                />
              </div>

              <button
                type="button"
                onClick={handleAiGenerate}
                disabled={aiLoading || !aiTopic.trim()}
                className="btn btn-primary w-full"
              >
                {aiLoading ? 'Writing…' : 'Generate Content'}
              </button>
            </div>
          )}
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

        {/* Meta description + slug (populated by AI, editable) */}
        {(metaDesc || slug) && (
          <div className="grid grid-cols-1 gap-3" style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
            {metaDesc && (
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
                  Meta Description
                </label>
                <textarea
                  className="input"
                  rows={2}
                  value={metaDesc}
                  onChange={e => setMetaDesc(e.target.value)}
                  style={{ resize: 'vertical', fontSize: '0.8125rem' }}
                />
              </div>
            )}
            {slug && (
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
                  Slug
                </label>
                <input
                  className="input"
                  type="text"
                  value={slug}
                  onChange={e => setSlug(e.target.value)}
                  style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}
                />
              </div>
            )}
          </div>
        )}

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
