'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowCircleRight } from '@phosphor-icons/react'

interface Site {
  connectionId:  string
  siteUrl:       string
  siteName:      string
  clientId:      string
  clientName:    string
  connectorType?: string
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
  wpPostId?:     number | null
  wpSiteUrl?:    string | null
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
  wpPostId:         number | null
  wpSiteUrl:        string | null
  bcPostId:         number | null
  bcStoreHash:      string | null
  featuredImageUrl: string | null
  targetPublishDate: string | null
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

type WpPublishStatus = 'draft' | 'publish' | 'future'

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
  const text  = html.replace(/<[^>]+>/g, ' ').toLowerCase()
  const words = text.split(/\s+/).filter(Boolean).length
  if (words === 0) return 0
  const regex = new RegExp(keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
  return ((text.match(regex) || []).length / words) * 100
}

function hasImageWithKeywordAlt(html: string, keyword: string): boolean {
  if (!keyword) return false
  const imgs = html.match(/<img [^>]+>/gi) || []
  return imgs.some(img => {
    const m = img.match(/alt=["']([^"']*)["']/i)
    return m ? m[1].toLowerCase().includes(keyword.toLowerCase()) : false
  })
}

// ─── Component ────────────────────────────────────────────────────────────────

type EditorTab = 'content' | 'seo' | 'settings'

const EDITOR_TABS: { id: EditorTab; label: string }[] = [
  { id: 'content',  label: 'Content'    },
  { id: 'seo',      label: 'SEO & Meta' },
  { id: 'settings', label: 'Settings'   },
]

export default function ContentPostEditor({ postId, defaultConnectionId, sites, onClose, onUpdate }: Props) {
  const [post,            setPost]            = useState<PostDetail | null>(null)
  const [loading,         setLoading]         = useState(true)
  const [saving,          setSaving]          = useState(false)
  const [savedFlash,      setSavedFlash]      = useState(false)
  const [regenerating,    setRegenerating]    = useState(false)
  const [approving,       setApproving]       = useState(false)
  const [error,           setError]           = useState('')
  const [isDirty,         setIsDirty]         = useState(false)
  const [activeEditorTab, setActiveEditorTab] = useState<EditorTab>('content')

  // Image generation
  const [generatingImage,   setGeneratingImage]   = useState(false)
  const [imageUploadingMsg, setImageUploadingMsg] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

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
  const [wpStatus,     setWpStatus]     = useState<WpPublishStatus>('draft')
  const [authorId,     setAuthorId]     = useState<number | null>(null)
  const [connectionId, setConnectionId] = useState<string>(defaultConnectionId ?? '')
  useEffect(() => {
    if (!connectionId && sites.length === 1) setConnectionId(sites[0].connectionId)
  }, [sites])

  // Featured image
  const [featuredImageUrl, setFeaturedImageUrl] = useState('')

  // AI re-edit
  const [editNotes,     setEditNotes]     = useState('')
  const [showEditNotes, setShowEditNotes] = useState(false)

  // Authors + WP tags
  const [authors,        setAuthors]        = useState<Author[]>([])
  const [authorsLoading, setAuthorsLoading] = useState(false)
  const [defaultAuthorId, setDefaultAuthorId] = useState<number | null>(null)
  const [wpTags,         setWpTags]         = useState<WpTag[]>([])

  // Preview
  const [showPreview, setShowPreview] = useState(false)

  // Mark dirty on any field change after initial load
  const loadedRef = useRef(false)

  function markDirty() {
    if (loadedRef.current) setIsDirty(true)
  }

  // ── Load post detail ────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true)
      loadedRef.current = false
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
        setFeaturedImageUrl(data.featuredImageUrl ?? '')
        if (!connectionId && defaultConnectionId) setConnectionId(defaultConnectionId)

        // Default publish status based on target publish date
        if (data.targetPublishDate) {
          const publishDate = new Date(data.targetPublishDate + 'T00:00:00')
          setWpStatus(publishDate > new Date() ? 'future' : 'publish')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        setLoading(false)
        setTimeout(() => { loadedRef.current = true }, 100)
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
      const [authRes, tagRes, settingsRes] = await Promise.all([
        fetch(`/api/admin/wordpress/authors?connection_id=${connId}`),
        fetch(`/api/admin/wordpress/tags?connection_id=${connId}`),
        post ? fetch(`/api/admin/content/settings?client_id=${post.clientId}`) : Promise.resolve(null),
      ])
      if (authRes.ok) setAuthors((await authRes.json()).authors ?? [])
      if (tagRes.ok)  setWpTags((await tagRes.json()).tags ?? [])
      if (settingsRes?.ok) {
        const s = await settingsRes.json()
        const defId = s?.default_author_id ?? null
        setDefaultAuthorId(defId)
        // Auto-select default author if none chosen yet
        if (defId && authorId === null) setAuthorId(defId)
      }
    } catch {
      // silently ignore — optional data
    } finally {
      setAuthorsLoading(false)
    }
  }, [post, authorId])

  useEffect(() => {
    if (connectionId) loadSiteData(connectionId)
  }, [connectionId, loadSiteData])

  // ── Live SEO computations ───────────────────────────────────────────────────
  const liveWordCount      = content ? countWords(content) : 0
  const liveHeadings       = content ? countHeadings(content) : 0
  const liveIntLinks       = content ? countInternalLinks(content) : 0
  const liveExtLinks       = content ? countExternalLinks(content) : 0
  const liveMetaLen        = (metaDescription ?? '').length
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
    if (trimmed && !tags.includes(trimmed)) { setTags(prev => [...prev, trimmed]); markDirty() }
  }

  function removeTag(name: string) {
    setTags(prev => prev.filter(t => t !== name)); markDirty()
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

  // ── Save Changes ────────────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/content/posts/${postId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          title, seoTitle, content, metaDescription, slug,
          targetKeyword, suggestedTags: tags,
          featuredImageUrl: featuredImageUrl || null,
          wpStatus, authorId,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to save')
      setIsDirty(false)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  // ── Approve ─────────────────────────────────────────────────────────────────
  async function handleApprove() {
    setApproving(true)
    setError('')
    try {
      const saveRes = await fetch(`/api/admin/content/posts/${postId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          title, seoTitle, content, metaDescription, slug,
          targetKeyword, suggestedTags: tags,
          featuredImageUrl: featuredImageUrl || null,
          wpStatus, authorId,
        }),
      })
      if (!saveRes.ok) throw new Error((await saveRes.json()).error || 'Failed to save edits')

      const activeSite   = connectionId ? sites.find(s => s.connectionId === connectionId) : null
      const isBigCommerce = activeSite?.connectorType === 'bigcommerce'

      const confirmMsg = activeSite
        ? `This will push "${title || 'this post'}" to ${activeSite.siteName}. Continue?`
        : `No site connected — the post will be marked approved but not pushed anywhere. Continue?`
      if (!window.confirm(confirmMsg)) { setApproving(false); return }

      let pushData: Record<string, unknown> = {}
      if (activeSite) {
        const route = isBigCommerce
          ? `/api/admin/content/posts/${postId}/publish-bigcommerce`
          : `/api/admin/content/posts/${postId}/approve`
        const pushRes = await fetch(route, { method: 'POST' })
        if (!pushRes.ok) {
          const body = await pushRes.json().catch(() => ({ error: 'Push failed' }))
          throw new Error(body.error || `Push failed (${pushRes.status})`)
        }
        pushData = await pushRes.json().catch(() => ({}))
      } else {
        fetch(`/api/admin/content/posts/${postId}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ status: 'draft_saved' }),
        }).catch(e => console.error('[handleApprove status]', e))
      }

      onUpdate({
        id: postId, status: 'draft_saved',
        title: title || null, targetKeyword: targetKeyword || null,
        wordCount: liveWordCount, headingCount: liveHeadings, internalLinks: liveIntLinks,
        publishedUrl: (pushData.published_url as string | null) ?? post?.publishedUrl ?? null,
        wpPostId:  (pushData.wp_post_id  as number | null) ?? null,
        wpSiteUrl: (pushData.wp_site_url as string | null) ?? null,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve')
      setApproving(false)
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
      setIsDirty(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate')
    } finally {
      setRegenerating(false)
    }
  }

  // ── Image generation ────────────────────────────────────────────────────────
  async function handleGenerateImage() {
    setGeneratingImage(true)
    setImageUploadingMsg('')
    setError('')
    try {
      const res = await fetch(`/api/admin/content/posts/${postId}/generate-image`, { method: 'POST' })
      const data = await res.json() as { url?: string; error?: string }
      if (!res.ok || data.error) throw new Error(data.error ?? 'Image generation failed')
      setFeaturedImageUrl(data.url ?? '')
      setIsDirty(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image generation failed')
    } finally {
      setGeneratingImage(false)
    }
  }

  async function handleImageFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImageUploadingMsg('Uploading…')
    setError('')
    try {
      const form = new FormData()
      form.append('image', file)
      const res = await fetch(`/api/admin/content/posts/${postId}/upload-image`, { method: 'POST', body: form })
      const data = await res.json() as { url?: string; error?: string }
      if (!res.ok || data.error) throw new Error(data.error ?? 'Upload failed')
      setFeaturedImageUrl(data.url ?? '')
      setIsDirty(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setImageUploadingMsg('')
      if (fileInputRef.current) fileInputRef.current.value = ''
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

  const isOnSite = post?.status === 'draft_saved' || post?.status === 'published'

  const previewSrcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:Georgia,serif;max-width:780px;margin:2rem auto;padding:0 1.5rem;line-height:1.8;color:#1a1a1a;background:#fff}
    h1{font-size:2rem;line-height:1.3;margin-bottom:.5rem;color:#111}
    h2{font-size:1.5rem;margin-top:2rem;color:#111}
    h3{font-size:1.25rem;margin-top:1.5rem;color:#222}
    h4{font-size:1.1rem;margin-top:1.25rem;color:#333}
    p{margin-bottom:1.2rem}ul,ol{margin-bottom:1.2rem;padding-left:1.5rem}
    li{margin-bottom:.4rem}strong{font-weight:700}a{color:#2563eb;text-decoration:underline}
    img{max-width:100%;height:auto;border-radius:4px}
    blockquote{border-left:4px solid #e5e7eb;margin:1.5rem 0;padding:.75rem 1rem;color:#555;font-style:italic}
  </style></head><body><h1>${title.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</h1>${content}</body></html>`

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 50 }} />

      {/* Preview overlay */}
      {showPreview && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 53, background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1, fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>Preview — {title || 'Untitled'}</span>
            <button type="button" onClick={() => setShowPreview(false)} className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}>
              ✕ Close Preview
            </button>
          </div>
          <iframe srcDoc={previewSrcdoc} title="Post Preview" style={{ flex: 1, border: 'none', width: '100%' }} />
        </div>
      )}

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(720px, 100vw)',
        background: 'var(--bg-surface)',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
        zIndex: 51, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 style={{ flex: 1, fontSize: '1rem', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
            Review Post
          </h2>
          {isDirty && (
            <span style={{ fontSize: '0.7rem', color: 'var(--amber, #f59e0b)', fontWeight: 500 }}>
              ● Unsaved changes
            </span>
          )}
          {post && (
            <span className={`badge ${post.status === 'for_review' ? 'badge-amber' : post.status === 'approved' ? 'badge-blue' : post.status === 'published' ? 'badge-green' : post.status === 'draft_saved' ? 'badge-blue' : 'badge-gray'}`} style={{ fontSize: '0.6875rem' }}>
              {post.status === 'draft_saved' ? 'Scheduled' : post.status === 'for_review' ? 'For Review' : post.status}
            </span>
          )}
          <button type="button" onClick={() => setShowPreview(true)} className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}>
            Preview
          </button>
          <button type="button" onClick={onClose} className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }} aria-label="Close">
            ✕
          </button>
        </div>

        {/* Tab navigation */}
        {!loading && (
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 1.25rem' }}>
            {EDITOR_TABS.map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveEditorTab(tab.id)}
                style={{
                  padding: '0.5rem 0.875rem',
                  fontSize: '0.75rem',
                  fontWeight: activeEditorTab === tab.id ? 600 : 400,
                  color: activeEditorTab === tab.id ? 'var(--text-primary)' : 'var(--text-muted)',
                  background: 'none',
                  border: 'none',
                  borderBottom: `2px solid ${activeEditorTab === tab.id ? 'var(--accent, #2563eb)' : 'transparent'}`,
                  cursor: 'pointer',
                  letterSpacing: '0.02em',
                  marginBottom: -1,
                  whiteSpace: 'nowrap',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

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

            {/* On Site banner */}
            {isOnSite && (
              <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid var(--green)', borderRadius: 6, padding: '0.5rem 0.75rem', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--green)', fontWeight: 600, fontSize: '0.8125rem' }}>✓ On Site</span>
                  {post?.wpPostId && post?.wpSiteUrl && (
                    <a href={`${post.wpSiteUrl}/wp-admin/post.php?post=${post.wpPostId}&action=edit`} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.8125rem', color: 'var(--blue)', fontWeight: 600 }}>
                      Edit in WordPress ↗
                    </a>
                  )}
                  {post?.bcPostId && post?.bcStoreHash && (
                    <a href={`https://store-${post.bcStoreHash}.mybigcommerce.com/manage/site/content`} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.8125rem', color: 'var(--blue)', fontWeight: 600 }}>
                      Edit in BigCommerce ↗
                    </a>
                  )}
                  {post?.publishedUrl && (
                    <a href={post.publishedUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.8125rem', color: 'var(--blue)' }}>View post ↗</a>
                  )}
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>
                  This post has been saved to your site as a draft. Edit and publish it directly in the CMS.
                </p>
              </div>
            )}

            {/* ── TAB: Content ──────────────────────────────────────────────── */}
            <div style={{ display: activeEditorTab === 'content' ? 'block' : 'none' }}>
              {/* H1 Title */}
              <div className="mb-4">
                <label style={labelStyle}>H1 Title</label>
                <input type="text" value={title} onChange={e => { setTitle(e.target.value); markDirty() }} style={inputStyle} placeholder="Post H1 title" />
              </div>

              {/* Content */}
              <div className="mb-4">
                <label style={labelStyle}>Content (HTML)</label>
                <textarea value={content} onChange={e => { setContent(e.target.value); markDirty() }} style={{ ...inputStyle, minHeight: 280, fontFamily: 'monospace', fontSize: '0.8125rem', resize: 'vertical' }} placeholder="<h2>Introduction</h2><p>…</p>" />
              </div>

              {/* Featured image */}
              <div className="mb-4">
                <label style={labelStyle}>Featured Image</label>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <button type="button" onClick={handleGenerateImage} disabled={generatingImage} className="btn btn-secondary" style={{ fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: 5 }}>
                    {generatingImage ? 'Generating…' : '✦ Generate with AI'}
                  </button>
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="btn btn-secondary" style={{ fontSize: '0.8125rem' }}>
                    {imageUploadingMsg || 'Upload Image'}
                  </button>
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageFileChange} style={{ display: 'none' }} />
                  {featuredImageUrl && (
                    <button type="button" onClick={() => { setFeaturedImageUrl(''); markDirty() }} className="btn btn-secondary" style={{ fontSize: '0.8125rem', color: 'var(--red)' }}>
                      ✕ Remove
                    </button>
                  )}
                </div>
                <input type="url" value={featuredImageUrl} onChange={e => { setFeaturedImageUrl(e.target.value); markDirty() }} style={inputStyle} placeholder="Or paste image URL…" />
                {featuredImageUrl && (
                  <img src={featuredImageUrl} alt="Featured image preview" style={{ maxHeight: 140, marginTop: 8, borderRadius: 6, objectFit: 'cover', maxWidth: '100%', border: '1px solid var(--border)' }} />
                )}
              </div>
            </div>

            {/* ── TAB: SEO & Meta ───────────────────────────────────────────── */}
            <div style={{ display: activeEditorTab === 'seo' ? 'block' : 'none' }}>
              {/* SEO Title */}
              <div className="mb-4">
                <label style={labelStyle}>
                  SEO Title
                  <span style={{ fontWeight: 400, marginLeft: 6, color: seoTitle.length > 65 ? 'var(--amber, #f59e0b)' : seoTitle.length > 0 ? 'var(--green)' : 'var(--text-faint)' }}>
                    {seoTitle.length}/60
                  </span>
                </label>
                <input type="text" value={seoTitle} onChange={e => { setSeoTitle(e.target.value); markDirty() }} style={inputStyle} placeholder="SEO title (60 chars, includes focus keyword)" />
              </div>

              {/* Focus Keyword + URL Slug */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }} className="mb-4">
                <div>
                  <label style={labelStyle}>Focus Keyword</label>
                  <input type="text" value={targetKeyword} onChange={e => { setTargetKeyword(e.target.value); markDirty() }} style={inputStyle} placeholder="Primary keyword" />
                </div>
                <div>
                  <label style={labelStyle}>
                    URL Slug
                    {slug && <span style={{ fontWeight: 400, marginLeft: 6, color: slug.length > 130 ? 'var(--red)' : 'var(--text-faint)' }}>{slug.length} chars</span>}
                  </label>
                  <input type="text" value={slug} onChange={e => { setSlug(e.target.value); markDirty() }} style={inputStyle} placeholder="url-friendly-slug" />
                </div>
              </div>

              {/* Tags */}
              <div className="mb-4">
                <label style={labelStyle}>Tags</label>
                <div style={{
                  display: 'flex', flexWrap: 'wrap', gap: '0.375rem',
                  padding: '0.375rem 0.5rem', border: '1px solid var(--border)', borderRadius: 6,
                  background: 'var(--bg-surface)', minHeight: 38, cursor: 'text',
                }}
                  onClick={() => (document.getElementById('tag-input') as HTMLInputElement)?.focus()}
                >
                  {tags.map(tag => (
                    <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', fontWeight: 500, padding: '0.1rem 0.5rem', borderRadius: 4, background: 'var(--bg-muted)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                      {tag}
                      <button type="button" onClick={() => removeTag(tag)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: '0.75rem', padding: 0, lineHeight: 1 }}>×</button>
                    </span>
                  ))}
                  <input id="tag-input" type="text" value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={handleTagInputKeyDown} placeholder={tags.length === 0 ? 'Type tag, press Enter…' : ''} style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: '0.8125rem', color: 'var(--text-primary)', minWidth: 120, flex: 1 }} />
                </div>
                {wpTags.length > 0 && (
                  <div style={{ marginTop: '0.375rem', display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                    {wpTags.filter(t => !tags.includes(t.name)).slice(0, 12).map(t => (
                      <button key={t.id} type="button" onClick={() => addTag(t.name)} style={{ fontSize: '0.6875rem', padding: '0.1rem 0.4rem', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
                        + {t.name}
                      </button>
                    ))}
                  </div>
                )}
                <p style={{ fontSize: '0.6875rem', color: 'var(--text-faint)', marginTop: '0.25rem' }}>
                  Add/remove before publishing. Press Enter or comma to add a custom tag.
                </p>
              </div>

              {/* Meta description */}
              <div className="mb-4">
                <label style={labelStyle}>
                  Meta Description
                  <span style={{ fontWeight: 400, marginLeft: 6, color: liveMetaLen > 160 ? 'var(--amber, #f59e0b)' : liveMetaLen >= 150 ? 'var(--green)' : 'var(--text-faint)' }}>
                    {liveMetaLen}/160
                  </span>
                </label>
                <textarea value={metaDescription} onChange={e => { setMetaDescription(e.target.value); markDirty() }} rows={2} style={{ ...inputStyle, resize: 'vertical' }} placeholder="SEO meta description (150–160 characters)" />
              </div>

              {/* SEO checklist */}
              <div className="card mb-4" style={{ padding: '0.875rem 1rem', background: 'var(--bg-subtle)' }}>
                <p style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: 'var(--text-faint)', marginBottom: '0.5rem' }}>SEO Checklist</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.3rem 0.75rem', fontSize: '0.775rem', color: 'var(--text-muted)' }}>
                  <div><Check ok={keywordInTitle} />Keyword in H1</div>
                  <div><Check ok={keywordInSeoTitle} />Keyword in SEO title</div>
                  <div><Check ok={keywordInMeta} />Keyword in meta desc</div>
                  <div><Check ok={!!keywordInFirst} />Keyword in opening</div>
                  <div><Check ok={keywordInSubhd} />Keyword in subheading</div>
                  <div><Check ok={densityOk} warn={densityPct > 0 && !densityOk} />{densityPct.toFixed(1)}% density</div>
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
            </div>

            {/* ── TAB: Settings ─────────────────────────────────────────────── */}
            <div style={{ display: activeEditorTab === 'settings' ? 'block' : 'none' }}>
              {/* Site connection selector */}
              <div className="mb-4">
                <label style={labelStyle}>Site Connection</label>
                <select value={connectionId} onChange={e => { setConnectionId(e.target.value); markDirty() }} style={inputStyle}>
                  <option value="">— Select a site —</option>
                  {sites.map(s => <option key={s.connectionId} value={s.connectionId}>{s.siteName} ({s.clientName})</option>)}
                </select>
              </div>

              {/* Author + publish status */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }} className="mb-4">
                <div>
                  <label style={labelStyle}>WP Author</label>
                  <select value={authorId ?? ''} onChange={e => { setAuthorId(e.target.value ? Number(e.target.value) : null); markDirty() }} style={inputStyle} disabled={authorsLoading}>
                    <option value="">{authorsLoading ? 'Loading…' : '— Default —'}</option>
                    {authors.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.name}{a.id === defaultAuthorId ? ' (Default)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Publish as</label>
                  <select value={wpStatus} onChange={e => { setWpStatus(e.target.value as WpPublishStatus); markDirty() }} style={inputStyle}>
                    <option value="future">Scheduled Published - Draft</option>
                    <option value="draft">Draft</option>
                    <option value="publish">Published</option>
                  </select>
                </div>
              </div>

              {/* AI re-edit */}
              <div className="mb-4">
                {!showEditNotes ? (
                  <button type="button" onClick={() => setShowEditNotes(true)} className="btn btn-secondary" style={{ fontSize: '0.8125rem' }}>
                    Editor Notes for Regeneration…
                  </button>
                ) : (
                  <div>
                    <label style={labelStyle}>Editor Notes for Regeneration</label>
                    <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical', marginBottom: '0.5rem' }} placeholder="e.g. Make the tone more conversational and add a FAQ section at the end" autoFocus />
                    <div className="flex gap-2">
                      <button type="button" disabled={regenerating} onClick={handleRegenerate} className="btn btn-primary" style={{ fontSize: '0.8125rem' }}>
                        {regenerating ? 'Regenerating…' : 'Regenerate with AI'}
                      </button>
                      <button type="button" onClick={() => { setShowEditNotes(false); setEditNotes('') }} className="btn btn-secondary" style={{ fontSize: '0.8125rem' }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Footer actions */}
        {!loading && (
          <div style={{ padding: '0.875rem 1.25rem', borderTop: '1px solid var(--border)', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Save Changes */}
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !isDirty}
              className="btn btn-secondary"
              style={{ fontSize: '0.8125rem', opacity: isDirty ? 1 : 0.5 }}
            >
              {saving ? 'Saving…' : savedFlash ? 'Saved ✓' : 'Save Changes'}
            </button>

            {/* Approve — push to site */}
            {!isOnSite && (
              <button type="button" onClick={handleApprove} disabled={approving} className="btn btn-primary" style={{ fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: 5 }}>
                <ArrowCircleRight size={15} weight="bold" />
                {approving ? 'Saving…' : 'Approve'}
              </button>
            )}

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
