'use client'

// Per-client pipeline card — the card/review presentation of a single pipeline
// item (a topic slot or a generated post), styled after MonthlyReviewPostCard.
// Purely presentational: ClientPipeline owns all state and passes callbacks.

import { Check, X, PencilSimple, ArrowClockwise, Play, ArrowRight, Trash } from '@phosphor-icons/react'
import type { SeoScore } from '@/lib/content/types'
import { viewLiveUrl, isPublicPermalink, wpDraftPreviewUrl, wpEditUrl, bcEditUrl } from '@/lib/content/postLinks'

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
}

export interface Post {
  id:                  string
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
  generated_at:        string
}

export type RowItem =
  | { kind: 'topic'; data: Topic }
  | { kind: 'post';  data: Post }

export type DisplayStatus = 'pending' | 'approved' | 'generating' | 'generated' | 'published' | 'rejected'

export const DISPLAY_STATUS_CONFIG: Record<DisplayStatus, { label: string; bg: string; color: string; dot: string }> = {
  pending:    { label: 'Pending',        bg: 'var(--amber-subtle)', color: 'var(--amber)', dot: '#f59e0b' },
  approved:   { label: 'Approved',       bg: 'var(--blue-subtle)',  color: 'var(--blue)',  dot: '#2563eb' },
  generating: { label: 'Generating',     bg: 'var(--amber-subtle)', color: 'var(--amber)', dot: '#f59e0b' },
  generated:  { label: 'Ready to Review', bg: 'var(--green-subtle)', color: 'var(--green)', dot: '#10b981' },
  published:  { label: 'On Site',        bg: 'var(--green-subtle)', color: 'var(--green)', dot: '#059669' },
  rejected:   { label: 'Rejected',       bg: 'var(--red-subtle)',   color: 'var(--red)',   dot: '#ef4444' },
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

function scoreColor(s: SeoScore | null): string {
  if (!s) return 'var(--text-faint)'
  if (s.overall >= 80) return 'var(--green)'
  if (s.overall >= 60) return 'var(--amber)'
  return 'var(--red)'
}

export function StatusPill({ status, generating }: { status: DisplayStatus; generating?: boolean }) {
  const cfg = DISPLAY_STATUS_CONFIG[status]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.65rem', fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: cfg.bg, color: cfg.color, whiteSpace: 'nowrap', flexShrink: 0 }}>
      <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: cfg.dot, animation: generating ? 'pulse 1.2s ease-in-out infinite' : undefined }} />
      {cfg.label}
    </span>
  )
}

// ── Icon action button ──────────────────────────────────────────────────────────
function IconBtn({ label, color, disabled, onClick, children }: { label: string; color: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className="btn btn-secondary" aria-label={label} title={label} disabled={disabled}
      style={{ padding: '3px 7px', color, display: 'inline-flex', alignItems: 'center', cursor: disabled ? 'default' : 'pointer' }}
      onClick={e => { e.stopPropagation(); onClick() }}>
      {children}
    </button>
  )
}

interface Props {
  item:        RowItem
  linkedPost:  Post | null
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

function Thumb({ url }: { url: string | null }) {
  return url
    ? <img src={url} alt="" style={{ width: 44, height: 34, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
    : <div style={{ width: 44, height: 34, borderRadius: 4, flexShrink: 0, background: 'var(--bg-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, color: 'var(--text-faint)' }}>◧</div>
}

// Compact live/edit link row for on-site posts.
function LiveLinks({ post }: { post: Post }) {
  const live = viewLiveUrl(post), draft = wpDraftPreviewUrl(post), wpe = wpEditUrl(post), bce = bcEditUrl(post)
  const s: React.CSSProperties = { color: 'var(--text-muted)', textDecoration: 'none' }
  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 3, flexWrap: 'wrap', fontSize: 11 }} onClick={e => e.stopPropagation()}>
      {isPublicPermalink(live) && live && <a href={live} target="_blank" rel="noreferrer" style={{ ...s, color: 'var(--blue)', fontWeight: 600 }}>View live ↗</a>}
      {draft && <a href={draft} target="_blank" rel="noreferrer" title="Requires your WordPress login" style={s}>Preview draft ↗</a>}
      {wpe && <a href={wpe} target="_blank" rel="noreferrer" style={s}>Open in WP ↗</a>}
      {bce && <a href={bce} target="_blank" rel="noreferrer" style={s}>Edit in BigCommerce ↗</a>}
    </div>
  )
}

const cardShell: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px',
  border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-surface)',
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
    return (
      <div style={cardShell}>
        <Thumb url={post.featured_image_url} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 13.5, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {post.title ?? topic?.topic ?? '(generating…)'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
            {fmtDate(post.target_publish_date)}
            {post.word_count ? ` · ${post.word_count.toLocaleString()}w` : ''}
            {post.bc_post_id ? ' · BC' : post.wp_post_id ? ' · WP' : ''}
            {post.seo_score ? <span style={{ marginLeft: 6, fontWeight: 600, color: scoreColor(post.seo_score) }}>SEO {post.seo_score.overall}</span> : null}
          </div>
          {onSite && <LiveLinks post={post} />}
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
          <StatusPill status={ds} />
          <button className="btn btn-sm btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            onClick={() => props.onReview(post)}>
            <ArrowRight size={12} weight="bold" /> {post.status === 'draft_saved' || post.status === 'published' ? 'Edit' : 'Review'}
          </button>
          <IconBtn label="Delete" color="var(--text-faint)" disabled={purging}
            onClick={() => props.onPurge(item.kind === 'topic' ? 'topic' : 'post', item.kind === 'topic' ? (topic as Topic).id : post.id)}>
            <Trash size={13} />
          </IconBtn>
        </div>
      </div>
    )
  }

  // ── Slot card (topic without a ready post) ──────────────────────────────────
  const t = (item as { kind: 'topic'; data: Topic }).data
  const ds = getTopicDisplayStatus(t)
  const hasError = !!t.generation_error && !['rejected', 'generated'].includes(t.status)
  const hasDetail = !!(t.keyword_opportunity || t.ranking_strategy || t.audience_intent || t.why_now || t.competition_level || t.page_to_support || t.competitors_researched)

  return (
    <div style={{ ...cardShell, flexDirection: 'column', alignItems: 'stretch', gap: 8, background: 'var(--bg-subtle)', borderLeft: hasError ? '2px solid #f59e0b' : cardShell.border as string }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          style={{ flex: 1, minWidth: 0, cursor: hasDetail ? 'pointer' : 'default' }}
          onClick={() => { if (hasDetail && !editing) props.onToggleExpand() }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <StatusPill status={ds} generating={t.status === 'generating'} />
            {hasError && <span title={t.generation_error ?? ''} style={{ fontSize: 12, color: '#f59e0b', cursor: 'help', lineHeight: 1 }}>⚠</span>}
          </div>
          <div style={{ fontWeight: 500, fontSize: 13.5, color: 'var(--text-primary)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {t.topic}
            {hasDetail && <span style={{ fontSize: 10, marginLeft: 5, opacity: 0.5 }}>{expanded ? '▲' : '▾'}</span>}
          </div>
          {t.target_keyword && (
            <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 1 }}>
              {t.target_keyword}
              {t.cluster_group && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-faint)', background: 'var(--bg-muted)', padding: '0 5px', borderRadius: 3 }}>{t.cluster_group}</span>}
            </div>
          )}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>{fmtDate(t.target_publish_date)}</div>
        <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
          {hasError && (
            <IconBtn label="Retry generation" color="#f59e0b" disabled={loading} onClick={() => props.onRetry(t.id)}><ArrowClockwise size={13} weight="bold" /></IconBtn>
          )}
          {t.status === 'approved' && (
            <IconBtn label="Generate post now" color="var(--blue)" onClick={() => props.onGenerate(t.id)}><Play size={13} weight="fill" /></IconBtn>
          )}
          {!['approved', 'generating', 'generated'].includes(t.status) && (
            <IconBtn label="Approve topic" color="var(--green)" disabled={loading} onClick={() => props.onApprove(t.id)}><Check size={13} weight="bold" /></IconBtn>
          )}
          {!['generating', 'generated', 'rejected'].includes(t.status) && (
            <IconBtn label="Edit title" color="var(--text-muted)" onClick={() => editing ? props.onCancelEdit() : props.onOpenEdit(t)}><PencilSimple size={13} /></IconBtn>
          )}
          {!['generating', 'generated'].includes(t.status) && (
            <IconBtn label="Generate a different topic idea" color="var(--text-muted)" disabled={loading} onClick={() => props.onRegenerateTopic(t.id)}><ArrowClockwise size={13} /></IconBtn>
          )}
          {!['generating', 'generated'].includes(t.status) && t.status !== 'rejected' && (
            <IconBtn label="Reject topic" color="var(--red)" disabled={loading} onClick={() => props.onReject(t.id)}><X size={13} weight="bold" /></IconBtn>
          )}
          <IconBtn label="Permanently delete" color="var(--text-faint)" disabled={purging} onClick={() => props.onPurge('topic', t.id)}><Trash size={13} /></IconBtn>
        </div>
      </div>

      {/* Expandable SEO brief */}
      {expanded && hasDetail && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
          {([
            { key: 'keyword_opportunity' as const, label: 'Keyword Opportunity', color: '#2563eb', bg: '#eff6ff' },
            { key: 'ranking_strategy'    as const, label: 'Ranking Strategy',    color: '#7c3aed', bg: '#f5f3ff' },
            { key: 'audience_intent'     as const, label: 'Audience Intent',     color: '#059669', bg: '#f0fdf4' },
            { key: 'why_now'             as const, label: 'Why Now',             color: '#d97706', bg: '#fffbeb' },
            { key: 'competition_level'   as const, label: 'Competition',         color: '#dc2626', bg: '#fef2f2' },
          ]).filter(s => t[s.key]).map(({ key, label, color, bg }) => (
            <div key={key} style={{ borderLeft: `3px solid ${color}`, background: bg, borderRadius: '0 4px 4px 0', padding: '4px 8px' }}>
              <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color, marginBottom: 2 }}>{label}</p>
              <p style={{ fontSize: 12.5, color: '#374151', lineHeight: 1.4 }}>{t[key] as string}</p>
            </div>
          ))}
          {t.page_to_support && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              <span style={{ fontWeight: 600 }}>Supporting: </span>
              <a href={t.page_to_support} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue)' }}>{t.page_to_support}</a>
            </div>
          )}
          {typeof t.seo_brief?.cannibalization_warning === 'string' && t.seo_brief.cannibalization_warning && (
            <div style={{ fontSize: 12, color: 'var(--amber)', background: 'var(--amber-subtle)', padding: '4px 8px', borderRadius: 4 }}>⚠ {t.seo_brief.cannibalization_warning}</div>
          )}
        </div>
      )}

      {/* Inline edit */}
      {editing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
          <input className="input" value={editTitle} onChange={e => props.onEditTitleChange(e.target.value)} placeholder="Topic title" style={{ fontSize: 13.5 }} autoFocus />
          <textarea className="input" rows={2} value={editNotes} onChange={e => props.onEditNotesChange(e.target.value)} placeholder="Direction notes (optional) — the angle to take if regenerating" style={{ fontSize: 13, resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-primary btn-sm" onClick={() => props.onSaveEdit(t.id)} disabled={loading}>Save</button>
            <button className="btn btn-secondary btn-sm" onClick={() => props.onCancelEdit()}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
