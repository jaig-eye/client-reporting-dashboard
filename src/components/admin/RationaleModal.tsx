'use client'

// Why a topic was picked (or, for a post, what it was written from): the strategy behind it, the
// SEO brief, the competitors read, the post's quality checks, and which context the writer had.
// Read-only, in the shared Dialog. Styles: styles/admin/content.css (.ra-*).

import { CheckCircle, WarningCircle, XCircle, MinusCircle } from '@phosphor-icons/react'
import type { SeoBrief, SeoScore } from '@/lib/content/types'
import Dialog from '@/components/ui/Dialog'
import StatusBadge from '@/components/ui/StatusBadge'

// Accepts either CalendarItem or QueueItem — share only the fields we need
export interface RationaleItem {
  type:                'post' | 'topic'
  clientName:          string
  topicText?:          string | null
  title?:              string | null
  targetKeyword?:      string | null
  targetPublishDate?:  string | null
  rationale?:          string | null
  keywordOpportunity?: string | null
  rankingStrategy?:    string | null
  audienceIntent?:     string | null
  whyNow?:             string | null
  competitionLevel?:   string | null
  suggestedTitle?:     string | null
  searchVolume?:       number | null
  keywordDifficulty?:  number | null
  generationError?:    string | null
  seoBrief?:           SeoBrief | null
  seoScore?:           SeoScore | null
  aiModel?:            string | null
  generatedAt?:        string | null
  competitorsResearched?: {
    keyword?: string
    urls?: string[]
    headings?: Record<string, string[]>
  } | null
  // flags for the context check row
  hasBusinessBackground?: boolean
  hasEeat?:              boolean
  hasSitemap?:           boolean
  hasGsc?:               boolean
  hasCompetitors?:       boolean
}

interface Props {
  item:    RationaleItem | null
  onClose: () => void
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

function Part({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="ra-part">
      <h3 className="ra-part-title">{title}</h3>
      {children}
    </section>
  )
}

/** A check that passed or failed: an icon and a word, never colour alone. */
function Check({ label, ok }: { label: string; ok: boolean }) {
  return (
    <li className={`ra-check${ok ? ' ra-check--ok' : ' ra-check--no'}`}>
      {ok ? <CheckCircle size={15} weight="fill" aria-hidden /> : <XCircle size={15} weight="fill" aria-hidden />}
      <span>{label}<span className="sr-only">{ok ? ': yes' : ': no'}</span></span>
    </li>
  )
}

export default function RationaleModal({ item, onClose }: Props) {
  if (!item) return null

  const displayTitle = item.topicText ?? item.title ?? item.targetKeyword ?? 'Untitled'
  const brief        = item.seoBrief
  const score        = item.seoScore
  const competitors  = item.competitorsResearched

  // The order a strategist reads them in. One neutral style: the old per-field colours meant
  // nothing (competition was red whether it was high or low).
  const ratFields: { label: string; value: string | null | undefined }[] = [
    { label: 'Keyword opportunity', value: item.keywordOpportunity },
    { label: 'Ranking strategy',    value: item.rankingStrategy },
    { label: 'Audience intent',     value: item.audienceIntent },
    { label: 'Why now',             value: item.whyNow },
    { label: 'Competition',         value: item.competitionLevel },
  ]
  const scoreTone = score ? (score.overall >= 75 ? 'good' : score.overall >= 50 ? 'ok' : 'bad') : null
  const hasCompetitors = item.hasCompetitors ?? (competitors != null && (competitors.urls?.length ?? 0) > 0)

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={displayTitle}
      description={`${item.type === 'post' ? 'What this post was written from' : 'Why this topic'}, for ${item.clientName}`}
    >
      <div className="ra">
        {(item.targetKeyword || item.targetPublishDate) && (
          <p className="ra-meta">
            {item.targetKeyword && <span><span className="ra-k">Keyword</span> {item.targetKeyword}</span>}
            {item.targetPublishDate && <span><span className="ra-k">Publishes</span> {fmtDate(item.targetPublishDate)}</span>}
          </p>
        )}

        {(item.searchVolume != null || item.keywordDifficulty != null || brief?.search_intent || brief?.funnel_stage || brief?.schema_type) && (
          <div className="ra-chips">
            {item.searchVolume != null && <StatusBadge dot={false}>{item.searchVolume.toLocaleString()} searches a month</StatusBadge>}
            {item.keywordDifficulty != null && <StatusBadge dot={false}>Difficulty {item.keywordDifficulty}</StatusBadge>}
            {brief?.search_intent && <StatusBadge dot={false}>{brief.search_intent.replace('_', ' ')} intent</StatusBadge>}
            {brief?.funnel_stage && <StatusBadge dot={false}>{brief.funnel_stage}</StatusBadge>}
            {brief?.schema_type && <StatusBadge dot={false}>{brief.schema_type} schema</StatusBadge>}
          </div>
        )}

        {/* The rationale itself. The old modal opened because of it and then never showed it. */}
        {item.rationale && <p className="ra-lead">{item.rationale}</p>}

        {item.suggestedTitle && (
          <p className="ra-suggested"><span className="ra-k">Suggested title</span> {item.suggestedTitle}</p>
        )}

        {ratFields.some(f => f.value) && (
          <Part title="The strategy">
            <dl className="ra-fields">
              {ratFields.filter(f => f.value).map(f => (
                <div key={f.label}>
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          </Part>
        )}

        {brief && (
          <Part title="SEO brief">
            {brief.h2_outline && brief.h2_outline.length > 0 && (
              <div className="ra-block">
                <p className="ra-sub">Outline</p>
                <ol className="ra-list">{brief.h2_outline.map((h, i) => <li key={i}>{h}</li>)}</ol>
              </div>
            )}
            {brief.local_seo_angle && (
              <p className="ra-block ra-note"><span className="ra-k">Local angle</span> {brief.local_seo_angle}</p>
            )}
            {brief.internal_link_targets && brief.internal_link_targets.length > 0 && (
              <div className="ra-block">
                <p className="ra-sub">Internal links planned</p>
                <ul className="ra-urls">{brief.internal_link_targets.map((url, i) => <li key={i}>{url}</li>)}</ul>
              </div>
            )}
            {brief.faq_opportunities && brief.faq_opportunities.length > 0 && (
              <div className="ra-block">
                <p className="ra-sub">Questions to answer</p>
                <ul className="ra-list ra-list--plain">{brief.faq_opportunities.map((q, i) => <li key={i}>{q}</li>)}</ul>
              </div>
            )}
          </Part>
        )}

        {competitors && (competitors.urls?.length ?? 0) > 0 && (
          <Part title="Competitors read">
            <ul className="ra-urls">
              {competitors.urls?.map((url, i) => <li key={i}><a href={url} target="_blank" rel="noopener noreferrer">{url}</a></li>)}
            </ul>
            {competitors.headings && Object.keys(competitors.headings).length > 0 && (
              <p className="ra-sub" style={{ marginTop: 6, fontWeight: 400 }}>
                Headings from {Object.keys(competitors.headings).length} of their page{Object.keys(competitors.headings).length !== 1 ? 's' : ''} were compared to find what this post should cover that theirs don’t.
              </p>
            )}
          </Part>
        )}

        {score && item.type === 'post' && (
          <Part title="Post quality">
            <div className="ra-score">
              <span className={`ra-score-num ra-score-num--${scoreTone}`}>{score.overall}</span>
              <div>
                <p className="ra-score-word">SEO score: {score.overall >= 75 ? 'good' : score.overall >= 50 ? 'needs work' : 'poor'}</p>
                <p className="ra-sub" style={{ fontWeight: 400 }}>{score.internal_links_count} internal link{score.internal_links_count !== 1 ? 's' : ''}</p>
              </div>
            </div>
            <ul className="ra-checks">
              <Check label="Keyword in the title"   ok={score.keyword_in_title} />
              <Check label="Keyword in the intro"   ok={score.keyword_in_intro} />
              <Check label="Keyword in headings"    ok={score.keyword_in_headings} />
              <Check label="Matches the intent"     ok={score.intent_match} />
              <Check label="Heading structure"      ok={score.heading_structure} />
              <Check label="Word count on target"   ok={score.word_count_on_target} />
              <Check label="E-E-A-T signals"        ok={score.eat_signals} />
              <Check label="Call to action"         ok={score.cta_present} />
              <Check label="FAQ"                    ok={score.faq_present} />
              <Check label="Local relevance"        ok={score.local_relevance} />
            </ul>
            {(score.issues?.length ?? 0) > 0 && (
              <ul className="ra-issues">
                {score.issues.map((iss, i) => <li key={i} className="ra-issue ra-issue--bad"><XCircle size={14} weight="fill" aria-hidden /><span>{iss}</span></li>)}
              </ul>
            )}
            {(score.warnings?.length ?? 0) > 0 && (
              <ul className="ra-issues">
                {score.warnings.map((w, i) => <li key={i} className="ra-issue ra-issue--warn"><WarningCircle size={14} weight="fill" aria-hidden /><span>{w}</span></li>)}
              </ul>
            )}
            {item.aiModel && (
              <p className="ra-sub" style={{ marginTop: 8, fontWeight: 400 }}>
                Written by {item.aiModel}{item.generatedAt ? ` on ${new Date(item.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
              </p>
            )}
          </Part>
        )}

        <Part title="What the writer had">
          <ul className="ra-context">
            {([
              ['Business background', item.hasBusinessBackground ?? false],
              ['E-E-A-T signals',     item.hasEeat ?? false],
              ['Sitemap',             item.hasSitemap ?? false],
              ['Search Console data', item.hasGsc ?? false],
              ['Competitor research', hasCompetitors],
            ] as [string, boolean][]).map(([label, ok]) => (
              <li key={label} className={ok ? 'ra-have' : 'ra-missing'}>
                {ok ? <CheckCircle size={14} weight="fill" aria-hidden /> : <MinusCircle size={14} aria-hidden />}
                {label}<span className="sr-only">{ok ? ': used' : ': not available'}</span>
              </li>
            ))}
          </ul>
        </Part>

        {item.generationError && (
          <div className="ui-notice ui-notice--danger" role="alert" style={{ margin: '16px 0 0' }}>
            <span><strong>Writing failed.</strong> {item.generationError}</span>
          </div>
        )}
      </div>
    </Dialog>
  )
}
