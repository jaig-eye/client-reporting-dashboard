'use client'

import { useEffect } from 'react'
import type { SeoBrief, SeoScore } from '@/lib/content/types'

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

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.07em', color: 'var(--text-faint)', marginBottom: '0.5rem' }}>
      {children}
    </div>
  )
}

function Divider() {
  return <div style={{ height: 1, background: 'var(--border)', margin: '1rem 0' }} />
}

function ScoreRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
      <span style={{ color: ok ? 'var(--green)' : 'var(--red)', fontWeight: 700, fontSize: '0.75rem', width: 12, flexShrink: 0 }}>
        {ok ? '✓' : '✗'}
      </span>
      {label}
    </div>
  )
}

function ContextBadge({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span style={{
      fontSize: '0.6875rem', padding: '2px 8px', borderRadius: 999,
      background: ok ? '#dcfce7' : 'var(--bg-muted)',
      color: ok ? '#166534' : 'var(--text-faint)',
      border: `1px solid ${ok ? '#86efac' : 'var(--border)'}`,
    }}>
      {ok ? '✓' : '—'} {label}
    </span>
  )
}

export default function RationaleModal({ item, onClose }: Props) {
  useEffect(() => {
    if (!item) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [item, onClose])

  if (!item) return null

  const displayTitle = item.topicText ?? item.title ?? item.targetKeyword ?? 'Untitled'
  const brief        = item.seoBrief
  const score        = item.seoScore
  const competitors  = item.competitorsResearched

  const ratFields: { label: string; value: string | null | undefined; color: string; bg: string }[] = [
    { label: 'Keyword Opportunity', value: item.keywordOpportunity, color: '#2563eb', bg: '#eff6ff' },
    { label: 'Ranking Strategy',    value: item.rankingStrategy,    color: '#7c3aed', bg: '#f5f3ff' },
    { label: 'Audience Intent',     value: item.audienceIntent,     color: '#059669', bg: '#f0fdf4' },
    { label: 'Why Now',             value: item.whyNow,             color: '#d97706', bg: '#fffbeb' },
    { label: 'Competition Detail',  value: item.competitionLevel,   color: '#dc2626', bg: '#fef2f2' },
  ]

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: '1rem',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-surface, #fff)',
          borderRadius: 14, maxWidth: 640, width: '100%',
          maxHeight: '90vh', overflow: 'auto',
          boxShadow: '0 24px 80px rgba(0,0,0,0.22)',
          borderTop: '4px solid var(--blue, #2563eb)',
        }}
      >
        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div style={{ padding: '1.25rem 1.5rem 1rem', position: 'relative' }}>
          <button
            onClick={onClose}
            style={{
              position: 'absolute', top: '1rem', right: '1rem',
              background: 'var(--bg-subtle)', border: 'none', cursor: 'pointer',
              width: 28, height: 28, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1rem', color: 'var(--text-faint)', lineHeight: 1,
            }}
          >×</button>
          <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--blue)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.375rem' }}>
            {item.type === 'post' ? 'Post Details' : 'Topic Rationale'} — {item.clientName}
          </div>
          <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.35, paddingRight: '2.5rem' }}>
            {displayTitle}
          </h2>
          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
            {item.targetKeyword && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                <span style={{ color: 'var(--text-faint)' }}>Keyword </span>{item.targetKeyword}
              </span>
            )}
            {item.targetPublishDate && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                <span style={{ color: 'var(--text-faint)' }}>Publish </span>{fmtDate(item.targetPublishDate)}
              </span>
            )}
          </div>
        </div>

        <div style={{ padding: '0 1.5rem 1.5rem' }}>

          {/* ── Overview chips ─────────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginBottom: '1rem' }}>
            {item.searchVolume != null && (
              <span style={{ padding: '3px 10px', borderRadius: 999, background: '#ede9fe', color: '#5b21b6', fontSize: '0.75rem' }}>
                {item.searchVolume.toLocaleString()} searches/mo
              </span>
            )}
            {item.keywordDifficulty != null && (
              <span style={{ padding: '3px 10px', borderRadius: 999, background: '#fef3c7', color: '#92400e', fontSize: '0.75rem' }}>
                KD {item.keywordDifficulty}
              </span>
            )}
            {brief?.search_intent && (
              <span style={{ padding: '3px 10px', borderRadius: 999, background: '#dbeafe', color: '#1e40af', fontSize: '0.75rem' }}>
                {brief.search_intent.replace('_', ' ')}
              </span>
            )}
            {brief?.funnel_stage && (
              <span style={{ padding: '3px 10px', borderRadius: 999, background: '#dcfce7', color: '#166534', fontSize: '0.75rem' }}>
                {brief.funnel_stage}
              </span>
            )}
            {brief?.schema_type && (
              <span style={{ padding: '3px 10px', borderRadius: 999, background: 'var(--bg-muted)', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                {brief.schema_type}
              </span>
            )}
          </div>

          {/* ── Suggested title ────────────────────────────────────────────── */}
          {item.suggestedTitle && (
            <div style={{ marginBottom: '1rem', padding: '0.625rem 0.75rem', borderRadius: 8, background: 'var(--bg-subtle)', border: '1px solid var(--border)' }}>
              <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.04em', marginRight: 8 }}>Suggested Title</span>
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-primary)' }}>{item.suggestedTitle}</span>
            </div>
          )}

          {/* ── Why This Topic ─────────────────────────────────────────────── */}
          {item.rationale && (
            <>
              <Divider />
              <SectionHeader>Why This Topic</SectionHeader>
              <div style={{ padding: '0.75rem 1rem', borderRadius: 8, background: '#eff6ff', borderLeft: '3px solid #2563eb', marginBottom: item.whyNow ? '0.75rem' : 0 }}>
                <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-primary)', lineHeight: 1.65 }}>{item.rationale}</p>
              </div>
              {item.whyNow && (
                <div style={{ padding: '0.625rem 0.75rem', borderRadius: 8, background: '#fffbeb', borderLeft: '3px solid #d97706', marginTop: '0.5rem' }}>
                  <span style={{ fontSize: '0.625rem', fontWeight: 700, color: '#d97706', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Why Now: </span>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>{item.whyNow}</span>
                </div>
              )}
            </>
          )}

          {/* ── Strategy breakdown ─────────────────────────────────────────── */}
          {ratFields.some(f => f.value && f.label !== 'Why Now') && (
            <>
              <Divider />
              <SectionHeader>Strategy Breakdown</SectionHeader>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                {ratFields
                  .filter(f => f.value && f.label !== 'Why Now')
                  .map(f => (
                    <div key={f.label} style={{ borderLeft: `3px solid ${f.color}`, paddingLeft: '0.75rem' }}>
                      <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: f.color, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>{f.label}</div>
                      <div style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', lineHeight: 1.65 }}>{f.value}</div>
                    </div>
                  ))}
              </div>
            </>
          )}

          {/* ── SEO Brief preview ──────────────────────────────────────────── */}
          {brief && (
            <>
              <Divider />
              <SectionHeader>SEO Brief</SectionHeader>
              {brief.h2_outline && brief.h2_outline.length > 0 && (
                <div style={{ marginBottom: '0.875rem' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.375rem' }}>Article Structure (H2s)</div>
                  <ol style={{ margin: 0, paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    {brief.h2_outline.map((h, i) => (
                      <li key={i} style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>{h}</li>
                    ))}
                  </ol>
                </div>
              )}
              {brief.local_seo_angle && (
                <div style={{ marginBottom: '0.75rem', padding: '0.5rem 0.75rem', borderRadius: 6, background: '#f0fdf4', borderLeft: '3px solid #059669' }}>
                  <span style={{ fontSize: '0.625rem', fontWeight: 700, color: '#059669', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Local Angle: </span>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--text-primary)' }}>{brief.local_seo_angle}</span>
                </div>
              )}
              {brief.internal_link_targets && brief.internal_link_targets.length > 0 && (
                <div style={{ marginBottom: '0.75rem' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.375rem' }}>Internal Links Planned</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {brief.internal_link_targets.map((url, i) => (
                      <span key={i} style={{ fontSize: '0.75rem', color: 'var(--blue)', fontFamily: 'monospace' }}>{url}</span>
                    ))}
                  </div>
                </div>
              )}
              {brief.faq_opportunities && brief.faq_opportunities.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.375rem' }}>FAQ Opportunities</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {brief.faq_opportunities.map((q, i) => (
                      <span key={i} style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>• {q}</span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Competitor analysis ────────────────────────────────────────── */}
          {competitors && (competitors.urls?.length ?? 0) > 0 && (
            <>
              <Divider />
              <SectionHeader>Competitor Research Used</SectionHeader>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: '0.5rem' }}>
                {competitors.urls?.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.75rem', color: 'var(--blue)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</a>
                ))}
              </div>
              {competitors.headings && Object.keys(competitors.headings).length > 0 && (
                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-faint)' }}>
                  Headings from {Object.keys(competitors.headings).length} competitor page{Object.keys(competitors.headings).length !== 1 ? 's' : ''} were analysed for content gap opportunities.
                </p>
              )}
            </>
          )}

          {/* ── Post quality (SEO score) — posts only ──────────────────────── */}
          {score && item.type === 'post' && (
            <>
              <Divider />
              <SectionHeader>Post Quality</SectionHeader>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '0.875rem' }}>
                <div style={{
                  width: 56, height: 56, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  background: score.overall >= 75 ? '#dcfce7' : score.overall >= 50 ? '#fef3c7' : '#fee2e2',
                  border: `3px solid ${score.overall >= 75 ? '#22c55e' : score.overall >= 50 ? '#f59e0b' : '#ef4444'}`,
                }}>
                  <span style={{ fontSize: '1.25rem', fontWeight: 800, color: score.overall >= 75 ? '#16a34a' : score.overall >= 50 ? '#d97706' : '#dc2626' }}>
                    {score.overall}
                  </span>
                </div>
                <div>
                  <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    SEO Score — {score.overall >= 75 ? 'Good' : score.overall >= 50 ? 'Needs Work' : 'Poor'}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {score.internal_links_count} internal link{score.internal_links_count !== 1 ? 's' : ''}
                  </div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem 1rem', marginBottom: '0.75rem' }}>
                <ScoreRow label="Keyword in H1"      ok={score.keyword_in_title}    />
                <ScoreRow label="Keyword in intro"   ok={score.keyword_in_intro}    />
                <ScoreRow label="Keyword in headings" ok={score.keyword_in_headings} />
                <ScoreRow label="Intent match"       ok={score.intent_match}        />
                <ScoreRow label="Heading structure"  ok={score.heading_structure}   />
                <ScoreRow label="Word count on target" ok={score.word_count_on_target} />
                <ScoreRow label="E-E-A-T signals"   ok={score.eat_signals}         />
                <ScoreRow label="CTA present"        ok={score.cta_present}         />
                <ScoreRow label="FAQ present"        ok={score.faq_present}         />
                <ScoreRow label="Local relevance"    ok={score.local_relevance}     />
              </div>
              {score.issues && score.issues.length > 0 && (
                <div style={{ marginBottom: '0.5rem' }}>
                  {score.issues.map((iss, i) => (
                    <div key={i} style={{ fontSize: '0.75rem', color: '#dc2626', display: 'flex', gap: 5, alignItems: 'flex-start' }}>
                      <span style={{ fontWeight: 700, flexShrink: 0 }}>✗</span>{iss}
                    </div>
                  ))}
                </div>
              )}
              {score.warnings && score.warnings.length > 0 && (
                <div>
                  {score.warnings.map((w, i) => (
                    <div key={i} style={{ fontSize: '0.75rem', color: '#d97706', display: 'flex', gap: 5, alignItems: 'flex-start' }}>
                      <span style={{ fontWeight: 700, flexShrink: 0 }}>⚠</span>{w}
                    </div>
                  ))}
                </div>
              )}
              {item.aiModel && (
                <p style={{ margin: '0.5rem 0 0', fontSize: '0.7rem', color: 'var(--text-faint)' }}>
                  Generated by {item.aiModel}{item.generatedAt ? ` on ${new Date(item.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
                </p>
              )}
            </>
          )}

          {/* ── Context used ───────────────────────────────────────────────── */}
          <Divider />
          <SectionHeader>Context Used for Generation</SectionHeader>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
            <ContextBadge label="Business Background" ok={item.hasBusinessBackground ?? false} />
            <ContextBadge label="E-E-A-T Signals"    ok={item.hasEeat ?? false}               />
            <ContextBadge label="Sitemap"             ok={item.hasSitemap ?? false}            />
            <ContextBadge label="GSC Data"            ok={item.hasGsc ?? false}               />
            <ContextBadge label="Competitor Research" ok={item.hasCompetitors ?? (competitors != null && (competitors.urls?.length ?? 0) > 0)} />
          </div>

          {/* ── Generation error ───────────────────────────────────────────── */}
          {item.generationError && (
            <>
              <Divider />
              <div style={{ background: '#fee2e2', borderRadius: 8, padding: '0.625rem 0.875rem' }}>
                <div style={{ fontSize: '0.625rem', fontWeight: 700, color: '#991b1b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Generation Error</div>
                <div style={{ fontSize: '0.8125rem', color: '#7f1d1d', lineHeight: 1.5 }}>{item.generationError}</div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
