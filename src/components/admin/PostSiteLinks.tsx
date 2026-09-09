'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The links to a post's copy on the client's site.
//
// This existed three times — the monthly review card, the calendar's PipelineCard, and the
// review drawer's On Site banner — and all three had the same two faults, because they were
// written by copying each other:
//
//   "View live" and "Preview draft" both rendered the moment a post reached the site, but a
//   post is either live or a draft, never both. Previewing "the draft" of a published article
//   describes something that no longer exists.
//
//   "Open in WP" sat beside them doing a third, different thing — opening the WordPress
//   editor — while being named after the site rather than the action, so it read as another
//   way to look at the post rather than the way to change it.
//
// One viewing link chosen by state, one editing link named for what it does. Rendering it
// from one component is the point: the next correction lands everywhere at once instead of in
// whichever copy someone happens to be looking at.
//
// The URL helpers already lived in lib/content/postLinks; only the presentation was
// duplicated.
// ─────────────────────────────────────────────────────────────────────────────

import {
  viewLiveUrl, wpDraftPreviewUrl, wpEditUrl, bcEditUrl, isPublicPermalink,
  type PostLinkInput,
} from '@/lib/content/postLinks'

interface Props {
  post: PostLinkInput
  /** Matches the host's type scale — 11px on cards, 13px in the drawer banner. */
  fontSize?: number
  /** Stop clicks reaching a clickable row behind the links. */
  stopPropagation?: boolean
  style?: React.CSSProperties
}

export default function PostSiteLinks({ post, fontSize = 11, stopPropagation, style }: Props) {
  const live  = viewLiveUrl(post)
  const draft = wpDraftPreviewUrl(post)
  const wpe   = wpEditUrl(post)
  const bce   = bcEditUrl(post)

  const isLive = isPublicPermalink(live) && !!live
  const base: React.CSSProperties = { color: 'var(--blue)', textDecoration: 'none' }

  if (!isLive && !draft && !wpe && !bce) return null

  return (
    <div
      onClick={stopPropagation ? e => e.stopPropagation() : undefined}
      style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize, ...style }}
    >
      {/* ONE viewing link. Live wins when there is a public URL; the draft preview is the
          fallback for a post that is on the site but not yet visible to anyone. */}
      {isLive ? (
        <a href={live!} target="_blank" rel="noopener noreferrer" style={{ ...base, fontWeight: 600 }}>
          View live ↗
        </a>
      ) : draft ? (
        <a
          href={draft} target="_blank" rel="noopener noreferrer"
          title="Opens the draft on the client's WordPress site — requires your WordPress login"
          style={{ ...base, fontWeight: 600 }}
        >
          Preview ↗
        </a>
      ) : null}

      {/* Named for the action, not the destination. */}
      {wpe && (
        <a href={wpe} target="_blank" rel="noopener noreferrer" style={{ ...base, color: 'var(--text-muted)' }}>
          Edit post ↗
        </a>
      )}
      {bce && (
        <a href={bce} target="_blank" rel="noopener noreferrer" style={{ ...base, color: 'var(--text-muted)' }}>
          Edit in BigCommerce ↗
        </a>
      )}
    </div>
  )
}
