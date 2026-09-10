'use client'

import { ArrowClockwise, ArrowRight, Trash } from '@phosphor-icons/react'
import { SHOW_NON_BLOG_CONTENT_TYPES } from '@/lib/content/featureFlags'
import PostSiteLinks from '@/components/admin/PostSiteLinks'
import type { QualityReport } from '@/lib/content/qualityGate'


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
  /** Set when the CMS copy was last written. See migration 200. */
  last_pushed_at?:     string | null
  /** Pre-publish quality gate result. See src/lib/content/qualityGate.ts. */
  quality_report?:     QualityReport | null
  /** Silo provenance — which keyword set produced this, on which term. */
  silo?:               { id: string; name: string } | null
  silo_keyword?:       { id: string; keyword: string } | null
  /** Maintained by trg_content_posts_updated_at. */
  updated_at?:         string | null
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
  /**
   * Where this post is in the push to the client's site.
   *
   * Approve is optimistic — the card flips instantly so the reviewer keeps moving — but the
   * push itself takes a second or two against a live WordPress or BigCommerce site, and it
   * can fail. Without this the card claimed "Approved" while the article was still in
   * flight, and a failed push looked identical to a successful one.
   * undefined = not started, which is every card until it is approved.
   */
  pushState?:       'pushing' | 'live' | 'failed'
  /** Public permalink, once the push returns one. */
  pushedUrl?:       string | null
  /** Why the push failed, taken from the server rather than guessed. */
  pushError?:       string | null
  onRetryPush?:     (id: string) => void
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
  pushState, pushedUrl, pushError, onRetryPush,
}: Props) {
  const isDone = isApproved || isRejected || isDiscarded || isRegenerating

  // "Live, but the client's site is serving an older copy." Derived rather than
  // stored, so it is correct the moment content changes. See migration 200.
  const isLive = Boolean(post.wp_post_id || post.bc_post_id)
  const isStaleLive =
    isLive &&
    !!post.updated_at &&
    !!post.last_pushed_at &&
    new Date(post.updated_at).getTime() > new Date(post.last_pushed_at).getTime()

  if (isCollapsed) {
    return null
  }

  return (
    <div
      style={{
        // The border carries the state with the background, rather than leaving a
        // green-tinted card inside a neutral grey outline — which read as though the tint
        // were a hover effect rather than a decision the reviewer had made. Regenerating
        // already did this; approved did not.
        border:     `1px solid ${
          isRegenerating ? '#fca5a5'
          : isApproved   ? '#86efac'
          : 'var(--border)'
        }`,
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
          <button
            type="button"
            onClick={() => onOpenEditor(post.id)}
            title="Open the review panel"
            style={{
              display: 'block', width: '100%', textAlign: 'left', padding: 0,
              background: 'none', border: 'none', cursor: 'pointer',
              fontWeight: 500, fontSize: 14, color: 'var(--text-primary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {post.title ?? '(untitled)'}
          </button>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {isApproved && (
              /* Sits with the meta rather than in the action row. As a pill on the right it
                 competed with the controls and squeezed the title into an ellipsis; the
                 approval is a property of the post, so it reads with the post's other
                 properties. */
              <span style={{ color: '#16a34a', fontWeight: 700, marginRight: 6 }}>
                ✓ Approved ·
              </span>
            )}
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
          {/* Silo provenance — which keyword set this came out of, and the term
              it consumed. Otherwise a silo-driven post is indistinguishable from
              an ad-hoc one by the time it reaches review. */}
          {post.silo && (
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              <span style={{
                background: 'rgba(139,92,246,0.12)', color: '#8b5cf6',
                border: '1px solid rgba(139,92,246,0.28)',
                padding: '0 5px', borderRadius: 3, fontWeight: 600,
              }}>
                silo: {post.silo.name}
              </span>
              {post.silo_keyword && <span>from &ldquo;{post.silo_keyword.keyword}&rdquo;</span>}
            </div>
          )}
          {/* Live-post links — shown once the post is on-site */}
          {(post.status === 'draft_saved' || post.status === 'published') && (() => {
            return (
              <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap', fontSize: 11 }}>
                {/* ONE viewing link, chosen by state. All three used to render together the
                    moment a post was on-site, but each is only meaningful in one state:
                    "Preview draft" on a published post previews a draft that no longer
                    exists, and "View live" on a scheduled one points at a page that is not
                    up yet. Whichever applies is shown; the other was never useful. */}
                <PostSiteLinks post={post} fontSize={11} />
              </div>
            )
          })()}

          {isStaleLive && (
            <div style={{
              marginTop: 6, padding: '4px 8px', borderRadius: 5,
              background: '#fef3c7', border: '1px solid #fcd34d',
              fontSize: 11.5, color: '#92400e', fontWeight: 600,
            }}>
              Live copy is out of date — the site still shows the previous version. Push to update it.
            </div>
          )}

          {/* The human check that the spam-update reporting singled out as
              protective. Shown before approval, with the reason, not just a score. */}
          {/* compact: a PASS renders nothing at all. A full-width green "Quality checks
              passed" bar under every clean post is the most prominent element on the card
              while carrying the least information — and it pushed the real controls down.
              Findings still surface here; the detail lives in the review drawer. */}

        </div>

        {/* Status / actions */}
        {isApproved ? (
          // Regenerate stays available AFTER approval on purpose: changing your
          // mind about a post you just approved is the common case, and the
          // button being absent here is why it looked like the feature was missing.
          <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
            {/* The badge reports the PUSH, not the approval.
                Approval is a settled property of the post and reads in the meta line under
                the title; repeating it here as a pill was what crowded the action row and
                squeezed titles into an ellipsis in the first place. What belongs in the
                action row is the transient part — whether the article has actually reached
                the client's site yet — so nothing renders here once it has. */}
            {pushState === 'pushing' ? (
              <span
                className="monthly-pushing"
                aria-live="polite"
                style={{
                  fontSize: 12, fontWeight: 700, color: '#1d4ed8', background: '#dbeafe',
                  padding: '3px 10px', borderRadius: 999,
                  animation: 'monthly-push-pulse 1.1s ease-in-out infinite',
                }}
              >
                Pushing to site…
              </span>
            ) : pushState === 'failed' ? (
              <>
                <span
                  title={pushError ?? undefined}
                  aria-live="polite"
                  style={{
                    fontSize: 12, fontWeight: 700, color: '#b91c1c', background: '#fee2e2',
                    padding: '3px 10px', borderRadius: 999, maxWidth: 260,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                >
                  {pushError ? 'Push failed — ' + pushError : 'Push failed'}
                </span>
                {onRetryPush && (
                  <button className="btn btn-sm" disabled={isLoading} onClick={() => onRetryPush(post.id)}>
                    Retry
                  </button>
                )}
              </>
            ) : pushState === 'live' ? (
              <span
                className="monthly-live"
                aria-live="polite"
                style={{
                  fontSize: 12, fontWeight: 700, color: '#16a34a', background: '#dcfce7',
                  padding: '3px 10px', borderRadius: 999,
                  animation: 'monthly-live-pop 0.32s ease-out',
                }}
              >
                ● Live
              </span>
            ) : null}

            {/* Appears the moment the push returns a permalink, so the article can be checked
                without leaving the list or reloading. */}
            {pushState === 'live' && pushedUrl && (
              <a
                href={pushedUrl} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 12, fontWeight: 600, color: 'var(--blue)', textDecoration: 'none' }}
              >
                View live ↗
              </a>
            )}
            {/* Same icon row as an unreviewed card, so the controls do not move or change
                shape when a post crosses into approved — only what they do changes. Approval
                is not the end of the reviewer's relationship with a post: the common next
                actions are re-reading it, replacing it, or taking it back down. */}
            <button
              className="btn btn-sm"
              disabled={isLoading}
              title={isLive
                ? 'Regenerate — write a brand-new topic and article. The live copy stays up until you push the replacement.'
                : 'Regenerate — write a brand-new topic and article for this slot'}
              aria-label={`Regenerate ${post.title ?? 'this post'}`}
              onClick={() => onRegenerate(post.id)}
              style={{ display: 'flex', alignItems: 'center', padding: '0.25rem 0.5rem' }}
            >
              <ArrowClockwise size={15} weight="bold" />
            </button>

            {/* Take it back down. Routed through onReject with discard, NOT onDelete: this
                post is on the client's site, so the question is what happens to the live
                article — which is what LivePostActionModal exists to ask. A plain delete
                here would drop our record and leave the article published. */}
            <button
              className="btn btn-sm"
              disabled={isLoading}
              title={isLive
                ? 'Take down — remove this post from the site, or leave the article up'
                : 'Discard — take this post out of the plan'}
              aria-label={`Take down ${post.title ?? 'this post'}`}
              onClick={() => onReject(post.id, true)}
              style={{ display: 'flex', alignItems: 'center', padding: '0.25rem 0.5rem', color: 'var(--red)' }}
            >
              <Trash size={15} weight="bold" />
            </button>

            <button
              className="btn btn-sm"
              disabled={isLoading}
              title="Review — read the content, SEO and strategy behind this post"
              aria-label={`Review ${post.title ?? 'this post'}`}
              onClick={() => onOpenEditor(post.id)}
              style={{ display: 'flex', alignItems: 'center', padding: '0.25rem 0.5rem' }}
            >
              <ArrowRight size={15} weight="bold" />
            </button>
          </div>
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
            {/* Icon-only, with the meaning in the tooltip and aria-label. Three text
                buttons plus "Review →" crowded the row and pushed the card wider than
                its content needed. */}
            <button
              className="btn btn-sm"
              disabled={isLoading}
              title="Regenerate — write a brand-new topic and article for this slot"
              aria-label={`Regenerate ${post.title ?? 'this post'}`}
              onClick={() => onRegenerate(post.id)}
              style={{ display: 'flex', alignItems: 'center', padding: '0.25rem 0.5rem' }}
            >
              <ArrowClockwise size={15} weight="bold" />
            </button>

            {/* Delete is distinct from Reject. Reject keeps the post as an editorial
                signal so the topic is never suggested again; Delete removes the post
                and its topic so the subject becomes eligible again — for duplicates and
                mis-generations, where nothing about the subject was wrong. Unrecoverable,
                hence the confirm. */}
            {onDelete && (
              <button
                className="btn btn-sm"
                disabled={isLoading}
                title="Delete permanently — frees the topic to be generated again"
                aria-label={`Delete ${post.title ?? 'post'} permanently`}
                onClick={() => {
                  if (confirm(`Delete "${post.title ?? 'this post'}" and its topic permanently?\n\nThe subject becomes available to generate again.\n\nUse Reject instead if you do not want it suggested again.`)) {
                    onDelete(post.id)
                  }
                }}
                style={{ display: 'flex', alignItems: 'center', padding: '0.25rem 0.5rem', color: '#dc2626' }}
              >
                <Trash size={15} weight="bold" />
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
