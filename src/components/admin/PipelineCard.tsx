'use client'

// Per-client pipeline card — the card/review presentation of a single pipeline
// item (a topic slot or a generated post), styled after MonthlyReviewPostCard.
// Purely presentational: ClientPipeline owns all state and passes callbacks.
// Styles: styles/admin/pipeline.css (.pl-*).

import '@/styles/admin/pipeline.css'
import { Check, X, PencilSimple, ArrowClockwise, Play, Trash, Article, CaretDown, ArrowUp, ArrowDown, WarningCircle } from '@phosphor-icons/react'
import StatusBadge, { type StatusTone } from '@/components/ui/StatusBadge'
import PostSiteLinks from '@/components/admin/PostSiteLinks'
import ClientImage from '@/components/admin/ClientImage'
import PriorityTag from '@/components/admin/PriorityTag'
import type { SeoScore } from '@/lib/content/types'

// ── Shared pipeline types (imported by ClientPipeline) ──────────────────────────
export interface Topic {
  id:                    string
  topic:                 string
  target_keyword:        string | null
  status:                string
  target_publish_date:   string | null
  rationale:             string | null
  competition_level:     string | null
  search_intent:         string | null
  keyword_opportunity:   string | null
  ranking_strategy:      string | null
  audience_intent:       string | null
  why_now:               string | null
  search_volume:         number | null
  keyword_difficulty:    number | null
  seo_brief:             Record<string, unknown> | null
  cannibalization_warning?: string | null
  page_to_support?:      string | null
  competitors_researched?: { keyword: string; urls: string[]; headings: Record<string, string[]> } | null
  edit_notes?:           string | null
  cluster_group?:        string | null
  generation_error?:     string | null
  post?:                 { id: string; title: string | null; status: string; published_url: string | null } | null
  created_at?:           string
  /** Silo provenance — which set this topic came out of, and on which keyword. */
  silo?:                 { id: string; name: string; hub_page_url: string | null } | null
  silo_keyword?:         { id: string; keyword: string } | null
}

export interface Post {
  id:                  string
  /**
   * The strong link back to content_topics. Populated on ~29% of rows, but when present it is
   * exact — unlike the keyword+date guess the calendar falls back to, which regeneration
   * invalidates by design.
   */
  topic_id?:           string | null
  title:               string | null
  seo_title:           string | null
  target_keyword:      string | null
  status:              string
  target_publish_date: string | null
  word_count:          number | null
  featured_image_url:  string | null
  wp_post_id:          number | null
  wp_site_url:         string | null
  bc_post_id:          number | null
  bc_store_hash:       string | null
  published_url:       string | null
  seo_score:           SeoScore | null
  keyword_rank?:       { current_position: number | null; previous_position: number | null; position_delta: number | null; movement?: string } | null
  generated_at:        string
  /** Which set of priority topics this post was written for, and on which keyword. */
  silo?:               { id: string; name: string } | null
  silo_keyword?:       { id: string; keyword: string } | null
}

export type RowItem =
  | { kind: 'topic'; data: Topic }
  | { kind: 'post';  data: Post }

export type DisplayStatus = 'pending' | 'approved' | 'generating' | 'generated' | 'published' | 'rejected'

// Amber needs someone, blue is on its way, green is on the site. "Ready to review" was green,
// which read as done when it is the one state waiting on a person.
export const DISPLAY_STATUS_CONFIG: Record<DisplayStatus, { label: string; tone: StatusTone }> = {
  pending:    { label: 'Pending',         tone: 'warning' },
  approved:   { label: 'Approved',        tone: 'info'    },
  generating: { label: 'Generating',      tone: 'info'    },
  generated:  { label: 'Ready to review', tone: 'warning' },
  published:  { label: 'Live',            tone: 'success' },
  rejected:   { label: 'Rejected',        tone: 'danger'  },
}

export function getTopicDisplayStatus(t: Topic): DisplayStatus {
  if (t.status === 'rejected')   return 'rejected'
  if (t.status === 'generating') return 'generating'
  if (t.status === 'approved')   return 'approved'
  if (t.status === 'generated')  return 'generated'
  return 'pending'
}

export function getPostDisplayStatus(p: Post): DisplayStatus {
  if (p.status === 'rejected')                                return 'rejected'
  if (p.status === 'generating')                              return 'generating'
  if (p.status === 'for_review')                              return 'generated'
  if (p.status === 'draft_saved' || p.status === 'published') return 'published'
  return 'generated'
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function scoreClass(s: SeoScore | null): string {
  if (!s) return ''
  if (s.overall >= 80) return 'pl-good'
  if (s.overall >= 60) return 'pl-ok'
  return 'pl-bad'
}

// Keyword rank: top 3 good, top 10 close, else plain.
function rankClass(pos: number): string {
  if (pos <= 3)  return 'pl-good'
  if (pos <= 10) return 'pl-ok'
  return ''
}

export function StatusPill({ status, generating }: { status: DisplayStatus; generating?: boolean }) {
  const cfg = DISPLAY_STATUS_CONFIG[status]
  return (
    <span className={generating ? 'pl-generating' : undefined} style={{ flexShrink: 0 }}>
      <StatusBadge tone={cfg.tone}>{cfg.label}</StatusBadge>
    </span>
  )
}

// ── Icon action button ──────────────────────────────────────────────────────────
// The label is the name (aria-label) and the tooltip; the tint only echoes it.
type IconTone = 'go' | 'ok' | 'warn' | 'danger' | 'quiet'
function IconBtn({ label, tone, disabled, onClick, children }: { label: string; tone: IconTone; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={`btn btn-secondary btn-sm pl-icon pl-icon--${tone}`} aria-label={label} title={label} disabled={disabled}
      onClick={e => { e.stopPropagation(); onClick() }}>
      {children}
    </button>
  )
}

interface Props {
  item:        RowItem
  linkedPost:  Post | null
  /** The client's content connection — authorises the image proxy for their own media. */
  connectionId?: string | null
  expanded:    boolean
  editing:     boolean
  editTitle:   string
  editNotes:   string
  loading:     boolean
  purging:     boolean
  onToggleExpand: () => void
  onReview:    (p: Post) => void
  onGenerate:  (topicId: string) => void
  onApprove:   (topicId: string) => void
  onReject:    (topicId: string) => void
  onRegenerateTopic: (topicId: string) => void
  onRetry:     (topicId: string) => void
  onOpenEdit:  (t: Topic) => void
  onEditTitleChange: (v: string) => void
  onEditNotesChange: (v: string) => void
  onSaveEdit:  (topicId: string) => void
  onCancelEdit: () => void
  onPurge:     (kind: 'topic' | 'post', id: string) => void
}

// connectionId routes a client-hosted picture through our image proxy — their server is
// entitled to refuse a direct browser fetch, and on a calendar that shows as a grid of
// broken thumbnails.
function Thumb({ url, connectionId }: { url: string | null; connectionId?: string | null }) {
  return url
    ? <ClientImage src={url} alt="" connectionId={connectionId} loading="lazy" className="pl-thumb" />
    : <span className="pl-thumb" aria-hidden><Article size={17} /></span>
}

// Compact live/edit link row for on-site posts.
function LiveLinks({ post }: { post: Post }) {
  return (
    <div className="pl-extra">
      <PostSiteLinks post={post} fontSize={11.5} />
    </div>
  )
}

export default function PipelineCard(props: Props) {
  const { item, linkedPost, expanded, editing, editTitle, editNotes, loading, purging } = props

  // Resolve the review-able post: an orphan post row, or a topic's ready post.
  const post: Post | null = item.kind === 'post'
    ? item.data
    : (linkedPost && ['for_review', 'generated', 'draft_saved', 'published'].includes(linkedPost.status) ? linkedPost : null)

  // ── Review card ──────────────────────────────────────────────────────────────
  if (post) {
    const topic = item.kind === 'topic' ? item.data : null
    const ds = getPostDisplayStatus(post)
    const onSite = post.status === 'draft_saved' || post.status === 'published'
    // Where it came from: the post's own record, else the topic it was written from. This card
    // used to show nothing, so "Priority" vanished the moment the article existed.
    const fromSet     = post.silo ?? topic?.silo ?? null
    const fromKeyword = post.silo_keyword ?? topic?.silo_keyword ?? null
    return (
      <article className="pl-card" aria-label={post.title ?? topic?.topic ?? 'Post being written'}>
        <Thumb url={post.featured_image_url} connectionId={props.connectionId} />
        <div className="pl-body">
          <button type="button" className="pl-title" onClick={e => { e.stopPropagation(); props.onReview(post) }} title="Open the review panel">
            {post.title ?? topic?.topic ?? 'Being written…'}
          </button>
          <div className="pl-facts">
            <span className="pl-fact">{fmtDate(post.target_publish_date)}</span>
            {post.word_count ? <span className="pl-fact">{post.word_count.toLocaleString()} words</span> : null}
            {post.bc_post_id ? <span className="pl-fact">BigCommerce</span> : post.wp_post_id ? <span className="pl-fact">WordPress</span> : null}
            {post.seo_score ? <span className={`pl-fact ${scoreClass(post.seo_score)}`}>SEO {post.seo_score.overall}</span> : null}
            {post.keyword_rank?.current_position != null ? (
              <span className={`pl-fact pl-rank ${rankClass(post.keyword_rank.current_position)}`} title="Current keyword rank (DataForSEO)">
                Rank {post.keyword_rank.current_position}
                {post.keyword_rank.position_delta ? (post.keyword_rank.position_delta > 0
                  ? <ArrowUp size={11} weight="bold" aria-label="up" />
                  : <ArrowDown size={11} weight="bold" aria-label="down" />) : null}
              </span>
            ) : post.keyword_rank?.movement === 'dropped' ? (
              <span className="pl-fact pl-rank pl-bad"
                title={`Dropped out of the tracked results${post.keyword_rank.previous_position != null ? ` (was #${post.keyword_rank.previous_position})` : ''}`}>
                <WarningCircle size={12} weight="fill" aria-hidden />Dropped out
              </span>
            ) : null}
          </div>
          {fromSet && (
            <div className="pl-extra">
              <PriorityTag setName={fromSet.name} keyword={fromKeyword?.keyword} size="sm" />
            </div>
          )}
          {onSite && <LiveLinks post={post} />}
        </div>
        <div className="pl-actions">
          <StatusPill status={ds} />
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => props.onReview(post)}>
            {post.status === 'draft_saved' || post.status === 'published' ? 'Edit' : 'Review'}
          </button>
          <IconBtn label="Delete permanently" tone="quiet" disabled={purging}
            onClick={() => props.onPurge(item.kind === 'topic' ? 'topic' : 'post', item.kind === 'topic' ? (topic as Topic).id : post.id)}>
            <Trash size={14} />
          </IconBtn>
        </div>
      </article>
    )
  }

  // ── Slot card (topic without a ready post) ──────────────────────────────────
  const t = (item as { kind: 'topic'; data: Topic }).data
  const ds = getTopicDisplayStatus(t)
  const hasError = !!t.generation_error && !['rejected', 'generated'].includes(t.status)
  const hasDetail = !!(t.keyword_opportunity || t.ranking_strategy || t.audience_intent || t.why_now || t.competition_level || t.page_to_support || t.competitors_researched)

  return (
    <article className={`pl-card pl-card--slot${hasError ? ' pl-card--error' : ''}`} aria-label={t.topic}>
      <div className="pl-row pl-row--slot">
        <div className="pl-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <StatusPill status={ds} generating={t.status === 'generating'} />
            {hasError && (
              <span className="pl-error-icon" title={t.generation_error ?? ''}>
                <WarningCircle size={15} weight="fill" aria-hidden /><span className="sr-only">Writing failed: {t.generation_error}</span>
              </span>
            )}
          </div>
          {hasDetail ? (
            <button type="button" className="pl-title" style={{ marginTop: 4 }} aria-expanded={expanded} onClick={() => { if (!editing) props.onToggleExpand() }}>
              {t.topic}<CaretDown size={11} weight="bold" aria-hidden />
            </button>
          ) : (
            <p className="pl-title pl-title--plain" style={{ marginTop: 4 }}>{t.topic}</p>
          )}
          {t.target_keyword && (
            <div className="pl-keyword">
              {t.target_keyword}
              {t.cluster_group && <span className="pl-cluster">{t.cluster_group}</span>}
            </div>
          )}
          {/* Where this topic came from: which set of priority topics, and the exact keyword it
              used. Without this, a priority topic is indistinguishable from an ad-hoc one once it
              reaches the queue. */}
          {t.silo && (
            <div className="pl-extra">
              <PriorityTag setName={t.silo.name} keyword={t.silo_keyword?.keyword} size="sm" />
            </div>
          )}
        </div>
        <div className="pl-date">{fmtDate(t.target_publish_date)}</div>
        <div className="pl-actions">
          {hasError && (
            <IconBtn label="Try writing it again" tone="warn" disabled={loading} onClick={() => props.onRetry(t.id)}><ArrowClockwise size={14} weight="bold" /></IconBtn>
          )}
          {t.status === 'approved' && (
            <IconBtn label="Write the post now" tone="go" onClick={() => props.onGenerate(t.id)}><Play size={14} weight="fill" /></IconBtn>
          )}
          {!['approved', 'generating', 'generated'].includes(t.status) && (
            <IconBtn label="Approve topic" tone="ok" disabled={loading} onClick={() => props.onApprove(t.id)}><Check size={14} weight="bold" /></IconBtn>
          )}
          {!['generating', 'generated', 'rejected'].includes(t.status) && (
            <IconBtn label={editing ? 'Stop editing' : 'Edit title'} tone="quiet" onClick={() => editing ? props.onCancelEdit() : props.onOpenEdit(t)}><PencilSimple size={14} /></IconBtn>
          )}
          {!['generating', 'generated'].includes(t.status) && (
            <IconBtn label="Suggest a different topic" tone="quiet" disabled={loading} onClick={() => props.onRegenerateTopic(t.id)}><ArrowClockwise size={14} /></IconBtn>
          )}
          {!['generating', 'generated'].includes(t.status) && t.status !== 'rejected' && (
            <IconBtn label="Reject topic" tone="danger" disabled={loading} onClick={() => props.onReject(t.id)}><X size={14} weight="bold" /></IconBtn>
          )}
          <IconBtn label="Delete permanently" tone="quiet" disabled={purging} onClick={() => props.onPurge('topic', t.id)}><Trash size={14} /></IconBtn>
        </div>
      </div>

      {/* The why behind the topic */}
      {expanded && hasDetail && (
        <div className="pl-detail">
          <dl>
            {([
              { key: 'keyword_opportunity' as const, label: 'Keyword opportunity' },
              { key: 'ranking_strategy'    as const, label: 'Ranking strategy' },
              { key: 'audience_intent'     as const, label: 'Audience intent' },
              { key: 'why_now'             as const, label: 'Why now' },
              { key: 'competition_level'   as const, label: 'Competition' },
            ]).filter(f => t[f.key]).map(({ key, label }) => (
              <div key={key}><dt>{label}</dt><dd>{t[key] as string}</dd></div>
            ))}
          </dl>
          {t.page_to_support && (
            <p style={{ margin: 0 }}><span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>Supports </span><a href={t.page_to_support} target="_blank" rel="noopener noreferrer">{t.page_to_support}</a></p>
          )}
          {typeof t.seo_brief?.cannibalization_warning === 'string' && t.seo_brief.cannibalization_warning && (
            <div className="ui-notice ui-notice--warning" style={{ margin: 0 }}>{t.seo_brief.cannibalization_warning}</div>
          )}
        </div>
      )}

      {/* Inline edit */}
      {editing && (
        <div className="pl-edit">
          <input className="input" value={editTitle} onChange={e => props.onEditTitleChange(e.target.value)} placeholder="Topic title" aria-label="Topic title" autoFocus />
          <textarea className="input" rows={2} value={editNotes} onChange={e => props.onEditNotesChange(e.target.value)} placeholder="Direction notes (optional): the angle to take if it’s written again" aria-label="Direction notes" style={{ resize: 'vertical' }} />
          <div className="pl-edit-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => props.onSaveEdit(t.id)} disabled={loading}>Save</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => props.onCancelEdit()}>Cancel</button>
          </div>
        </div>
      )}
    </article>
  )
}
