'use client'

import { useEffect, useState, useCallback } from 'react'

export interface PostReviewItem {
  id:                  string
  clientId:            string
  clientName:          string
  title:               string | null
  content:             string | null
  featured_image_url:  string | null
  target_keyword:      string | null
  target_publish_date: string | null
  seo_title:           string | null
  meta_description:    string | null
  seo_score:           number | null
  status:              string
  admin_approved_at:   string | null
}

interface Props {
  posts:          PostReviewItem[]
  index:          number
  onClose:        () => void
  onApprove:      (postId: string) => void
  onReject:       (postId: string) => void
  onNavigate:     (newIndex: number) => void
  onOpenEditor:   (postId: string) => void
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function wordCount(html: string | null): number {
  if (!html) return 0
  const text = stripHtml(html)
  return text ? text.split(/\s+/).length : 0
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  })
}

type ActionState = 'idle' | 'loading' | 'done' | 'rejected'

export default function PostReviewModal({ posts, index, onClose, onApprove, onReject, onNavigate, onOpenEditor }: Props) {
  const [tab,         setTab]        = useState<'content' | 'seo'>('content')
  const [actionState, setActionState] = useState<ActionState>('idle')

  const post = posts[index]
  const hasPrev = index > 0
  const hasNext = index < posts.length - 1

  // Reset state when post changes
  useEffect(() => {
    setTab('content')
    setActionState('idle')
  }, [post?.id])

  const handleApprove = useCallback(async () => {
    if (!post || actionState === 'loading') return
    setActionState('loading')
    try {
      const res = await fetch(`/api/admin/content/posts/${post.id}/approve`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'approve_only' }),
      })
      if (!res.ok) throw new Error('Approve failed')
      setActionState('done')
      onApprove(post.id)
      // Auto-advance after 800ms
      setTimeout(() => {
        if (hasNext) { onNavigate(index + 1); setActionState('idle') }
        else onClose()
      }, 800)
    } catch {
      setActionState('idle')
    }
  }, [post, actionState, onApprove, hasNext, index, onNavigate, onClose])

  const handleReject = useCallback(async () => {
    if (!post || actionState === 'loading') return
    setActionState('loading')
    try {
      const res = await fetch(`/api/admin/content/posts/${post.id}/dismiss`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error('Reject failed')
      setActionState('rejected')
      onReject(post.id)
      setTimeout(() => {
        if (hasNext) { onNavigate(index + 1); setActionState('idle') }
        else onClose()
      }, 600)
    } catch {
      setActionState('idle')
    }
  }, [post, actionState, onReject, hasNext, index, onNavigate, onClose])

  // Keyboard shortcuts
  useEffect(() => {
    if (!post) return
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'Escape')      onClose()
      if (e.key === 'ArrowLeft'  && hasPrev) onNavigate(index - 1)
      if (e.key === 'ArrowRight' && hasNext) onNavigate(index + 1)
      if (e.key === 'a' || e.key === 'A')   handleApprove()
      if (e.key === 'r' || e.key === 'R')   handleReject()
      if (e.key === 'e' || e.key === 'E')   { onOpenEditor(post.id); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [post, hasPrev, hasNext, index, onClose, onNavigate, handleApprove, handleReject])

  if (!post) return null

  const wc = wordCount(post.content)

  // Approval state styles
  const isApproved = actionState === 'done' || post.admin_approved_at
  const isRejected = actionState === 'rejected'

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1200, backdropFilter: 'blur(2px)' }}
      />

      {/* Modal */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position:     'fixed',
          inset:        0,
          display:      'flex',
          alignItems:   'center',
          justifyContent: 'center',
          padding:      '1rem',
          zIndex:       1201,
          pointerEvents: 'none',
        }}
      >
        <div style={{
          background:   'var(--bg-surface, #fff)',
          borderRadius: 14,
          maxWidth:     860,
          width:        '100%',
          maxHeight:    '88vh',
          display:      'flex',
          flexDirection: 'column',
          boxShadow:    '0 24px 80px rgba(0,0,0,0.25)',
          borderTop:    `4px solid ${isApproved ? 'var(--green, #16a34a)' : isRejected ? 'var(--red, #dc2626)' : 'var(--blue, #2563eb)'}`,
          pointerEvents: 'auto',
        }}>

          {/* ── Header ───────────────────────────────────────────────────── */}
          <div style={{ padding: '1rem 1.25rem 0.875rem', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
              {/* Navigation */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  onClick={() => hasPrev && onNavigate(index - 1)}
                  disabled={!hasPrev}
                  style={{
                    background: 'var(--bg-subtle)', border: 'none', cursor: hasPrev ? 'pointer' : 'default',
                    opacity: hasPrev ? 1 : 0.3, padding: '4px 10px', borderRadius: 6, fontSize: '0.8125rem',
                    color: 'var(--text-muted)', lineHeight: 1,
                  }}
                >← Prev</button>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>
                  {index + 1} / {posts.length}
                </span>
                <button
                  onClick={() => hasNext && onNavigate(index + 1)}
                  disabled={!hasNext}
                  style={{
                    background: 'var(--bg-subtle)', border: 'none', cursor: hasNext ? 'pointer' : 'default',
                    opacity: hasNext ? 1 : 0.3, padding: '4px 10px', borderRadius: 6, fontSize: '0.8125rem',
                    color: 'var(--text-muted)', lineHeight: 1,
                  }}
                >Next →</button>
              </div>

              {/* Client + date */}
              <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>
                  {post.clientName}
                  {post.target_publish_date ? ` · ${fmtDate(post.target_publish_date)}` : ''}
                </span>
              </div>

              {/* Close */}
              <button
                onClick={onClose}
                style={{
                  background: 'var(--bg-subtle)', border: 'none', cursor: 'pointer',
                  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1rem', color: 'var(--text-faint)',
                }}
              >×</button>
            </div>

            {/* Title + meta */}
            <h2 style={{ margin: '0.625rem 0 0.375rem', fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.35 }}>
              {post.title ?? '(Untitled)'}
            </h2>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {post.target_keyword && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  <span style={{ color: 'var(--text-faint)' }}>Keyword </span>{post.target_keyword}
                </span>
              )}
              {wc > 0 && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {wc.toLocaleString()} words
                </span>
              )}
              {isApproved && (
                <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--green, #16a34a)', background: '#dcfce7', padding: '2px 8px', borderRadius: 999 }}>
                  ✓ Approved
                </span>
              )}
              {isRejected && (
                <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--red, #dc2626)', background: '#fee2e2', padding: '2px 8px', borderRadius: 999 }}>
                  ✗ Rejected
                </span>
              )}
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 2, marginTop: '0.875rem' }}>
              {(['content', 'seo'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  style={{
                    background: tab === t ? 'var(--blue, #2563eb)' : 'transparent',
                    color:      tab === t ? '#fff' : 'var(--text-muted)',
                    border:     'none',
                    cursor:     'pointer',
                    padding:    '4px 14px',
                    borderRadius: 6,
                    fontSize:   '0.8125rem',
                    fontWeight: tab === t ? 600 : 400,
                    textTransform: 'capitalize',
                  }}
                >
                  {t === 'seo' ? 'SEO' : 'Content'}
                </button>
              ))}
            </div>
          </div>

          {/* ── Body ─────────────────────────────────────────────────────── */}
          <div style={{ flex: 1, overflow: 'auto', padding: '1rem 1.25rem' }}>
            {tab === 'content' && (
              <>
                {/* Featured image */}
                {post.featured_image_url && (
                  <div style={{ marginBottom: '1rem' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={post.featured_image_url}
                      alt=""
                      style={{ width: '100%', maxHeight: 240, objectFit: 'cover', borderRadius: 8, display: 'block' }}
                    />
                  </div>
                )}

                {/* Content preview */}
                {post.content ? (
                  <div
                    dangerouslySetInnerHTML={{ __html: post.content }}
                    style={{
                      fontSize:   '0.875rem',
                      lineHeight: 1.7,
                      color:      'var(--text-secondary, var(--text-muted))',
                    }}
                  />
                ) : (
                  <p style={{ color: 'var(--text-faint)', fontStyle: 'italic', textAlign: 'center', padding: '2rem 0' }}>
                    No content generated yet.
                  </p>
                )}
              </>
            )}

            {tab === 'seo' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div>
                  <div style={{ fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-faint)', marginBottom: '0.375rem' }}>
                    SEO Title
                  </div>
                  <p style={{ margin: 0, fontSize: '0.9375rem', color: 'var(--text-primary)', fontWeight: 500 }}>
                    {post.seo_title ?? post.title ?? '—'}
                  </p>
                  {post.seo_title && (
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: 'var(--text-faint)' }}>
                      {post.seo_title.length} chars
                    </p>
                  )}
                </div>

                <div>
                  <div style={{ fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-faint)', marginBottom: '0.375rem' }}>
                    Meta Description
                  </div>
                  <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary, var(--text-muted))', lineHeight: 1.5 }}>
                    {post.meta_description ?? '—'}
                  </p>
                  {post.meta_description && (
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: post.meta_description.length > 160 ? 'var(--red, #dc2626)' : 'var(--text-faint)' }}>
                      {post.meta_description.length} chars {post.meta_description.length > 160 ? '(too long)' : ''}
                    </p>
                  )}
                </div>

                <div>
                  <div style={{ fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-faint)', marginBottom: '0.375rem' }}>
                    Focus Keyword
                  </div>
                  <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary, var(--text-muted))' }}>
                    {post.target_keyword ?? '—'}
                  </p>
                </div>

                {post.seo_score !== null && (
                  <div>
                    <div style={{ fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-faint)', marginBottom: '0.375rem' }}>
                      SEO Score
                    </div>
                    <p style={{
                      margin: 0, fontSize: '1.25rem', fontWeight: 700,
                      color: post.seo_score >= 80 ? 'var(--green, #16a34a)' : post.seo_score >= 60 ? 'var(--yellow, #d97706)' : 'var(--red, #dc2626)',
                    }}>
                      {post.seo_score}/100
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Footer ───────────────────────────────────────────────────── */}
          <div style={{
            padding:      '0.875rem 1.25rem',
            borderTop:    '1px solid var(--border)',
            display:      'flex',
            justifyContent: 'space-between',
            alignItems:   'center',
            gap:          '0.75rem',
          }}>
            <button
              onClick={() => { onOpenEditor(post.id); onClose() }}
              style={{
                background: 'var(--bg-subtle)', border: '1px solid var(--border)',
                cursor: 'pointer', padding: '7px 16px', borderRadius: 7,
                fontSize: '0.8125rem', color: 'var(--text-muted)', fontWeight: 500,
              }}
            >
              Open Editor
            </button>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={handleReject}
                disabled={actionState === 'loading' || isApproved}
                style={{
                  background: isRejected ? '#fee2e2' : 'var(--bg-subtle)',
                  border: `1px solid ${isRejected ? '#fca5a5' : 'var(--border)'}`,
                  cursor: actionState === 'loading' || isApproved ? 'default' : 'pointer',
                  opacity: isApproved ? 0.4 : 1,
                  padding: '7px 16px', borderRadius: 7,
                  fontSize: '0.8125rem', color: isRejected ? 'var(--red, #dc2626)' : 'var(--text-muted)', fontWeight: 500,
                }}
              >
                {isRejected ? 'Rejected' : 'Reject'}
              </button>

              <button
                onClick={handleApprove}
                disabled={actionState === 'loading' || isRejected || !!isApproved}
                style={{
                  background: isApproved ? 'var(--green, #16a34a)' : 'var(--blue, #2563eb)',
                  border: 'none',
                  cursor: actionState === 'loading' || isRejected || !!isApproved ? 'default' : 'pointer',
                  opacity: isRejected ? 0.4 : 1,
                  padding: '7px 20px', borderRadius: 7,
                  fontSize: '0.8125rem', color: '#fff', fontWeight: 600,
                }}
              >
                {actionState === 'loading' ? 'Saving…' : isApproved ? '✓ Approved' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      </div>

    </>
  )
}
