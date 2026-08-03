'use client'

import { useState } from 'react'

export interface MonthlyReviewPost {
  id:                  string
  client_id:           string
  clientName:          string
  title:               string | null
  content:             string | null
  seo_title:           string | null
  meta_description:    string | null
  featured_image_url:  string | null
  target_keyword:      string | null
  target_publish_date: string | null
  status:              string
  content_type:        string | null
  connection_id:       string | null
  admin_approved_at:   string | null
  isBc:                boolean
}

interface Props {
  post:            MonthlyReviewPost
  isApproved:      boolean
  isRejected:      boolean
  isDiscarded:     boolean
  isRegenerating:  boolean
  isLoading:       boolean
  isCollapsed:     boolean
  onApprove:       (id: string) => void
  onReject:        (id: string, discard?: boolean) => void
  onOpenEditor:    (id: string) => void
  onRestore:       (id: string) => void
}

function wordCount(html: string | null): number {
  if (!html) return 0
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().split(/\s+/).length
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  })
}

export default function MonthlyReviewPostCard({
  post, isApproved, isRejected, isDiscarded, isRegenerating, isLoading, isCollapsed, onApprove, onReject, onOpenEditor, onRestore,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const [tab,      setTab]      = useState<'content' | 'seo'>('content')

  const isDone = isApproved || isRejected || isDiscarded || isRegenerating

  if (isCollapsed) {
    return null
  }

  return (
    <div
      style={{
        border:        `1px solid ${isRegenerating ? '#fca5a5' : 'var(--border)'}`,
        borderRadius:  8,
        overflow:      'hidden',
        background:    isRegenerating ? '#fff1f2' : 'var(--bg-surface)',
        animation:     isApproved && !expanded ? 'monthly-approve-flash 0.6s ease forwards' : undefined,
        opacity:       isRejected || isDiscarded ? 0.55 : 1,
        transition:    'opacity 0.3s, background 0.3s',
      }}
    >
      {/* Collapsed row */}
      <div
        onClick={() => !isDone && setExpanded(e => !e)}
        style={{
          display:    'flex',
          alignItems: 'center',
          gap:        12,
          padding:    '10px 14px',
          cursor:     isDone ? 'default' : 'pointer',
          userSelect: 'none',
        }}
      >
        {/* Thumbnail */}
        {post.featured_image_url ? (
          <img
            src={post.featured_image_url}
            alt=""
            style={{ width: 48, height: 36, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
          />
        ) : (
          <div style={{ width: 48, height: 36, background: 'var(--bg-subtle)', borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: 'var(--text-faint)' }}>
            📝
          </div>
        )}

        {/* Title + meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 14, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {post.title ?? '(untitled)'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {post.target_publish_date ? fmtDate(post.target_publish_date) : 'No date'}
            {post.content ? ` · ${wordCount(post.content).toLocaleString()}w` : ''}
            {post.isBc ? ' · BC' : ' · WP'}
            {post.content_type && (
              <span style={{
                marginLeft: 6,
                fontSize: 10,
                fontWeight: 700,
                padding: '1px 6px',
                borderRadius: 999,
                background: post.content_type === 'blog' ? '#dbeafe' : post.content_type === 'service_area' ? '#dcfce7' : post.content_type === 'service_page' ? '#ede9fe' : '#f3f4f6',
                color:      post.content_type === 'blog' ? '#1d4ed8' : post.content_type === 'service_area' ? '#15803d' : post.content_type === 'service_page' ? '#7c3aed' : '#374151',
              }}>
                {post.content_type === 'blog' ? 'Blog' : post.content_type === 'service_area' ? 'SA Page' : post.content_type === 'service_page' ? 'Service Page' : 'Page'}
              </span>
            )}
          </div>
        </div>

        {/* Status / actions */}
        {isApproved ? (
          <span style={{ fontSize: 12, fontWeight: 700, color: '#16a34a', background: '#dcfce7', padding: '3px 10px', borderRadius: 999 }}>
            ✓ Approved
          </span>
        ) : isRejected ? (
          <span style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', background: '#fee2e2', padding: '3px 10px', borderRadius: 999 }}>
            Rejected
          </span>
        ) : isDiscarded ? (
          <div onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', background: 'var(--bg-subtle)', padding: '3px 10px', borderRadius: 999 }}>
              Discarded
            </span>
            <button
              className="btn btn-sm"
              disabled={isLoading}
              onClick={() => onRestore(post.id)}
            >
              Restore
            </button>
          </div>
        ) : isRegenerating ? (
          <span style={{ fontSize: 12, fontWeight: 700, color: '#b45309', background: '#fef3c7', padding: '3px 10px', borderRadius: 999 }}>
            ⟳ Regenerating…
          </span>
        ) : (
          <div onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button
              className="btn btn-sm"
              disabled={isLoading}
              onClick={() => onOpenEditor(post.id)}
              title="Open editor to review and edit this post"
            >
              Review
            </button>
            <button
              className="btn btn-sm"
              disabled={isLoading}
              onClick={() => onReject(post.id, true)}
              title="Permanently discard this post and its topic"
              style={{ background: '#7f1d1d', borderColor: '#7f1d1d', color: '#fff' }}
            >
              Discard
            </button>
            <button
              className="btn btn-sm btn-primary"
              disabled={isLoading}
              onClick={() => onApprove(post.id)}
              style={{ background: isLoading ? undefined : '#16a34a', borderColor: '#16a34a' }}
            >
              {isLoading ? '…' : 'Approve →'}
            </button>
          </div>
        )}

        {!isDone && (
          <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 4 }}>
            {expanded ? '▲' : '▼'}
          </span>
        )}
      </div>

      {/* Expanded area */}
      {expanded && !isDone && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {/* Featured image strip */}
          {post.featured_image_url && (
            <img
              src={post.featured_image_url}
              alt=""
              style={{ width: '100%', height: 180, objectFit: 'cover' }}
            />
          )}

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', padding: '0 14px' }}>
            {(['content', 'seo'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding:       '8px 14px',
                  fontSize:      13,
                  fontWeight:    tab === t ? 600 : 400,
                  color:         tab === t ? 'var(--blue)' : 'var(--text-muted)',
                  background:    'none',
                  border:        'none',
                  borderBottom:  tab === t ? '2px solid var(--blue)' : '2px solid transparent',
                  cursor:        'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ padding: 14, maxHeight: 360, overflowY: 'auto' }}>
            {tab === 'content' ? (
              <div
                style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text-secondary)' }}
                dangerouslySetInnerHTML={{ __html: post.content ?? '<em>No content</em>' }}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>SEO Title</div>
                  <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>{post.seo_title ?? post.title ?? '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Meta Description</div>
                  <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>{post.meta_description ?? '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Target Keyword</div>
                  <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>{post.target_keyword ?? '—'}</div>
                </div>
              </div>
            )}
          </div>

          {/* Action bar */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => { setExpanded(false); onOpenEditor(post.id) }}
            >
              Open Editor
            </button>
            <button
              className="btn btn-sm btn-danger"
              disabled={isLoading}
              onClick={() => { setExpanded(false); onReject(post.id, false) }}
              title="Reject this post and let the cron generate a replacement"
            >
              Regenerate
            </button>
            <button
              className="btn btn-sm"
              disabled={isLoading}
              onClick={() => { setExpanded(false); onReject(post.id, true) }}
              title="Permanently discard this post and its topic"
              style={{ background: '#7f1d1d', borderColor: '#7f1d1d', color: '#fff' }}
            >
              Discard
            </button>
            <button
              className="btn btn-sm btn-primary"
              disabled={isLoading}
              onClick={() => onApprove(post.id)}
              style={{ background: '#16a34a', borderColor: '#16a34a' }}
            >
              {isLoading ? 'Approving…' : 'Approve →'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
