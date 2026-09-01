'use client'

import { SHOW_NON_BLOG_CONTENT_TYPES } from '@/lib/content/featureFlags'
import { viewLiveUrl, isPublicPermalink, wpDraftPreviewUrl, wpEditUrl, bcEditUrl } from '@/lib/content/postLinks'


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
  wp_post_id:          number | null
  wp_site_url:         string | null
  published_url:       string | null
  bc_post_id:          number | null
  bc_store_hash:       string | null
  isBc:                boolean
}

interface Props {
  post:             MonthlyReviewPost
  isApproved:       boolean
  isRejected:       boolean
  isDiscarded:      boolean
  isRegenerating:   boolean
  isLoading:        boolean
  isCollapsed:      boolean
  brokenLinkCount?: number
  onApprove:        (id: string) => void
  onReject:         (id: string, discard?: boolean) => void
  onOpenEditor:     (id: string) => void
  onRestore:        (id: string) => void
  onRegenerate:     (id: string) => void
  /** Optional: permanently delete the post AND its topic, freeing the subject to be
   *  generated again. Distinct from onReject, which keeps it as an editorial signal
   *  so the topic is never suggested again. */
  onDelete?:        (id: string) => void
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
  post, isApproved, isRejected, isDiscarded, isRegenerating, isLoading, isCollapsed, brokenLinkCount, onApprove, onReject, onOpenEditor, onRestore, onRegenerate, onDelete,
}: Props) {
  const isDone = isApproved || isRejected || isDiscarded || isRegenerating

  if (isCollapsed) {
    return null
  }

  return (
    <div
      style={{
        border:     `1px solid ${isRegenerating ? '#fca5a5' : 'var(--border)'}`,
        borderRadius: 8,
        overflow:   'hidden',
        background: isRegenerating ? '#fff1f2' : 'var(--bg-surface)',
        animation:  isApproved ? 'monthly-approve-flash 0.6s ease forwards' : undefined,
        opacity:    isRejected || isDiscarded ? 0.55 : 1,
        transition: 'opacity 0.3s, background 0.3s',
      }}
    >
      {/* Card row */}
      <div
        style={{
          display:    'flex',
          alignItems: 'center',
          gap:        12,
          padding:    '10px 14px',
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
            {SHOW_NON_BLOG_CONTENT_TYPES && post.content_type && (
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
            {brokenLinkCount != null && brokenLinkCount > 0 && (
              <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: '#fee2e2', color: '#dc2626' }}>
                🔗 {brokenLinkCount} broken
              </span>
            )}
          </div>
          {/* Live-post links — shown once the post is on-site */}
          {(post.status === 'draft_saved' || post.status === 'published') && (() => {
            const live = viewLiveUrl(post)
            const draft = wpDraftPreviewUrl(post)
            const wpe = wpEditUrl(post)
            const bce = bcEditUrl(post)
            const linkStyle: React.CSSProperties = { color: 'var(--blue)', textDecoration: 'none' }
            return (
              <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap', fontSize: 11 }}>
                {isPublicPermalink(live) && live && (
                  <a href={live} target="_blank" rel="noopener noreferrer" style={{ ...linkStyle, fontWeight: 600 }}>View live ↗</a>
                )}
                {draft && (
                  <a href={draft} target="_blank" rel="noopener noreferrer" title="Requires your WordPress login" style={{ ...linkStyle, color: 'var(--text-muted)' }}>Preview draft ↗</a>
                )}
                {wpe && (
                  <a href={wpe} target="_blank" rel="noopener noreferrer" style={{ ...linkStyle, color: 'var(--text-muted)' }}>Open in WP ↗</a>
                )}
                {bce && (
                  <a href={bce} target="_blank" rel="noopener noreferrer" style={{ ...linkStyle, color: 'var(--text-muted)' }}>Edit in BigCommerce ↗</a>
                )}
              </div>
            )
          })()}
        </div>

        {/* Status / actions */}
        {isApproved ? (
          <span style={{ fontSize: 12, fontWeight: 700, color: '#16a34a', background: '#dcfce7', padding: '3px 10px', borderRadius: 999, flexShrink: 0 }}>
            ✓ Approved
          </span>
        ) : isRejected ? (
          <span style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', background: '#fee2e2', padding: '3px 10px', borderRadius: 999, flexShrink: 0 }}>
            Rejected
          </span>
        ) : isDiscarded ? (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', background: 'var(--bg-subtle)', padding: '3px 10px', borderRadius: 999 }}>
              Discarded
            </span>
            <button className="btn btn-sm" disabled={isLoading} onClick={() => onRestore(post.id)}>
              Restore
            </button>
          </div>
        ) : isRegenerating ? (
          <span style={{ fontSize: 12, fontWeight: 700, color: '#b45309', background: '#fef3c7', padding: '3px 10px', borderRadius: 999, flexShrink: 0 }}>
            ⟳ Regenerating…
          </span>
        ) : (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
            {/* Delete is distinct from Reject. Reject keeps the post as an editorial
                signal so the topic is never suggested again; Delete removes the post
                and its topic so the subject becomes eligible again. Used for
                duplicates and mis-generations, where nothing about the subject was
                wrong. Destructive and unrecoverable, hence the confirm. */}
            {onDelete && (
              <button
                className="btn btn-sm"
                disabled={isLoading}
                title="Delete permanently — frees the topic to be generated again"
                aria-label={`Delete ${post.title ?? 'post'} permanently`}
                onClick={() => {
                  if (confirm('Delete this post and its topic permanently?\n\nThe subject becomes available to generate again. Use Reject instead if you do not want it suggested again.')) {
                    onDelete(post.id)
                  }
                }}
                style={{ color: '#dc2626' }}
              >
                Delete
              </button>
            )}
            <button
              className="btn btn-sm"
              disabled={isLoading}
              onClick={() => onOpenEditor(post.id)}
            >
              Review →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
