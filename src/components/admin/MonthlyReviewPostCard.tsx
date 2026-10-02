'use client'

import { useState } from 'react'
import { ArrowClockwise, ArrowSquareOut, Article, CheckCircle, LinkBreak, Trash } from '@phosphor-icons/react'
import { SHOW_NON_BLOG_CONTENT_TYPES } from '@/lib/content/featureFlags'
import PostSiteLinks from '@/components/admin/PostSiteLinks'
import ClientImage from '@/components/admin/ClientImage'
import PriorityTag from '@/components/admin/PriorityTag'
import StatusBadge from '@/components/ui/StatusBadge'
import { ConfirmDialog } from '@/components/ui/Dialog'
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

const TYPE_LABEL: Record<string, string> = { blog: 'Blog', service_area: 'Service area page', service_page: 'Service page' }

export default function MonthlyReviewPostCard({
  post, isApproved, isRejected, isDiscarded, isRegenerating, isLoading, isCollapsed, brokenLinkCount, onApprove: _onApprove, onReject, onOpenEditor, onRestore, onRegenerate, onDelete,
  pushState, pushedUrl, pushError, onRetryPush,
}: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const name = post.title ?? 'this post'

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

  // The border and tint carry the state with the pill, rather than leaving a tinted card inside
  // a neutral outline — which read as though the tint were a hover effect rather than a decision
  // the reviewer had made. Regenerating is work in progress, so it takes the accent tint, not red.
  const tone = isRegenerating ? ' mr-card--working' : isApproved ? ' mr-card--approved' : isRejected || isDiscarded ? ' mr-card--out' : ''

  const regenerateButton = (
    <button
      type="button"
      className="btn btn-secondary btn-sm mr-icon"
      disabled={isLoading}
      title={isLive
        ? 'Regenerate: write a brand-new topic and article. The live copy stays up until you push the replacement.'
        : 'Regenerate: write a brand-new topic and article for this slot'}
      aria-label={`Regenerate ${name}`}
      onClick={() => onRegenerate(post.id)}
    >
      <ArrowClockwise size={15} weight="bold" aria-hidden />
    </button>
  )

  return (
    <article className={`mr-card${tone}`} aria-label={post.title ?? 'Untitled post'}>
      {/* Thumbnail */}
      {post.featured_image_url ? (
        // Through the proxy: when the picture came from the client's own media library the
        // URL points at their server, and their host is entitled to refuse us.
        <ClientImage src={post.featured_image_url} alt="" connectionId={post.connection_id} className="mr-thumb" />
      ) : (
        <span className="mr-thumb" aria-hidden><Article size={18} /></span>
      )}

      {/* Title + meta */}
      <div className="mr-body">
        <button type="button" className="mr-title" onClick={() => onOpenEditor(post.id)} title="Open the review panel">
          {post.title ?? 'Untitled post'}
        </button>
        <div className="mr-meta">
          {isApproved && (
            /* Sits with the meta rather than in the action row. As a pill on the right it
               competed with the controls and squeezed the title into an ellipsis; the
               approval is a property of the post, so it reads with the post's other
               properties. */
            <span className="mr-approved"><CheckCircle size={13} weight="fill" aria-hidden />Approved</span>
          )}
          <span className="mr-fact">{post.target_publish_date ? fmtDate(post.target_publish_date) : 'No date'}</span>
          {post.content && <span className="mr-fact">{wordCount(post.content).toLocaleString()} words</span>}
          <span className="mr-fact">{post.isBc ? 'BigCommerce' : 'WordPress'}</span>
          {SHOW_NON_BLOG_CONTENT_TYPES && post.content_type && (
            <StatusBadge tone={post.content_type === 'blog' ? 'neutral' : 'info'} dot={false}>{TYPE_LABEL[post.content_type] ?? 'Page'}</StatusBadge>
          )}
          {brokenLinkCount != null && brokenLinkCount > 0 && (
            <StatusBadge tone="danger" dot={false}>
              <LinkBreak size={12} weight="bold" aria-hidden />{brokenLinkCount} broken link{brokenLinkCount === 1 ? '' : 's'}
            </StatusBadge>
          )}
        </div>
        {/* Provenance — a post someone asked for through Priority topics, and the keyword it
            was written for. Otherwise it is indistinguishable from an automatic pick by the
            time it reaches review. */}
        {post.silo && (
          <div className="mr-extra">
            <PriorityTag setName={post.silo.name} keyword={post.silo_keyword?.keyword} />
          </div>
        )}
        {/* Live-post links — shown once the post is on-site. ONE viewing link, chosen by state:
            "Preview draft" on a published post previews a draft that no longer exists, and
            "View live" on a scheduled one points at a page that is not up yet. */}
        {(post.status === 'draft_saved' || post.status === 'published') && (
          <div className="mr-extra"><PostSiteLinks post={post} fontSize={11.5} /></div>
        )}

        {isStaleLive && (
          <p className="mr-stale">The site still shows the previous version. Push to update it.</p>
        )}
      </div>

      {/* Status / actions */}
      {isApproved ? (
        // Regenerate stays available AFTER approval on purpose: changing your
        // mind about a post you just approved is the common case, and the
        // button being absent here is why it looked like the feature was missing.
        <div className="mr-actions">
          {/* The badge reports the PUSH, not the approval. Approval reads in the meta line; what
              belongs here is the transient part — whether the article has reached the client's
              site yet — so nothing renders here once it has, apart from the link to it. */}
          {pushState === 'pushing' ? (
            <span className="mr-pushing" aria-live="polite"><StatusBadge tone="info">Pushing to site…</StatusBadge></span>
          ) : pushState === 'failed' ? (
            <>
              <span className="mr-status-fail" aria-live="polite">
                <StatusBadge tone="danger" title={pushError ?? undefined}>{pushError ? `Push failed: ${pushError}` : 'Push failed'}</StatusBadge>
              </span>
              {onRetryPush && (
                <button type="button" className="btn btn-secondary btn-sm" disabled={isLoading} onClick={() => onRetryPush(post.id)}>Retry</button>
              )}
            </>
          ) : pushState === 'live' ? (
            <span className="mr-landed" aria-live="polite"><StatusBadge tone="success">Live</StatusBadge></span>
          ) : null}

          {/* Appears the moment the push returns a permalink, so the article can be checked
              without leaving the list or reloading. */}
          {pushState === 'live' && pushedUrl && (
            <a href={pushedUrl} target="_blank" rel="noopener noreferrer" className="mr-live">
              View live<ArrowSquareOut size={12} weight="bold" aria-hidden />
            </a>
          )}
          {/* Same icon row as an unreviewed card, so the controls do not move or change shape
              when a post crosses into approved — only what they do changes. */}
          {regenerateButton}

          {/* Take it back down. Routed through onReject with discard, NOT onDelete: this post is
              on the client's site, so the question is what happens to the live article — which
              is what LivePostActionModal exists to ask. A plain delete here would drop our record
              and leave the article published. */}
          <button
            type="button"
            className="btn btn-secondary btn-sm mr-icon mr-icon--danger"
            disabled={isLoading}
            title={isLive ? 'Take down: remove this post from the site, or leave the article up' : 'Discard: take this post out of the plan'}
            aria-label={`Take down ${name}`}
            onClick={() => onReject(post.id, true)}
          >
            <Trash size={15} weight="bold" aria-hidden />
          </button>

          <button type="button" className="btn btn-secondary btn-sm" disabled={isLoading} onClick={() => onOpenEditor(post.id)}>
            Review
          </button>
        </div>
      ) : isRejected ? (
        <div className="mr-actions"><StatusBadge tone="danger">Rejected</StatusBadge></div>
      ) : isDiscarded ? (
        <div className="mr-actions">
          <StatusBadge tone="neutral">Discarded</StatusBadge>
          <button type="button" className="btn btn-secondary btn-sm" disabled={isLoading} onClick={() => onRestore(post.id)}>Restore</button>
        </div>
      ) : isRegenerating ? (
        <div className="mr-actions mr-pushing"><StatusBadge tone="info">Regenerating…</StatusBadge></div>
      ) : (
        <div className="mr-actions">
          {regenerateButton}

          {/* Delete is distinct from Reject. Reject keeps the post as an editorial signal so the
              topic is never suggested again; Delete removes the post and its topic so the subject
              becomes eligible again — for duplicates and mis-generations, where nothing about the
              subject was wrong. Unrecoverable, hence the confirm. */}
          {onDelete && (
            <button
              type="button"
              className="btn btn-secondary btn-sm mr-icon mr-icon--danger"
              disabled={isLoading}
              title="Delete permanently: frees the topic to be generated again"
              aria-label={`Delete ${name} permanently`}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash size={15} weight="bold" aria-hidden />
            </button>
          )}
          <button type="button" className="btn btn-secondary btn-sm" disabled={isLoading} onClick={() => onOpenEditor(post.id)}>
            Review
          </button>
        </div>
      )}

      {onDelete && (
        <ConfirmDialog
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          title="Delete this post and its topic?"
          confirmLabel="Delete permanently"
          tone="danger"
          onConfirm={() => { setConfirmDelete(false); onDelete(post.id) }}
        >
          <p>“{post.title ?? 'Untitled post'}” goes, and its subject can be generated again.</p>
          <p>To keep it from being suggested again, close this and reject the post instead.</p>
        </ConfirmDialog>
      )}
    </article>
  )
}
