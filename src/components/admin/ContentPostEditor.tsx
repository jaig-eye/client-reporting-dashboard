'use client'

import { useState, useEffect, useCallback } from 'react'

interface Site {
  connectionId: string
  siteUrl:      string
  siteName:     string
  clientId:     string
  clientName:   string
}

interface UpdatedPost {
  id:            string
  status:        string
  title:         string | null
  targetKeyword: string | null
  wordCount:     number | null
  headingCount:  number | null
  internalLinks: number | null
  publishedUrl:  string | null
}

interface Props {
  postId:              string
  defaultConnectionId: string | null
  sites:               Site[]
  onClose:             () => void
  onUpdate:            (post: UpdatedPost) => void
}

interface PostDetail {
  id:               string
  clientId:         string
  status:           string
  targetKeyword:    string | null
  title:            string | null
  seoTitle:         string | null
  content:          string | null
  metaDescription:  string | null
  slug:             string | null
  suggestedTags:    string[]
  wordCount:        number | null
  headingCount:     number | null
  internalLinks:    number | null
  publishedUrl:     string | null
  wpAuthorId:       number | null
}

interface Author {
  id:   number
  name: string
}

interface WpTag {
  id:   number
  name: string
  slug: string
}

// ─── SEO check helpers ────────────────────────────────────────────────────────

function seoCheck(field: string | null, keyword: string): boolean {
  if (!field || !keyword) return false
  return field.toLowerCase().includes(keyword.toLowerCase())
}

function countWords(html: string): number {
  return html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length
}

function countHeadings(html: string): number {
  return (html.match(/<h[2-4][^>]*>/gi) || []).length
}

function countInternalLinks(html: string): number {
  return (html.match(/<a [^>]+>/gi) || []).filter(l => !l.includes('http')).length
}

function countExternalLinks(html: string): number {
  return (html.match(/<a [^>]*href=["']https?:\/\//gi) || []).length
}

function keywordInSubheadings(html: string, keyword: string): boolean {
  if (!keyword) return false
  const headings = html.match(/<h[2-4][^>]*>[\s\S]*?<\/h[2-4]>/gi) || []
  return headings.some(h => h.replace(/<[^>]+>/g, '').toLowerCase().includes(keyword.toLowerCase()))
}

function keywordInSlug(slug: string, keyword: string): boolean {
  if (!slug || !keyword) return false
  return slug.toLowerCase().includes(keyword.toLowerCase().replace(/\s+/g, '-'))
}

function computeKeywordDensity(html: string, keyword: string): number {
  if (!keyword || !html) return 0
  const text   = html.replace(/<[^>]+>/g, ' ').toLowerCase()
  const words  = text.split(/\s+/).filter(Boolean).length
  if (words === 0) return 0
  const kw     = keyword.toLowerCase()
  const regex  = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
  const count  = (text.match(regex) || []).length
  return (count / words) * 100
}

function hasImageWithKeywordAlt(html: string, keyword: string): boolean {
  if (!keyword) return false
  const imgs = html.match(/<img [^>]+>/gi) || []
  return imgs.some(img => {
    const altMatch = img.match(/alt=["']([^"']*)["']/i)
    return altMatch ? altMatch[1].toLowerCase().includes(keyword.toLowerCase()) : false
  })
}

function metaLength(meta: string | null): number {
  return (meta ?? '').length
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ContentPostEditor({ postId, defaultConnectionId, sites, onClose, onUpdate }: Props) {
  const [post,         setPost]         = useState<PostDetail | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [saving,       setSaving]       = useState(false)
  const [publishing,   setPublishing]   = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [error,        setError]        = useState('')

  // Post fields
  const [title,           setTitle]           = useState('')
  const [seoTitle,        setSeoTitle]        = useState('')
  const [targetKeyword,   setTargetKeyword]   = useState('')
  const [content,         setContent]         = useState('')
  const [metaDescription, setMetaDescription] = useState('')
  const [slug,            setSlug]            = useState('')
  const [tags,            setTags]            = useState<string[]>([])
  const [tagInput,        setTagInput]        = useState('')

  // WP settings
  const [wpStatus,     setWpStatus]     = useState<'draft' | 'publish'>('draft')
  const [authorId,     setAuthorId]     = useState<number | null>(null)
  const [connectionId, setConnectionId] = useState<string>(defaultConnectionId ?? '')

  // AI re-edit
  const [editNotes,     setEditNotes]     = useState('')
  const [showEditNotes, setShowEditNotes] = useState(false)

  // Authors + WP tags
  const [authors,        setAuthors]        = useState<Author[]>([])
  const [authorsLoading, setAuthorsLoading] = useState(false)
  const [wpTags,         setWpTags]         = useState<WpTag[]>([])

  // Preview
  const [showPreview, setShowPreview] = useState(false)

  // ── Load post detail ────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const res = await fetch(`/api/admin/content/post?id=${postId}`)
        if (!res.ok) throw new Error('Failed to load post')
        const data: PostDetail = await res.json()
        setPost(data)
        setTitle(data.title ?? '')
        setSeoTitle(data.seoTitle ?? data.title ?? '')
        setTargetKeyword(data.targetKeyword ?? '')
        setContent(data.content ?? '')
        setMetaDescription(data.metaDescription ?? '')
        setSlug(data.slug ?? '')
        setTags(data.suggestedTags ?? [])
        setAuthorId(data.wpAuthorId ?? null)
        if (!connectionId && defaultConnectionId) setConnectionId(defaultConnectionId)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        setLoading(false)
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId])

  // ── Load authors + WP tags when connectionId changes ───────────────────────
  const loadSiteData = useCallback(async (connId: string) => {
    if (!connId) return
    setAuthorsLoading(true)
    try {
      const [authRes, tagRes] = await Promise.all([
        fetch(`/api/admin/wordpress/authors?connection_id=${connId}`),
        fetch(`/api/admin/wordpress/tags?connection_id=${connId}`),
      ])
      if (authRes.ok) setAuthors((await authRes.json()).authors ?? [])
      if (tagRes.ok)  setWpTags((await tagRes.json()).tags ?? [])
    } catch {
      // silently ignore — these are optional
    } finally {
      setAuthorsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (connectionId) loadSiteData(connectionId)
  }, [connectionId, loadSiteData])

  // ── Live SEO computations ───────────────────────────────────────────────────
  const liveWordCount      = content ? countWords(content) : 0
  const liveHeadings       = content ? countHeadings(content) : 0
  const liveIntLinks       = content ? countInternalLinks(content) : 0
  const liveExtLinks       = content ? countExternalLinks(content) : 0
  const liveMetaLen        = metaLength(metaDescription)
  const keywordInTitle     = seoCheck(title, targetKeyword)
  const keywordInSeoTitle  = seoCheck(seoTitle, targetKeyword)
  const keywordInMeta      = seoCheck(metaDescription, targetKeyword)
  const keywordSlug        = keywordInSlug(slug, targetKeyword)
  const slugLenOk          = slug.length > 0 && slug.length < 130
  const keywordInFirst     = targetKeyword && content
    ? content.replace(/<[^>]+>/g, ' ').slice(0, 500).toLowerCase().includes(targetKeyword.toLowerCase())
    : false
  const keywordInSubhd     = content ? keywordInSubheadings(content, targetKeyword) : false
  const densityPct         = computeKeywordDensity(content, targetKeyword)
  const densityOk          = densityPct >= 0.5 && densityPct <= 2.0
  const imgAltKw           = content ? hasImageWithKeywordAlt(content, targetKeyword) : false
  const metaLenOk          = liveMetaLen >= 150 && liveMetaLen <= 160
  const seoTitleLenOk      = seoTitle.length > 0 && seoTitle.length <= 65

  // ── Tag helpers ─────────────────────────────────────────────────────────────
  function addTag(name: string) {
    const trimmed = name.trim()
    if (trimmed && !tags.includes(trimmed)) setTags(prev => [...prev, trimmed])
  }

  function removeTag(name: string) {
    setTags(prev => prev.filter(t => t !== name))
  }

  function handleTagInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
      e.preventDefault()
      addTag(tagInput)
      setTagInput('')
    } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      setTags(prev => prev.slice(0, -1))
    }
  }

  // ── Publish helpers ─────────────────────────────────────────────────────────
  function buildPublishBody(overrideStatus?: string) {
    return {
      post_id:          postId,
      connection_id:    connectionId,
      title,
      content,
      status:           overrideStatus ?? wpStatus,
      slug,
      meta_description: metaDescription,
      target_keyword:   targetKeyword,
      seo_title:        seoTitle,
      author_id:        authorId,
      tags,
    }
  }

  async function handleSaveDraft() {
    if (!connectionId) { setError('Select a WordPress site first'); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/admin/content/publish', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(buildPublishBody('draft')),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to save draft')
      const data = await res.json()
      setPost(prev => prev ? { ...prev, status: 'draft_saved', publishedUrl: data.url ?? prev.publishedUrl } : prev)
      onUpdate({ id: postId, status: 'draft_saved', title: title || null, targetKeyword: targetKeyword || null, wordCount: liveWordCount, headingCount: liveHeadings, internalLinks: liveIntLinks, publishedUrl: data.url ?? null })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save draft')
    } finally {
      setSaving(false)
    }
  }

  async function handlePublish() {
    if (!connectionId) { setError('Select a WordPress site first'); return }
    setPublishing(true)
    setError('')
    try {
      const res = await fetch('/api/admin/content/publish', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(buildPublishBody()),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to publish')
      const data = await res.json()
      const newStatus = wpStatus === 'publish' ? 'published' : 'draft_saved'
      setPost(prev => prev ? { ...prev, status: newStatus, publishedUrl: data.url ?? prev.publishedUrl } : prev)
      onUpdate({ id: postId, status: newStatus, title: title || null, targetKeyword: targetKeyword || null, wordCount: liveWordCount, headingCount: liveHeadings, internalLinks: liveIntLinks, publishedUrl: data.url ?? null })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish')
    } finally {
      setPublishing(false)
    }
  }

  async function handleApprove() {
    setError('')
    try {
      const res = await fetch('/api/admin/content/status', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ post_id: postId, status: 'approved' }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      setPost(prev => prev ? { ...prev, status: 'approved' } : prev)
      onUpdate({ id: postId, status: 'approved', title: title || null, targetKeyword: targetKeyword || null, wordCount: liveWordCount, headingCount: liveHeadings, internalLinks: liveIntLinks, publishedUrl: post?.publishedUrl ?? null })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve')
    }
  }

  async function handleReject() {
    setError('')
    try {
      const res = await fetch('/api/admin/content/status', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ post_id: postId, status: 'rejected' }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      onUpdate({ id: postId, status: 'rejected', title: title || null, targetKeyword: targetKeyword || null, wordCount: liveWordCount, headingCount: liveHeadings, internalLinks: liveIntLinks, publishedUrl: post?.publishedUrl ?? null })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject')
    }
  }

  async function handleRegenerate() {
    if (!editNotes.trim()) { setError('Enter revision instructions first'); return }
    setRegenerating(true)
    setError('')
    try {
      const res = await fetch('/api/admin/content/regenerate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ post_id: postId, edit_notes: editNotes }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to regenerate')
      const data = await res.json()
      setTitle(data.title ?? title)
      setSeoTitle(data.seoTitle ?? data.title ?? seoTitle)
      setContent(data.content ?? content)
      setMetaDescription(data.metaDescription ?? metaDescription)
      setSlug(data.slug ?? slug)
      if (data.focusKeyword) setTargetKeyword(data.focusKeyword)
      if (Array.isArray(data.suggestedTags) && data.suggestedTags.length > 0) setTags(data.suggestedTags)
      setEditNotes('')
      setShowEditNotes(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate')
    } finally {
      setRegenerating(false)
    }
  }

  // ── Styles ──────────────────────────────────────────────────────────────────
  const Check = ({ ok, warn }: { ok: boolean; warn?: boolean }) => (
    <span style={{ color: ok ? 'var(--green)' : warn ? 'var(--amber, #f59e0b)' : 'var(--red)', fontWeight: 600, marginRight: 4, fontSize: '0.75rem' }}>
      {ok ? '✓' : '✗'}
    </span>
  )

  const inputStyle = {
    width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.875rem',
    border: '1px solid var(--border)', borderRadius: 6,
    background: 'var(--bg-surface)', color: 'var(--text-primary)',
    boxSizing: 'border-box' as const,
  }

  const labelStyle = {
    display: 'block', fontSize: '0.75rem', fontWeight: 600 as const,
    color: 'var(--text-muted)', marginBottom: '0.25rem',
  }

  const isOnWP = post?.status === 'draft_saved' || post?.status === 'published'

  // ── Preview srcdoc ──────────────────────────────────────────────────────────
  const previewSrcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:Georgia,serif;max-width:780px;margin:2rem auto;padding:0 1.5rem;line-height:1.8;color:#1a1a1a;background:#fff}
    h1{font-size:2rem;line-height:1.3;margin-bottom:.5rem;color:#111}
    h2{font-size:1.5rem;margin-top:2rem;color:#111}
    h3{font-size:1.25rem;margin-top:1.5rem;color:#222}
    h4{font-size:1.1rem;margin-top:1.25rem;color:#333}
    p{margin-bottom:1.2rem}
    ul,ol{margin-bottom:1.2rem;padding-left:1.5rem}
    li{margin-bottom:.4rem}
    strong{font-weight:700}
    a{color:#2563eb;text-decoration:underline}
    img{max-width:100%;height:auto;border-radius:4px}
    blockquote{border-left:4px solid #e5e7eb;margin:1.5rem 0;padding:.75rem 1rem;color:#555;font-style:italic}
  </style></head><body><h1>${title.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</h1>${content}</body></html>`

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 50 }}
      />

      {/* Preview overlay */}
      {showPreview && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 53, background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1, fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>Preview — {title || 'Untitled'}</span>
            <button
              type="button"
              onClick={() => setShowPreview(false)}
              className="btn btn-secondary"
              style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}
            >
              ✕ Close Preview
            </button>
          </div>
          <iframe
            srcDoc={previewSrcdoc}
            title="Post Preview"
            style={{ flex: 1, border: 'none', width: '100%' }}
          />
        </div>
      )}

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(720px, 100vw)',
        background: 'var(--bg-surface)',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
        zIndex: 51,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 style={{ flex: 1, fontSize: '1rem', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
            Review Post
          </h2>
          {post && (
            <span className={`badge ${post.status === 'pending' ? 'badge-amber' : post.status === 'approved' ? 'badge-blue' : post.status === 'published' ? 'badge-green' : post.status === 'draft_saved' ? 'badge-blue' : 'badge-gray'}`} style={{ fontSize: '0.6875rem' }}>
              {post.status === 'draft_saved' ? 'WP Draft' : post.status}
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowPreview(true)}
            className="btn btn-secondary"
            style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}
          >
            Preview
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary"
            style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem' }}>
            {error && (
              <p className="text-xs mb-3" style={{ color: 'var(--red)', background: 'rgba(220,38,38,0.06)', padding: '0.5rem 0.75rem', borderRadius: 6 }}>
                {error}
              </p>
            )}

            {/* On WordPress banner */}
            {isOnWP && (
              <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid var(--green)', borderRadius: 6, padding: '0.5rem 0.75rem', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--green)', fontWeight: 600, fontSize: '0.8125rem' }}>
                    ✓ On WordPress
                  </span>
                  {post?.publishedUrl && (
                    <a href={post.publishedUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.8125rem', color: 'var(--blue)' }}>
                      View post ↗
                    </a>
                  )}
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>
                  This post has been pushed to WordPress. Future edits should be made directly on the site.
                </p>
              </div>
            )}

            {/* WordPress site selector */}
            <div className="mb-4">
              <label style={labelStyle}>WordPress Site</label>
              <select value={connectionId} onChange={e => setConnectionId(e.target.value)} style={inputStyle}>
                <option value="">— Select a site —</option>
                {sites.map(s => (
                  <option key={s.connectionId} value={s.connectionId}>
                    {s.siteName} ({s.clientName})
                  </option>
                ))}
              </select>
            </div>

            {/* SEO Title + Title */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }} className="mb-4">
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>
                  SEO Title
                  <span style={{ fontWeight: 400, marginLeft: 6, color: seoTitle.length > 65 ? 'var(--amber, #f59e0b)' : seoTitle.length > 0 ? 'var(--green)' : 'var(--text-faint)' }}>
                    {seoTitle.length}/60
                  </span>
                </label>
                <input
                  type="text"
                  value={seoTitle}
                  onChange={e => setSeoTitle(e.target.value)}
                  style={inputStyle}
                  placeholder="SEO title (60 chars, includes focus keyword)"
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>H1 Title</label>
                <input type="text" value={title} onChange={e => setTitle(e.target.value)} style={inputStyle} placeholder="Post H1 title" />
              </div>

              {/* Target keyword */}
              <div>
                <label style={labelStyle}>Focus Keyword</label>
                <input
                  type="text"
                  value={targetKeyword}
                  onChange={e => setTargetKeyword(e.target.value)}
                  style={inputStyle}
                  placeholder="Primary keyword"
                />
              </div>

              {/* Slug */}
              <div>
                <label style={labelStyle}>
                  URL Slug
                  {slug && <span style={{ fontWeight: 400, marginLeft: 6, color: slug.length > 130 ? 'var(--red)' : 'var(--text-faint)' }}>{slug.length} chars</span>}
                </label>
                <input
                  type="text"
                  value={slug}
                  onChange={e => setSlug(e.target.value)}
                  style={inputStyle}
                  placeholder="url-friendly-slug"
                />
              </div>
            </div>

            {/* Tags */}
            <div className="mb-4">
              <label style={labelStyle}>Tags</label>
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: '0.375rem',
                padding: '0.375rem 0.5rem',
                border: '1px solid var(--border)', borderRadius: 6,
                background: 'var(--bg-surface)', minHeight: 38,
                cursor: 'text',
              }}
                onClick={() => (document.getElementById('tag-input') as HTMLInputElement)?.focus()}
              >
                {tags.map(tag => (
                  <span key={tag} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontSize: '0.75rem', fontWeight: 500,
                    padding: '0.1rem 0.5rem', borderRadius: 4,
                    background: 'var(--bg-muted)', color: 'var(--text-secondary)',
                    border: '1px solid var(--border)',
                  }}>
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: '0.75rem', padding: 0, lineHeight: 1 }}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  id="tag-input"
                  type="text"
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={handleTagInputKeyDown}
                  placeholder={tags.length === 0 ? 'Type tag, press Enter…' : ''}
                  style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: '0.8125rem', color: 'var(--text-primary)', minWidth: 120, flex: 1 }}
                />
              </div>
              {wpTags.length > 0 && (
                <div style={{ marginTop: '0.375rem', display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                  {wpTags.filter(t => !tags.includes(t.name)).slice(0, 12).map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => addTag(t.name)}
                      style={{
                        fontSize: '0.6875rem', padding: '0.1rem 0.4rem', borderRadius: 4,
                        border: '1px solid var(--border)', background: 'transparent',
                        color: 'var(--text-muted)', cursor: 'pointer',
                      }}
                    >
                      + {t.name}
                    </button>
                  ))}
                </div>
              )}
              <p style={{ fontSize: '0.6875rem', color: 'var(--text-faint)', marginTop: '0.25rem' }}>
                AI-suggested tags. Add/remove before publishing. Press Enter or comma to add a custom tag.
              </p>
            </div>

            {/* Content */}
            <div className="mb-4">
              <label style={labelStyle}>Content (HTML)</label>
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                style={{ ...inputStyle, minHeight: 220, fontFamily: 'monospace', fontSize: '0.8125rem', resize: 'vertical' }}
                placeholder="<h2>Introduction</h2><p>…</p>"
              />
            </div>

            {/* Meta description */}
            <div className="mb-4">
              <label style={labelStyle}>
                Meta Description
                <span style={{ fontWeight: 400, marginLeft: 6, color: liveMetaLen > 160 ? 'var(--amber, #f59e0b)' : liveMetaLen >= 150 ? 'var(--green)' : 'var(--text-faint)' }}>
                  {liveMetaLen}/160
                </span>
              </label>
              <textarea
                value={metaDescription}
                onChange={e => setMetaDescription(e.target.value)}
                rows={2}
                style={{ ...inputStyle, resize: 'vertical' }}
                placeholder="SEO meta description (150–160 characters)"
              />
            </div>

            {/* SEO checklist */}
            <div className="card mb-4" style={{ padding: '0.875rem 1rem', background: 'var(--bg-subtle)' }}>
              <p style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: 'var(--text-faint)', marginBottom: '0.5rem' }}>
                SEO Checklist
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.3rem 0.75rem', fontSize: '0.775rem', color: 'var(--text-muted)' }}>
                <div><Check ok={keywordInTitle} />Keyword in H1</div>
                <div><Check ok={keywordInSeoTitle} />Keyword in SEO title</div>
                <div><Check ok={keywordInMeta} />Keyword in meta desc</div>

                <div><Check ok={!!keywordInFirst} />Keyword in opening</div>
                <div><Check ok={keywordInSubhd} />Keyword in subheading</div>
                <div><Check ok={densityOk} warn={densityPct > 0 && !densityOk} />{densityPct.toFixed(1)}% density <span style={{ color: 'var(--text-faint)', fontSize: '0.7rem' }}>(~1%)</span></div>

                <div><Check ok={liveWordCount >= 600} />{liveWordCount.toLocaleString()} words</div>
                <div><Check ok={liveHeadings >= 2} />{liveHeadings} headings</div>
                <div><Check ok={metaLenOk} warn={liveMetaLen > 0 && !metaLenOk} />Meta {liveMetaLen}/160</div>

                <div><Check ok={liveIntLinks >= 1} />{liveIntLinks} internal link{liveIntLinks !== 1 ? 's' : ''}</div>
                <div><Check ok={liveExtLinks >= 1} />{liveExtLinks} external link{liveExtLinks !== 1 ? 's' : ''}</div>
                <div><Check ok={imgAltKw} />Image alt w/ keyword</div>

                <div><Check ok={keywordSlug} />Keyword in slug</div>
                <div><Check ok={slugLenOk} />{slug.length > 0 ? `Slug ${slug.length} chars` : 'No slug'}</div>
                <div><Check ok={seoTitleLenOk} />SEO title ≤60 chars</div>
              </div>
            </div>

            {/* Author + publish status */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }} className="mb-4">
              <div>
                <label style={labelStyle}>WP Author</label>
                <select
                  value={authorId ?? ''}
                  onChange={e => setAuthorId(e.target.value ? Number(e.target.value) : null)}
                  style={inputStyle}
                  disabled={authorsLoading}
                >
                  <option value="">{authorsLoading ? 'Loading…' : '— Default —'}</option>
                  {authors.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={labelStyle}>Publish as</label>
                <select
                  value={wpStatus}
                  onChange={e => setWpStatus(e.target.value as 'draft' | 'publish')}
                  style={inputStyle}
                >
                  <option value="draft">Draft</option>
                  <option value="publish">Published</option>
                </select>
              </div>
            </div>

            {/* AI re-edit */}
            <div className="mb-4">
              {!showEditNotes ? (
                <button
                  type="button"
                  onClick={() => setShowEditNotes(true)}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.8125rem' }}
                >
                  Request AI Edit…
                </button>
              ) : (
                <div>
                  <label style={labelStyle}>Revision Instructions</label>
                  <textarea
                    value={editNotes}
                    onChange={e => setEditNotes(e.target.value)}
                    rows={3}
                    style={{ ...inputStyle, resize: 'vertical', marginBottom: '0.5rem' }}
                    placeholder="e.g. Make the tone more conversational and add a FAQ section at the end"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button type="button" disabled={regenerating} onClick={handleRegenerate} className="btn btn-primary" style={{ fontSize: '0.8125rem' }}>
                      {regenerating ? 'Regenerating…' : 'Regenerate with AI'}
                    </button>
                    <button type="button" onClick={() => { setShowEditNotes(false); setEditNotes('') }} className="btn btn-secondary" style={{ fontSize: '0.8125rem' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer actions */}
        {!loading && (
          <div style={{ padding: '0.875rem 1.25rem', borderTop: '1px solid var(--border)', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {post?.status === 'pending' && (
              <button type="button" onClick={handleApprove} className="btn btn-secondary" style={{ fontSize: '0.8125rem', color: 'var(--blue)' }}>
                Approve
              </button>
            )}
            <button type="button" disabled={saving} onClick={handleSaveDraft} className="btn btn-secondary" style={{ fontSize: '0.8125rem' }}>
              {saving ? 'Saving…' : 'Save Draft to WP'}
            </button>
            <button type="button" disabled={publishing} onClick={handlePublish} className="btn btn-primary" style={{ fontSize: '0.8125rem' }}>
              {publishing ? 'Publishing…' : wpStatus === 'publish' ? 'Publish to WP' : 'Send to WP Draft'}
            </button>
            <div style={{ flex: 1 }} />
            <button type="button" onClick={handleReject} className="btn btn-secondary" style={{ fontSize: '0.8125rem', color: 'var(--red)' }}>
              Reject
            </button>
          </div>
        )}
      </div>
    </>
  )
}
