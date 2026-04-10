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
  content:          string | null
  metaDescription:  string | null
  slug:             string | null
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

function seoCheck(field: string | null, keyword: string): boolean {
  if (!field || !keyword) return false
  return field.toLowerCase().includes(keyword.toLowerCase())
}

function countWords(html: string): number {
  return html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length
}

function countHeadings(html: string): number {
  return (html.match(/<h[23][^>]*>/gi) || []).length
}

function countInternalLinks(html: string): number {
  return (html.match(/<a [^>]+>/gi) || []).filter(l => !l.includes('http')).length
}

function metaLength(meta: string | null): number {
  return (meta ?? '').length
}

export default function ContentPostEditor({ postId, defaultConnectionId, sites, onClose, onUpdate }: Props) {
  const [post,         setPost]         = useState<PostDetail | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [saving,       setSaving]       = useState(false)
  const [publishing,   setPublishing]   = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [error,        setError]        = useState('')

  const [title,           setTitle]           = useState('')
  const [targetKeyword,   setTargetKeyword]   = useState('')
  const [content,         setContent]         = useState('')
  const [metaDescription, setMetaDescription] = useState('')
  const [slug,            setSlug]            = useState('')
  const [wpStatus,        setWpStatus]        = useState<'draft' | 'publish'>('draft')
  const [authorId,        setAuthorId]        = useState<number | null>(null)
  const [connectionId,    setConnectionId]    = useState<string>(defaultConnectionId ?? '')
  const [editNotes,       setEditNotes]       = useState('')
  const [showEditNotes,   setShowEditNotes]   = useState(false)

  const [authors,       setAuthors]       = useState<Author[]>([])
  const [authorsLoading, setAuthorsLoading] = useState(false)

  // Load post detail
  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const res = await fetch(`/api/admin/content/post?id=${postId}`)
        if (!res.ok) throw new Error('Failed to load post')
        const data: PostDetail = await res.json()
        setPost(data)
        setTitle(data.title ?? '')
        setTargetKeyword(data.targetKeyword ?? '')
        setContent(data.content ?? '')
        setMetaDescription(data.metaDescription ?? '')
        setSlug(data.slug ?? '')
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

  // Load authors when connectionId changes
  const loadAuthors = useCallback(async (connId: string) => {
    if (!connId) return
    setAuthorsLoading(true)
    try {
      const res = await fetch(`/api/admin/wordpress/authors?connection_id=${connId}`)
      if (res.ok) {
        const data = await res.json()
        setAuthors(data.authors ?? [])
      }
    } catch {
      // silently ignore — authors are optional
    } finally {
      setAuthorsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (connectionId) loadAuthors(connectionId)
  }, [connectionId, loadAuthors])

  // SEO checks (live, based on current state)
  const liveWordCount    = content ? countWords(content) : 0
  const liveHeadings     = content ? countHeadings(content) : 0
  const liveIntLinks     = content ? countInternalLinks(content) : 0
  const liveMetaLen      = metaLength(metaDescription)
  const keywordInTitle   = seoCheck(title, targetKeyword)
  const keywordInFirst   = targetKeyword && content
    ? content.replace(/<[^>]+>/g, ' ').slice(0, 500).toLowerCase().includes(targetKeyword.toLowerCase())
    : false
  const metaLenOk        = liveMetaLen >= 150 && liveMetaLen <= 160

  async function handleSaveDraft() {
    if (!connectionId) { setError('Select a WordPress site first'); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/admin/content/publish', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          post_id:          postId,
          connection_id:    connectionId,
          title,
          content,
          meta_description: metaDescription,
          slug,
          wp_status:        'draft',
          author_id:        authorId,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to save draft')
      const data = await res.json()
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
        body:    JSON.stringify({
          post_id:          postId,
          connection_id:    connectionId,
          title,
          content,
          meta_description: metaDescription,
          slug,
          wp_status:        wpStatus,
          author_id:        authorId,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to publish')
      const data = await res.json()
      onUpdate({ id: postId, status: wpStatus === 'publish' ? 'published' : 'draft_saved', title: title || null, targetKeyword: targetKeyword || null, wordCount: liveWordCount, headingCount: liveHeadings, internalLinks: liveIntLinks, publishedUrl: data.url ?? null })
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
      setContent(data.content ?? content)
      setMetaDescription(data.metaDescription ?? metaDescription)
      setSlug(data.slug ?? slug)
      setEditNotes('')
      setShowEditNotes(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate')
    } finally {
      setRegenerating(false)
    }
  }

  const Check = ({ ok }: { ok: boolean }) => (
    <span style={{ color: ok ? 'var(--green)' : 'var(--red)', fontWeight: 600, marginRight: 4, fontSize: '0.75rem' }}>
      {ok ? '✓' : '✗'}
    </span>
  )

  const inputStyle = {
    width:        '100%',
    padding:      '0.4rem 0.6rem',
    fontSize:     '0.875rem',
    border:       '1px solid var(--border)',
    borderRadius: 6,
    background:   'var(--bg-surface)',
    color:        'var(--text-primary)',
    boxSizing:    'border-box' as const,
  }

  const labelStyle = {
    display:      'block',
    fontSize:     '0.75rem',
    fontWeight:   600,
    color:        'var(--text-muted)',
    marginBottom: '0.25rem',
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position:   'fixed', inset: 0,
          background: 'rgba(0,0,0,0.35)',
          zIndex:     50,
        }}
      />

      {/* Drawer */}
      <div style={{
        position:   'fixed', top: 0, right: 0, bottom: 0,
        width:      'min(680px, 100vw)',
        background: 'var(--bg-surface)',
        boxShadow:  '-4px 0 24px rgba(0,0,0,0.12)',
        zIndex:     51,
        display:    'flex', flexDirection: 'column',
        overflow:   'hidden',
      }}>

        {/* Header */}
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 style={{ flex: 1, fontSize: '1rem', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
            Review Post
          </h2>
          {post && (
            <span className={`badge ${post.status === 'pending' ? 'badge-amber' : post.status === 'approved' ? 'badge-blue' : post.status === 'published' ? 'badge-green' : 'badge-gray'}`} style={{ fontSize: '0.6875rem' }}>
              {post.status}
            </span>
          )}
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

            {/* WordPress site selector */}
            <div className="mb-4">
              <label style={labelStyle}>WordPress Site</label>
              <select
                value={connectionId}
                onChange={e => setConnectionId(e.target.value)}
                style={inputStyle}
              >
                <option value="">— Select a site —</option>
                {sites.map(s => (
                  <option key={s.connectionId} value={s.connectionId}>
                    {s.siteName} ({s.clientName})
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }} className="mb-4">
              {/* Title */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  style={inputStyle}
                  placeholder="Post title"
                />
              </div>

              {/* Target keyword */}
              <div>
                <label style={labelStyle}>Target Keyword</label>
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
                <label style={labelStyle}>URL Slug</label>
                <input
                  type="text"
                  value={slug}
                  onChange={e => setSlug(e.target.value)}
                  style={inputStyle}
                  placeholder="url-friendly-slug"
                />
              </div>
            </div>

            {/* Content */}
            <div className="mb-4">
              <label style={labelStyle}>Content (HTML)</label>
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                style={{ ...inputStyle, minHeight: 260, fontFamily: 'monospace', fontSize: '0.8125rem', resize: 'vertical' }}
                placeholder="<h2>Introduction</h2><p>…</p>"
              />
            </div>

            {/* Meta description */}
            <div className="mb-4">
              <label style={labelStyle}>
                Meta Description
                <span style={{ fontWeight: 400, marginLeft: 6, color: liveMetaLen > 160 ? 'var(--red)' : liveMetaLen >= 150 ? 'var(--green)' : 'var(--text-faint)' }}>
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
              <p style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: '0.5rem' }}>
                SEO Checklist
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.3rem 1rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                <div><Check ok={keywordInTitle} />Keyword in title</div>
                <div><Check ok={!!keywordInFirst} />Keyword in first 500 chars</div>
                <div><Check ok={liveWordCount >= 600} />{liveWordCount.toLocaleString()} words {liveWordCount < 600 && <span style={{ color: 'var(--text-faint)' }}>(min 600)</span>}</div>
                <div><Check ok={liveHeadings >= 2} />{liveHeadings} H2/H3 headings</div>
                <div><Check ok={metaLenOk} />Meta: {liveMetaLen} chars {!metaLenOk && <span style={{ color: 'var(--text-faint)' }}>(150–160)</span>}</div>
                <div><Check ok={liveIntLinks >= 1} />{liveIntLinks} internal link{liveIntLinks !== 1 ? 's' : ''}</div>
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
                    <button
                      type="button"
                      disabled={regenerating}
                      onClick={handleRegenerate}
                      className="btn btn-primary"
                      style={{ fontSize: '0.8125rem' }}
                    >
                      {regenerating ? 'Regenerating…' : 'Regenerate with AI'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowEditNotes(false); setEditNotes('') }}
                      className="btn btn-secondary"
                      style={{ fontSize: '0.8125rem' }}
                    >
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
              <button
                type="button"
                onClick={handleApprove}
                className="btn btn-secondary"
                style={{ fontSize: '0.8125rem', color: 'var(--blue)' }}
              >
                Approve
              </button>
            )}
            <button
              type="button"
              disabled={saving}
              onClick={handleSaveDraft}
              className="btn btn-secondary"
              style={{ fontSize: '0.8125rem' }}
            >
              {saving ? 'Saving…' : 'Save Draft to WP'}
            </button>
            <button
              type="button"
              disabled={publishing}
              onClick={handlePublish}
              className="btn btn-primary"
              style={{ fontSize: '0.8125rem' }}
            >
              {publishing ? 'Publishing…' : wpStatus === 'publish' ? 'Publish to WP' : 'Send to WP Draft'}
            </button>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onClick={handleReject}
              className="btn btn-secondary"
              style={{ fontSize: '0.8125rem', color: 'var(--red)' }}
            >
              Reject
            </button>
          </div>
        )}
      </div>
    </>
  )
}
