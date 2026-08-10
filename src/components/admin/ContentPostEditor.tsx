'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowCircleRight, ArrowClockwise } from '@phosphor-icons/react'
import CollapsibleSection from '@/components/admin/CollapsibleSection'

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
  onRegenerateStart?:   () => void
  onRegenerateDone?:    (post: Partial<UpdatedPost>) => void
  onRegenerateError?:   () => void
  onMonthlyApprove?:    () => void
  onMonthlyDiscard?:    () => void
  onMonthlyRegenerate?: () => void
  autoScanLinks?:       boolean  // auto-trigger link scan on mount (e.g. when opened from monthly review)
  topicBreakdown?:      TopicBreakdown | null
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
  wpCategoryIds:    number[] | null
  wpPostId:         number | null
  wpSiteUrl:        string | null
  bcPostId:         number | null
  bcStoreHash:      string | null
  featuredImageUrl:          string | null
  targetPublishDate:         string | null
  topicId:                   string | null
  postConnectionId:          string | null
  scheduleDefaultAuthorId:   number | null
  schedulePublishMode:       string | null
  scheduleBcAuthor:          string | null
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

interface WpCategory {
  id:   number
  name: string
}

interface CategorySuggestion {
  id:    number | null  // null = doesn't exist yet in WP, will be created at publish
  name:  string
  isNew: boolean
}

type WpPublishStatus = 'draft' | 'publish' | 'future'

// ─── SEO check helpers ────────────────────────────────────────────────────────

function seoCheck(field: string | null, keyword: string): boolean {
  if (!field || !keyword) return false
  const f = field.toLowerCase()
  const k = keyword.toLowerCase()
  if (f.includes(k)) return true
  // Pass if ≥75% of keyword words appear in field — handles state abbreviations (FL vs Florida)
  const words = k.split(/\s+/).filter(Boolean)
  if (words.length === 0) return false
  return words.filter(w => f.includes(w)).length / words.length >= 0.75
}

function countWords(html: string): number {
  return html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length
}

function countHeadings(html: string): number {
  return (html.match(/<h[2-4][^>]*>/gi) || []).length
}

function countInternalLinks(html: string): number {
  return (html.match(/<a [^>]+>/gi) || []).filter(l => !l.match(/href=["']https?:\/\//i)).length
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

// ─── Category auto-suggestion ───────────────────────────────────────────────────
// Word-level matching (exact or shared prefix, ≥4 chars, stopwords removed) so a
// laptop-repair post doesn't match "Business Phone Systems" just because 'business'
// contains 'in' and 'phone' contains 'on'. Precision over recall — a bad guess is
// worse than falling back to a Blog category the user can override.
const CATEGORY_STOPWORDS = new Set([
  'the','and','for','with','your','you','our','are','was','how','why','what','when','where','who',
  'will','from','into','out','off','not','but','all','any','has','have','had','get','got','this',
  'that','these','those','before','after','about','over','than','then','they','them','been','does',
  'done','just','like','more','most','some','such','only','also','very','much','many','each','every',
  'their','there','here','would','could','should','while','which','shop','call','calling','turn','need',
])

function tokenizeForCategory(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w.length >= 4 && !CATEGORY_STOPWORDS.has(w))
}

// Both inputs are already ≥4 chars: match on equality or a shared prefix
// (handles system/systems, repair/repairs, cyber/cybersecurity).
function categoryWordsOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(b) || b.startsWith(a)
}

function suggestCategory(
  cats: WpCategory[],
  keyword: string | null | undefined,
  title: string | null | undefined,
): CategorySuggestion {
  const kwWords    = tokenizeForCategory([keyword, title].filter(Boolean).join(' '))
  const nonDefault = cats.filter(c => c.name.toLowerCase() !== 'uncategorized')
  const scored = nonDefault
    .map(c => ({ c, score: tokenizeForCategory(c.name).filter(cw => kwWords.some(kw => categoryWordsOverlap(cw, kw))).length }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)

  if (scored.length > 0) {
    return { id: scored[0].c.id, name: scored[0].c.name, isNew: false }
  }
  // No meaningful keyword match — fall back to a Blog category rather than guessing.
  const blogCat = nonDefault.find(c => ['blog', 'articles', 'news', 'posts'].includes(c.name.toLowerCase()))
  return blogCat ? { id: blogCat.id, name: blogCat.name, isNew: false } : { id: null, name: 'Blog', isNew: true }
}

// ─── Component ────────────────────────────────────────────────────────────────

type SectionId = 'content' | 'seo' | 'publish'

interface TopicBreakdown {
  keyword_opportunity?:    string | null
  ranking_strategy?:       string | null
  audience_intent?:        string | null
  why_now?:                string | null
  competition_level?:      string | null
  page_to_support?:        string | null
  competitors_researched?: string[] | null
}

export default function ContentPostEditor({ postId, defaultConnectionId, sites, onClose, onUpdate, onRegenerateStart, onRegenerateDone, onRegenerateError, onMonthlyApprove, onMonthlyDiscard, onMonthlyRegenerate, autoScanLinks, topicBreakdown }: Props) {
  const [post,            setPost]            = useState<PostDetail | null>(null)
  const [loading,         setLoading]         = useState(true)
  const [saving,          setSaving]          = useState(false)
  const [savedFlash,      setSavedFlash]      = useState(false)
  const [regenerating,      setRegenerating]      = useState(false)
  const [fullRegenerating,  setFullRegenerating]  = useState(false)
  const [showEditDirection, setShowEditDirection] = useState(false)
  const [showRegenConfirm,  setShowRegenConfirm]  = useState(false)
  const [approving,       setApproving]       = useState(false)
  const [retrying,        setRetrying]        = useState(false)
  const [error,           setError]           = useState('')
  const [isDirty,         setIsDirty]         = useState(false)
  const [fetchedBreakdown, setFetchedBreakdown] = useState<TopicBreakdown | null>(null)

  // Two-pane tabless layout: collapsible right-column sections + header strategy panel
  const [openSections, setOpenSections] = useState<Set<SectionId>>(new Set<SectionId>(['content', 'seo', 'publish']))
  const toggleSection = (id: SectionId) =>
    setOpenSections(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  const openSection = (id: SectionId) =>
    setOpenSections(prev => new Set(prev).add(id))
  const [showStrategy, setShowStrategy] = useState(false)
  const [isNarrow,     setIsNarrow]     = useState(false)

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
  const [wpStatus,      setWpStatus]      = useState<WpPublishStatus>('draft')
  const [authorId,      setAuthorId]      = useState<number | null>(null)
  const [bcAuthorName,  setBcAuthorName]  = useState('')
  const [connectionId,  setConnectionId]  = useState<string>(defaultConnectionId ?? '')

  // Featured image
  const [featuredImageUrl, setFeaturedImageUrl] = useState('')

  // AI re-edit
  const [editNotes,     setEditNotes]     = useState('')
  const [showEditNotes, setShowEditNotes] = useState(false)

  // Authors + WP tags + categories
  const [authors,        setAuthors]        = useState<Author[]>([])
  const [authorsLoading, setAuthorsLoading] = useState(false)
  const [defaultAuthorId, setDefaultAuthorId] = useState<number | null>(null)
  const [wpTags,         setWpTags]         = useState<WpTag[]>([])
  const [categories,        setCategories]        = useState<WpCategory[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(false)
  const [categoryIds,       setCategoryIds]       = useState<number[]>([])
  const [categorySuggestion, setCategorySuggestion] = useState<CategorySuggestion | null>(null)

  // Preview
  const [showPreview, setShowPreview] = useState(false)

  // Link health scan
  type LinkScanResult = {
    links:  { url: string; status: number | null; ok: boolean; redirected: boolean; finalUrl: string | null; error?: string }[]
    phones: { raw: string; digits: string; valid: boolean }[]
    scannedAt: string
  }
  const [linkScan,        setLinkScan]        = useState<LinkScanResult | 'scanning' | null>(null)
  const [showBrokenLinks, setShowBrokenLinks] = useState(false)

  const contentTextareaRef = useRef<HTMLTextAreaElement>(null)

  // Responsive: below 880px the panes stack and the left preview collapses to the overlay
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 880px)')
    const on = () => setIsNarrow(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

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
        setAuthorId(data.wpAuthorId ?? data.scheduleDefaultAuthorId ?? null)
        setBcAuthorName(data.scheduleBcAuthor ?? '')
        setCategoryIds(data.wpCategoryIds ?? [])
        setFeaturedImageUrl(data.featuredImageUrl ?? '')
        // Seed connection: post's stored connection > schedule default > first BC site > first any site
        const autoSite = sites.find(s => s.connectorType === 'bigcommerce') ?? sites[0]
        setConnectionId(data.postConnectionId ?? defaultConnectionId ?? autoSite?.connectionId ?? '')

        // Default publish status: draft_only mode always overrides; otherwise use target date
        if (data.schedulePublishMode === 'draft_only') {
          setWpStatus('draft')
        } else if (data.targetPublishDate) {
          const publishDate = new Date(data.targetPublishDate + 'T00:00:00')
          setWpStatus(publishDate > new Date() ? 'future' : 'publish')
        } else if (data.schedulePublishMode) {
          setWpStatus('future')
        }

        // Auto-fetch topic breakdown when not passed as prop (e.g. monthly review context)
        if (topicBreakdown === undefined && data.topicId) {
          fetch(`/api/admin/content/topics/${data.topicId}`)
            .then(r => r.ok ? r.json() : null)
            .then((bd: TopicBreakdown | null) => { if (bd) setFetchedBreakdown(bd) })
            .catch(() => {})
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

  // Poll every 10 s while a full-regenerate background job is running so the editor
  // unlocks and notifies the user as soon as the new content lands.
  useEffect(() => {
    if (post?.status !== 'generating') return
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/admin/content/post?id=${postId}`)
        if (!res.ok) return
        const updated: PostDetail = await res.json()
        if (updated.status !== 'generating') {
          setPost(updated)
          setTitle(updated.title ?? '')
          setContent(updated.content ?? '')
          clearInterval(timer)
          onRegenerateDone?.({ title: updated.title })
        }
      } catch { /* network blip — will retry */ }
    }, 10_000)
    return () => clearInterval(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.status, postId])

  // ── Load authors + WP tags when connectionId changes ───────────────────────
  const loadSiteData = useCallback(async (connId: string) => {
    if (!connId) return
    setAuthorsLoading(true)
    try {
      const [authRes, tagRes, catRes, settingsRes] = await Promise.all([
        fetch(`/api/admin/wordpress/authors?connection_id=${connId}`),
        fetch(`/api/admin/wordpress/tags?connection_id=${connId}`),
        fetch(`/api/admin/wordpress/categories?connection_id=${connId}`),
        post ? fetch(`/api/admin/content/settings?client_id=${post.clientId}`) : Promise.resolve(null),
      ])
      if (authRes.ok) setAuthors((await authRes.json()).authors ?? [])
      if (tagRes.ok)  setWpTags((await tagRes.json()).tags ?? [])
      if (catRes.ok) {
        const fetchedCats: WpCategory[] = (await catRes.json()).categories ?? []
        setCategories(fetchedCats)
        // Only suggest if the post has no explicit category selected yet
        if (!post?.wpCategoryIds || post.wpCategoryIds.length === 0) {
          setCategorySuggestion(suggestCategory(fetchedCats, post?.targetKeyword, post?.title))
        }
      }
      if (settingsRes?.ok) {
        const s = await settingsRes.json()
        const defId = s?.default_author_id ?? null
        setDefaultAuthorId(defId)
        // Auto-select default author if none chosen yet
        if (defId) setAuthorId(cur => cur ?? defId)
      }
    } catch {
      // silently ignore — optional data
    } finally {
      setAuthorsLoading(false)
    }
  }, [post])

  useEffect(() => {
    if (connectionId) loadSiteData(connectionId)
  }, [connectionId, loadSiteData])

  const refreshCategories = useCallback(async () => {
    if (!connectionId) return
    setCategoriesLoading(true)
    try {
      const res = await fetch(`/api/admin/wordpress/categories?connection_id=${connectionId}`)
      if (!res.ok) return
      const fetchedCats: WpCategory[] = (await res.json()).categories ?? []
      setCategories(fetchedCats)
      // Re-run suggestion only if the user hasn't pinned a category
      if (categoryIds.length === 0) {
        setCategorySuggestion(suggestCategory(fetchedCats, post?.targetKeyword, post?.title))
      }
    } catch { /* non-fatal */ } finally {
      setCategoriesLoading(false)
    }
  }, [connectionId, categoryIds, post?.targetKeyword, post?.title])

  // Auto-scan links on mount when opened from a context that requests it (e.g. monthly review)
  useEffect(() => {
    if (autoScanLinks) handleScanLinks()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
  const seoTitleLenOk      = seoTitle.length > 0 && seoTitle.length <= 60

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

  // ── Jump to broken link in content textarea ─────────────────────────────────
  function jumpToLink(url: string) {
    const textarea = contentTextareaRef.current
    if (!textarea || !content) return
    const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const hrefMatch = new RegExp(`href=["']${escaped}["']`, 'i').exec(content)
    if (!hrefMatch) return
    const tagStart = content.lastIndexOf('<a', hrefMatch.index)
    const tagEnd   = content.indexOf('>', hrefMatch.index) + 1
    const selStart = tagStart >= 0 ? tagStart : hrefMatch.index
    const selEnd   = tagEnd > selStart ? tagEnd : selStart + url.length
    openSection('content')
    // setTimeout(50) gives the section-open re-render time to complete.
    // HTML has very few newlines so line-counting is unreliable — use a character-position
    // proportion against scrollHeight to center the match in the visible viewport.
    setTimeout(() => {
      textarea.focus()
      textarea.setSelectionRange(selStart, selEnd)
      const ratio = selStart / Math.max(content.length, 1)
      textarea.scrollTop = Math.max(0, ratio * textarea.scrollHeight - textarea.clientHeight / 3)
    }, 50)
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
          wpStatus, authorId, categoryIds: categoryIds.length > 0 ? categoryIds : null,
          bcAuthorName: bcAuthorName || null,
          connectionId: connectionId || null,
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

  // ── Monthly Review actions ───────────────────────────────────────────────────
  async function handleMonthlyApprove() {
    if (isDirty) await handleSave()
    onMonthlyApprove?.()
    onClose()
  }

  function handleMonthlyDiscard() {
    onMonthlyDiscard?.()
    onClose()
  }

  // ── Approve ─────────────────────────────────────────────────────────────────
  async function handleApprove() {
    setApproving(true)
    setError('')
    try {
      const activeSite    = connectionId ? sites.find(s => s.connectionId === connectionId) : null
      const isBigCommerce = activeSite?.connectorType === 'bigcommerce'

      if (!activeSite) {
        setError('Select a site connection in the Settings tab before approving.')
        setApproving(false)
        return
      }
      if (!window.confirm(`Push "${title || 'this post'}" to ${activeSite.siteName}?`)) { setApproving(false); return }

      const saveRes = await fetch(`/api/admin/content/posts/${postId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          title, seoTitle, content, metaDescription, slug,
          targetKeyword, suggestedTags: tags,
          featuredImageUrl: featuredImageUrl || null,
          wpStatus, authorId, categoryIds: categoryIds.length > 0 ? categoryIds : null,
          connectionId,
        }),
      })
      if (!saveRes.ok) throw new Error((await saveRes.json()).error || 'Failed to save edits')

      const route = isBigCommerce
        ? `/api/admin/content/posts/${postId}/publish-bigcommerce`
        : `/api/admin/content/posts/${postId}/approve`
      const pushRes = await fetch(route, { method: 'POST' })
      if (!pushRes.ok) {
        const body = await pushRes.json().catch(() => ({ error: 'Push failed' }))
        throw new Error(body.error || `Push failed (${pushRes.status})`)
      }
      const pushData = await pushRes.json().catch(() => ({}))

      onUpdate({
        id: postId, status: 'draft_saved',
        title: title || null, targetKeyword: targetKeyword || null,
        wordCount: liveWordCount, headingCount: liveHeadings, internalLinks: liveIntLinks,
        publishedUrl: (pushData.published_url as string | null) ?? post?.publishedUrl ?? null,
        wpPostId:  (pushData.wp_post_id  as number | null) ?? null,
        wpSiteUrl: (pushData.wp_site_url as string | null) ?? null,
      })
      setApproving(false)
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

  async function handleRetry() {
    if (!connectionId) { setError('Select a site connection in the Settings tab first'); return }
    setRetrying(true); setError('')
    try {
      // Save all editor state (including connectionId) before pushing — same as handleApprove
      const saveRes = await fetch(`/api/admin/content/posts/${postId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          title, seoTitle, content, metaDescription, slug,
          targetKeyword, suggestedTags: tags,
          featuredImageUrl: featuredImageUrl || null,
          wpStatus, authorId, bcAuthorName: bcAuthorName || null, connectionId,
        }),
      })
      if (!saveRes.ok) throw new Error((await saveRes.json().catch(() => ({}))).error || 'Failed to save')

      const activeSite = sites.find(s => s.connectionId === connectionId)
      if (!activeSite) throw new Error('Selected connection not found — refresh and try again')

      const isBigCommerce = activeSite.connectorType === 'bigcommerce'
      const route = isBigCommerce
        ? `/api/admin/content/posts/${postId}/publish-bigcommerce`
        : `/api/admin/content/posts/${postId}/approve`
      const pushRes = await fetch(route, { method: 'POST' })
      if (!pushRes.ok) {
        const body = await pushRes.json().catch(() => ({ error: 'Push failed' }))
        throw new Error(body.error || `Push failed (${pushRes.status})`)
      }
      const pushData = await pushRes.json().catch(() => ({}))
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
      setError(err instanceof Error ? err.message : 'Retry failed')
    } finally {
      setRetrying(false)
    }
  }

  async function handleRegenerate() {
    if (!editNotes.trim()) { setError('Enter revision instructions first'); return }
    setRegenerating(true)
    setError('')
    onRegenerateStart?.()
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
      onRegenerateDone?.({ title: data.title ?? title })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate')
      onRegenerateError?.()
    } finally {
      setRegenerating(false)
    }
  }

  // Full-regenerate: picks a brand-new topic + keyword, generates fresh content.
  // Runs async in the background — the post status flips to 'generating' immediately.
  async function handleFullRegenerate() {
    setFullRegenerating(true)
    setError('')
    onRegenerateStart?.()
    try {
      const res = await fetch(`/api/admin/content/posts/${postId}/full-regenerate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ edit_notes: editNotes.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to start regeneration')
      // Reload post to pick up status='generating' for the polling effect
      const postRes = await fetch(`/api/admin/content/post?id=${postId}`)
      if (postRes.ok) setPost(await postRes.json())
      setShowEditDirection(false)
      setEditNotes('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start regeneration')
      onRegenerateError?.()
    } finally {
      setFullRegenerating(false)
    }
  }

  async function handleScanLinks() {
    setLinkScan('scanning')
    setShowBrokenLinks(false)
    try {
      const res = await fetch(`/api/admin/content/posts/${postId}/scan-links`, { method: 'POST' })
      if (!res.ok) throw new Error('Scan failed')
      const data = await res.json() as LinkScanResult
      setLinkScan(data)
    } catch {
      setLinkScan(null)
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
  const isBc = (connectionId ? sites.find(s => s.connectionId === connectionId) : null)?.connectorType === 'bigcommerce'

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
  </style></head><body>${featuredImageUrl ? `<img src="${featuredImageUrl.replace(/"/g, '&quot;')}" alt="" style="width:100%;border-radius:8px;margin-bottom:1.5rem" />` : ''}<h1>${title.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</h1>${content}</body></html>`

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
        width: 'min(1120px, 100vw)',
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
          {(topicBreakdown ?? fetchedBreakdown) && (
            <button type="button" onClick={() => setShowStrategy(v => !v)} className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}>
              Strategy {showStrategy ? '▴' : '▾'}
            </button>
          )}
          {isNarrow && (
            <button type="button" onClick={() => setShowPreview(true)} className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}>
              Preview
            </button>
          )}
          {isOnSite && !post?.wpPostId && !post?.bcPostId && (
            <button type="button" onClick={handleRetry} disabled={retrying} className="btn btn-primary" style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}>
              {retrying ? 'Pushing…' : 'Retry Push'}
            </button>
          )}
          <button type="button" onClick={onClose} className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }} aria-label="Close">
            ✕
          </button>
        </div>

        {/* Strategy context — collapsible header panel */}
        {!loading && showStrategy && (topicBreakdown ?? fetchedBreakdown) && (
          <div style={{ borderBottom: '1px solid var(--border)', padding: '0.75rem 1.25rem', maxHeight: 260, overflowY: 'auto', background: 'var(--bg-subtle)' }}>
            {(() => {
              const bd = topicBreakdown ?? fetchedBreakdown
              if (!bd) return null
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {([
                    { key: 'keyword_opportunity', label: 'Keyword Opportunity', color: '#2563eb', bg: '#eff6ff' },
                    { key: 'ranking_strategy',    label: 'Ranking Strategy',    color: '#7c3aed', bg: '#f5f3ff' },
                    { key: 'audience_intent',     label: 'Audience Intent',     color: '#059669', bg: '#ecfdf5' },
                    { key: 'why_now',             label: 'Why Now',             color: '#d97706', bg: '#fffbeb' },
                    { key: 'competition_level',   label: 'Competition',         color: '#dc2626', bg: '#fef2f2' },
                  ] as Array<{ key: keyof TopicBreakdown; label: string; color: string; bg: string }>).map(({ key, label, color, bg }) => {
                    const val = bd[key]
                    if (!val || typeof val !== 'string') return null
                    return (
                      <div key={key} style={{ borderRadius: 8, border: `1px solid ${color}30`, background: bg, padding: '0.625rem 0.875rem' }}>
                        <div style={{ fontSize: '0.6875rem', fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
                        <div style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', lineHeight: 1.6 }}>{val}</div>
                      </div>
                    )
                  })}
                  {bd.page_to_support && (
                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', padding: '0 0.25rem' }}>
                      <strong>Page to support:</strong>{' '}
                      <a href={bd.page_to_support} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>{bd.page_to_support}</a>
                    </div>
                  )}
                  {bd.competitors_researched && bd.competitors_researched.length > 0 && (
                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', padding: '0 0.25rem' }}>
                      <strong>Competitors researched:</strong>{' '}
                      {bd.competitors_researched.join(', ')}
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        )}

        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            {/* Left: live rendered preview (wide screens only) */}
            {!isNarrow && (
              <div style={{ flex: '1 1 55%', borderRight: '1px solid var(--border)', minWidth: 0, background: '#fff' }}>
                <iframe srcDoc={previewSrcdoc} title="Live preview" style={{ width: '100%', height: '100%', border: 'none' }} />
              </div>
            )}

            {/* Right: single-scroll collapsible edit column */}
            <div style={{ flex: isNarrow ? '1 1 100%' : '1 1 45%', overflowY: 'auto', padding: '1.25rem', minWidth: 0 }}>
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
                    <a href={`https://store-${post.bcStoreHash}.mybigcommerce.com/manage/content/blog`} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.8125rem', color: 'var(--blue)', fontWeight: 600 }}>
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

            {/* ── SECTION: Content ──────────────────────────────────────────── */}
            <CollapsibleSection title="Content" open={openSections.has('content')} onToggle={() => toggleSection('content')}>
              {/* H1 Title */}
              <div className="mb-4">
                <label style={labelStyle}>H1 Title</label>
                <input type="text" value={title} onChange={e => { setTitle(e.target.value); markDirty() }} style={inputStyle} placeholder="Post H1 title" />
              </div>

              {/* Content */}
              <div className="mb-4">
                <label style={labelStyle}>Content (HTML)</label>
                <textarea ref={contentTextareaRef} value={content} onChange={e => { setContent(e.target.value); markDirty() }} style={{ ...inputStyle, minHeight: 280, fontFamily: 'monospace', fontSize: '0.8125rem', resize: 'vertical' }} placeholder="<h2>Introduction</h2><p>…</p>" />
              </div>

              {/* Link scan trigger — always visible in content tab so users don't need to go to SEO Checklist */}
              <div style={{ marginBottom: 8, marginTop: -4, display: 'flex', alignItems: 'center', gap: 8 }}>
                {(linkScan === null || linkScan === 'scanning') ? (
                  <button
                    type="button"
                    onClick={handleScanLinks}
                    disabled={linkScan === 'scanning'}
                    style={{ fontSize: '0.72rem', padding: '3px 10px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, cursor: linkScan === 'scanning' ? 'default' : 'pointer', color: 'var(--text-muted)', opacity: linkScan === 'scanning' ? 0.65 : 1 }}
                  >
                    {linkScan === 'scanning' ? '⟳ Scanning links…' : '🔗 Scan for broken links'}
                  </button>
                ) : (
                  <span style={{ fontSize: '0.72rem', color: linkScan.links.some(l => !l.ok) ? '#dc2626' : '#16a34a' }}>
                    {linkScan.links.filter(l => !l.ok).length === 0
                      ? `✓ All ${linkScan.links.length} link${linkScan.links.length !== 1 ? 's' : ''} OK`
                      : `⚠ ${linkScan.links.filter(l => !l.ok).length} broken link${linkScan.links.filter(l => !l.ok).length !== 1 ? 's' : ''} — see below`}
                    <button type="button" onClick={handleScanLinks} style={{ marginLeft: 8, fontSize: '0.68rem', padding: '1px 6px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', color: 'var(--text-faint)' }}>re-scan</button>
                  </span>
                )}
              </div>

              {/* Broken links — inline panel below content HTML */}
              {linkScan !== null && linkScan !== 'scanning' && (() => {
                const broken = linkScan.links.filter(l => !l.ok)
                if (broken.length === 0) return null
                return (
                  <div className="mb-4" style={{ border: '1px solid #fca5a5', borderRadius: 6, background: '#fff1f2', padding: '0.625rem 0.75rem' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#dc2626', marginBottom: '0.375rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      🔗 {broken.length} broken link{broken.length !== 1 ? 's' : ''} — click to jump
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {broken.map((l, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ flex: 1, fontSize: '0.75rem', color: l.redirected ? '#b45309' : '#dc2626', wordBreak: 'break-all' }}>
                            {l.redirected ? '↪' : '✗'} {l.url}{l.status ? ` (${l.status})` : l.error ? ` (${l.error})` : ''}
                          </span>
                          <button
                            type="button"
                            onClick={() => jumpToLink(l.url)}
                            style={{ fontSize: '0.7rem', padding: '2px 7px', background: '#fff', border: '1px solid #fca5a5', borderRadius: 4, cursor: 'pointer', color: '#dc2626', flexShrink: 0, whiteSpace: 'nowrap' }}
                          >
                            Jump ↓
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}

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
            </CollapsibleSection>

            {/* ── SECTION: SEO & Meta ───────────────────────────────────────── */}
            <CollapsibleSection title="SEO & Meta" open={openSections.has('seo')} onToggle={() => toggleSection('seo')}>
              {/* SEO Title */}
              <div className="mb-4">
                <label style={labelStyle}>
                  SEO Title
                  <span style={{ fontWeight: 400, marginLeft: 6, color: seoTitle.length > 60 ? 'var(--amber, #f59e0b)' : seoTitle.length > 0 ? 'var(--green)' : 'var(--text-faint)' }}>
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

                {/* Link Health */}
                <div style={{ marginTop: '0.75rem', paddingTop: '0.625rem', borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-faint)' }}>LINK HEALTH</span>
                    {linkScan === null && (
                      <>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px' }}>Links: not scanned</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px' }}>Phones: not scanned</span>
                        <button onClick={() => void handleScanLinks()} style={{ marginLeft: 'auto', fontSize: '0.72rem', padding: '2px 8px', background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Scan Now</button>
                      </>
                    )}
                    {linkScan === 'scanning' && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>Scanning…</span>
                    )}
                    {linkScan !== null && linkScan !== 'scanning' && (() => {
                      const okLinks    = linkScan.links.filter(l => l.ok).length
                      const totalLinks = linkScan.links.length
                      const brokenLinks = linkScan.links.filter(l => !l.ok && !l.redirected)
                      const okPhones   = linkScan.phones.filter(p => p.valid).length
                      const totalPhones = linkScan.phones.length
                      const allLinksOk = brokenLinks.length === 0
                      return (
                        <>
                          <span
                            style={{ fontSize: '0.75rem', color: allLinksOk ? 'var(--green)' : 'var(--red)', background: 'var(--bg)', border: `1px solid ${allLinksOk ? 'var(--green)' : 'var(--red)'}`, borderRadius: 4, padding: '1px 6px', cursor: brokenLinks.length > 0 ? 'pointer' : 'default' }}
                            onClick={() => brokenLinks.length > 0 && setShowBrokenLinks(v => !v)}
                          >
                            Links: {okLinks}/{totalLinks} OK{brokenLinks.length > 0 ? ` (${brokenLinks.length} broken)` : ' ✓'}
                          </span>
                          <span style={{ fontSize: '0.75rem', color: okPhones === totalPhones ? 'var(--green)' : 'var(--amber)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px' }}>
                            Phones: {totalPhones === 0 ? 'none' : `${okPhones}/${totalPhones} valid`}
                          </span>
                          <button onClick={() => void handleScanLinks()} style={{ marginLeft: 'auto', fontSize: '0.72rem', padding: '2px 8px', background: 'var(--bg-subtle)', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer' }}>Rescan</button>
                        </>
                      )
                    })()}
                  </div>
                  {linkScan !== null && linkScan !== 'scanning' && showBrokenLinks && linkScan.links.filter(l => !l.ok).length > 0 && (
                    <div style={{ marginTop: '0.375rem', display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {linkScan.links.filter(l => !l.ok).map((l, i) => (
                        <div key={i} style={{ fontSize: '0.7rem', color: l.redirected ? 'var(--amber)' : 'var(--red)', wordBreak: 'break-all' }}>
                          {l.redirected ? '↪' : '✗'} {l.url}{l.status ? ` → ${l.status}` : l.error ? ` (${l.error})` : ''}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </CollapsibleSection>

            {/* ── SECTION: Publish ──────────────────────────────────────────── */}
            <CollapsibleSection title="Publish" open={openSections.has('publish')} onToggle={() => toggleSection('publish')}>
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
                  <label style={labelStyle}>{isBc ? 'Author Name' : 'WP Author'}</label>
                  {isBc ? (
                    <input
                      type="text"
                      value={bcAuthorName}
                      onChange={e => { setBcAuthorName(e.target.value); markDirty() }}
                      placeholder="Author name displayed on the post"
                      style={inputStyle}
                    />
                  ) : (
                    <select value={authorId ?? ''} onChange={e => { setAuthorId(e.target.value ? Number(e.target.value) : null); markDirty() }} style={inputStyle} disabled={authorsLoading}>
                      <option value="">{authorsLoading ? 'Loading…' : '— Default —'}</option>
                      {authors.map(a => (
                        <option key={a.id} value={a.id}>
                          {a.name}{a.id === defaultAuthorId ? ' (Default)' : ''}
                        </option>
                      ))}
                    </select>
                  )}
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

              {/* WP Categories */}
              {categories.length > 0 && (
                <div className="mb-4">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>WP Categories</label>
                    <button
                      type="button"
                      onClick={refreshCategories}
                      disabled={categoriesLoading}
                      style={{ fontSize: '0.6875rem', padding: '0.125rem 0.5rem', borderRadius: '0.25rem', border: '1px solid var(--border)', background: 'var(--surface)', cursor: categoriesLoading ? 'default' : 'pointer', color: 'var(--text-muted)', opacity: categoriesLoading ? 0.6 : 1 }}
                    >
                      {categoriesLoading ? '⟳ Refreshing…' : '↻ Refresh'}
                    </button>
                  </div>
                  {/* Auto-category suggestion — shown when no category is explicitly selected */}
                  {categorySuggestion && categoryIds.length === 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.375rem', fontSize: '0.75rem', padding: '0.25rem 0.5rem', borderRadius: '0.25rem', background: categorySuggestion.isNew ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.1)', border: `1px solid ${categorySuggestion.isNew ? 'rgba(245,158,11,0.3)' : 'rgba(16,185,129,0.3)'}` }}>
                      <span style={{ color: 'var(--text-muted)' }}>Auto:</span>
                      <strong>{categorySuggestion.name}</strong>
                      <span style={{ color: categorySuggestion.isNew ? '#f59e0b' : '#10b981' }}>
                        {categorySuggestion.isNew ? '(will create)' : '(existing)'}
                      </span>
                      {!categorySuggestion.isNew && categorySuggestion.id && (
                        <button
                          type="button"
                          onClick={() => { setCategoryIds([categorySuggestion.id!]); markDirty() }}
                          style={{ marginLeft: 'auto', fontSize: '0.6875rem', padding: '0.125rem 0.375rem', borderRadius: '0.25rem', border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}
                        >
                          Apply
                        </button>
                      )}
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', maxHeight: '8rem', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '0.375rem', padding: '0.375rem 0.5rem' }}>
                    {categories.map(c => {
                      const selected = categoryIds.includes(c.id)
                      return (
                        <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => {
                              setCategoryIds(cur => selected ? cur.filter(id => id !== c.id) : [...cur, c.id])
                              markDirty()
                            }}
                          />
                          {c.name}
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Regeneration */}
              <div className="mb-4">
                {post?.status === 'generating' ? (
                  <div style={{ padding: '0.75rem 1rem', background: 'var(--bg-subtle)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                    <span style={{ display: 'inline-block', animation: 'spin 1.2s linear infinite' }}>⟳</span>
                    Generating new topic and content — this takes about a minute…
                  </div>
                ) : (
                  <>
                    {showRegenConfirm ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '0.625rem 0.875rem', background: 'var(--bg-subtle)', borderRadius: 8, border: '1px solid var(--border)' }}>
                        <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', flex: 1 }}>
                          Picks a new topic and rewrites everything — can&apos;t be undone.
                        </span>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ fontSize: '0.8125rem' }}
                          disabled={fullRegenerating || regenerating}
                          onClick={() => { setShowRegenConfirm(false); handleFullRegenerate() }}
                        >
                          {fullRegenerating ? 'Queuing…' : 'Confirm regenerate'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          style={{ fontSize: '0.75rem' }}
                          onClick={() => setShowRegenConfirm(false)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ fontSize: '0.8125rem' }}
                          disabled={fullRegenerating || regenerating}
                          onClick={() => setShowRegenConfirm(true)}
                        >
                          {fullRegenerating ? 'Queuing…' : 'Regenerate Post'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          style={{ fontSize: '0.75rem', opacity: 0.65 }}
                          onClick={() => setShowEditDirection(v => !v)}
                        >
                          {showEditDirection ? 'Hide direction' : 'Add direction…'}
                        </button>
                      </div>
                    )}
                    {showEditDirection && (
                      <div style={{ marginTop: '0.5rem' }}>
                        <textarea
                          value={editNotes}
                          onChange={e => setEditNotes(e.target.value)}
                          rows={3}
                          style={{ ...inputStyle, resize: 'vertical', marginBottom: '0.5rem' }}
                          placeholder="e.g. Avoid motorcycle content, focus on car detailing instead…"
                          autoFocus
                        />
                        <div className="flex gap-2" style={{ marginBottom: '0.25rem' }}>
                          <button
                            type="button"
                            disabled={regenerating || fullRegenerating}
                            onClick={handleRegenerate}
                            className="btn btn-secondary"
                            style={{ fontSize: '0.8125rem' }}
                          >
                            {regenerating ? 'Rewriting…' : 'Rewrite with Notes'}
                          </button>
                        </div>
                        <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', margin: 0 }}>
                          "Regenerate Post" picks a fresh topic. "Rewrite with Notes" keeps the topic but rewrites using your direction above.
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </CollapsibleSection>
            </div>
          </div>
        )}

        {/* Footer actions */}
        {!loading && (
          onMonthlyApprove ? (
            <div style={{ padding: '0.875rem 1.25rem', borderTop: '1px solid var(--border)', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !isDirty}
                className="btn btn-secondary"
                style={{ fontSize: '0.8125rem', opacity: isDirty ? 1 : 0.5 }}
              >
                {saving ? 'Saving…' : savedFlash ? 'Saved ✓' : 'Save Changes'}
              </button>
              <div style={{ flex: 1 }} />
              {onMonthlyRegenerate && (
                <button
                  type="button"
                  title="Regenerate — picks a new topic and rewrites the post"
                  onClick={onMonthlyRegenerate}
                  className="btn btn-sm"
                  disabled={saving}
                  style={{ padding: '4px 8px', display: 'inline-flex', alignItems: 'center' }}
                >
                  <ArrowClockwise size={13} weight="bold" />
                </button>
              )}
              <button
                type="button"
                onClick={handleMonthlyDiscard}
                disabled={saving}
                className="btn btn-sm"
                style={{ background: '#7f1d1d', borderColor: '#7f1d1d', color: '#fff' }}
              >
                Discard
              </button>
              <button
                type="button"
                onClick={handleMonthlyApprove}
                disabled={saving}
                className="btn btn-sm btn-primary"
                style={{ background: saving ? undefined : '#16a34a', borderColor: '#16a34a' }}
              >
                {saving ? '…' : 'Approve →'}
              </button>
            </div>
          ) : (
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
          )
        )}
      </div>
    </>
  )
}
