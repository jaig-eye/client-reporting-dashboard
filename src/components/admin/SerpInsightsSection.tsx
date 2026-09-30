'use client'

import { useMemo } from 'react'
import type { SerpInsightRow, SerpInsight, SerpSource } from '@/lib/content/serpInsights'
import { fmtDay } from '@/components/admin/KeywordUi'

/**
 * What Google shows — the talking points the writer is handed, made visible.
 *
 * One row per keyword that has a stored copy of Google's results page: a post's target keyword
 * (captured when the post was written) or one of the client's services (captured when research
 * ran). The Keywords tab's evidence card around this carries the title, the explanation, the
 * loading and the empty state; this is only the list.
 *
 * Badges are in plain words rather than SEO's: "Map results", "Answer box", "Quoted by AI" — the
 * people reading this are not SEO specialists, and each badge's title says the rest.
 *
 * The opened row used to be five equal blocks in an auto-fit grid — questions, AI sources,
 * related searches, map pack, top results — each the same weight, so nothing led and the whole
 * thing read as a dump. It is two zones now, because there are only two questions being asked:
 *
 *   What should the post cover?   ← the questions and the related searches. Actionable, so first
 *                                   and full width.
 *   Who is already there?         ← one ranked list of domains, each carrying every role it
 *                                   plays, plus the map pack. Context, so second and quieter.
 *
 * The merge in that second zone is the point: a domain that ranks #2, is quoted by the AI answer
 * AND holds the featured snippet was three separate lines telling you about one competitor. It is
 * one line now, with three marks.
 */
export default function SerpInsightsSection({ rows, ownDomains }: {
  rows:        SerpInsightRow[]
  /** The client's own sites, so "you" can be marked in a list of competitors. */
  ownDomains?: string[]
}) {
  const own = useMemo(() => new Set((ownDomains ?? []).map(bareHost).filter(Boolean)), [ownDomains])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.slice(0, 40).map(r => <InsightRow key={r.keyword} row={r} own={own} />)}
      {rows.length > 40 && (
        <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Showing the 40 most recent of {rows.length}.</p>
      )}
    </div>
  )
}

// ─── One keyword ──────────────────────────────────────────────────────────────

function InsightRow({ row, own }: { row: SerpInsightRow; own: Set<string> }) {
  const s = row.insight
  const place = s.location ? s.location.split(',')[0] : null
  const when  = fmtDay(s.checked_at) ?? ''
  const aiPresent = s.ai_overview?.present === true
  const results = rankedResults(s, own)
  const hasDetail = s.paa.length > 0 || s.related.length > 0 || results.length > 0 || s.local_pack.length > 0

  // Where the client sits, if anywhere. The single most useful fact in the row, so it belongs in
  // the line you can see without opening anything.
  const mine = results.find(r => r.isOwn)

  return (
    <details style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '0.5rem 0.75rem' }}>
      <summary style={{ cursor: hasDetail ? 'pointer' : 'default', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>{row.keyword}</span>
        {s.query && s.query.toLowerCase() !== row.keyword.toLowerCase() && (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }} title="The phrase that was searched; the post's keyword was refined from it">searched as &ldquo;{s.query}&rdquo;</span>
        )}
        {mine && (
          <span className="badge badge-green" style={{ fontVariantNumeric: 'tabular-nums' }} title={`${mine.domain} is result ${mine.rank} for this search`}>
            You rank #{mine.rank}
          </span>
        )}
        {s.ai_overview != null && (
          <span className={aiPresent ? 'badge badge-blue' : 'badge badge-gray'} title={aiPresent ? 'Google shows an AI answer for this search' : 'No AI answer on this search'}>
            {aiPresent ? 'AI answer' : 'No AI answer'}
          </span>
        )}
        {s.local_pack.length > 0 && <span className="badge badge-blue" title="Businesses Google shows on its map for this search (the “map pack”)">{s.local_pack.length} map results</span>}
        {s.paa.length > 0 && <span className="badge badge-gray" title="Questions Google lists under “People also ask”">{s.paa.length} question{s.paa.length === 1 ? '' : 's'}</span>}
        {s.featured_snippet && <span className="badge badge-amber" title={`The answer box at the top (the “featured snippet”) quotes ${s.featured_snippet.domain}`}>Answer box</span>}
        <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {[row.contentPostId ? 'For a post' : 'At research', place, when].filter(Boolean).join(', ')}
        </span>
      </summary>

      {hasDetail && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* ── Zone one: what the post should cover ─────────────────────────── */}
          {(s.paa.length > 0 || s.related.length > 0) && (
            <section>
              <ZoneHeading>What to cover</ZoneHeading>
              {s.paa.length > 0 && (
                <ul style={{
                  margin: '0 0 10px', padding: 0, listStyle: 'none',
                  display: 'flex', flexDirection: 'column', gap: 5,
                }}>
                  {s.paa.map(q => (
                    <li key={q} style={{
                      display: 'flex', gap: 8, alignItems: 'baseline',
                      fontSize: '0.8125rem', lineHeight: 1.45, color: 'var(--text-primary)', maxWidth: '68ch',
                    }}>
                      {/* The lines already end in question marks; a leading "?" would say it twice. */}
                      <span aria-hidden style={{ color: 'var(--text-faint)', fontSize: '0.7rem' }}>&bull;</span>
                      <span>{q}</span>
                    </li>
                  ))}
                </ul>
              )}
              {s.related.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)', marginRight: 2 }}>Also searched:</span>
                  {s.related.map(r => <span key={r} className="badge badge-gray">{r}</span>)}
                </div>
              )}
            </section>
          )}

          {/* ── Zone two: who is already there ───────────────────────────────── */}
          {(results.length > 0 || s.local_pack.length > 0) && (
            <section style={{
              display: 'grid', gap: 16,
              gridTemplateColumns: results.length > 0 && s.local_pack.length > 0
                ? 'repeat(auto-fit, minmax(260px, 1fr))'
                : '1fr',
            }}>
              {results.length > 0 && (
                <div>
                  <ZoneHeading>Who is already there</ZoneHeading>
                  <ResultList rows={results.filter(r => r.rank > 0)} />
                  {/* The off-ranking tail gets one labelled rule, not a rule and a badge on every
                      line — the group says it once. */}
                  {results.some(r => r.rank === 0) && (
                    <div style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 6 }}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)', marginBottom: 2 }}>
                        Below the top 10, but Google still surfaces them
                      </div>
                      <ResultList rows={results.filter(r => r.rank === 0)} />
                    </div>
                  )}
                </div>
              )}

              {s.local_pack.length > 0 && (
                <div>
                  <ZoneHeading>{place ? `On the map in ${place}` : 'On the map'}</ZoneHeading>
                  <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
                    {s.local_pack.map((p, i) => (
                      <li key={`${p.title}-${i}`} style={{
                        display: 'grid', gridTemplateColumns: '2.25rem minmax(0, 1fr) auto',
                        alignItems: 'baseline', gap: 4, padding: '3px 0',
                      }}>
                        <span style={{ fontSize: '0.72rem', fontVariantNumeric: 'tabular-nums', color: 'var(--text-faint)' }}>#{i + 1}</span>
                        <span style={{ minWidth: 0, fontSize: '0.8125rem', color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
                          {p.domain
                            ? <a href={`https://${p.domain}`} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>{p.title}</a>
                            : p.title}
                        </span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                          {p.rating != null ? `★ ${p.rating.toFixed(1)}${p.votes != null ? ` (${p.votes.toLocaleString()})` : ''}` : ''}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </details>
  )
}

// ─── Merging the three lists of domains into one ──────────────────────────────

/** Every role a domain plays on this page. Shown as marks on its single line. */
type Role = 'Quoted by AI' | 'Answer box'

const ROLE_TONE: Record<Role, string> = {
  'Quoted by AI': 'badge-blue',
  'Answer box':   'badge-amber',
}
const ROLE_TITLE: Record<Role, string> = {
  'Quoted by AI': "Google's AI answer quotes this page",
  'Answer box':   'Quoted in the answer box at the top of the results (the featured snippet)',
}

interface Result { rank: number; domain: string; url: string; title: string; isOwn: boolean; roles: Role[] }

/**
 * The organic top 10, each domain carrying whether the AI answer quotes it and whether it holds
 * the featured snippet — then the AI's sources that are NOT in the top 10, appended with rank 0.
 *
 * That tail is the interesting case and it was invisible before: a domain Google's AI quotes but
 * does not rank is a page worth reading, and a gap worth writing into.
 */
function rankedResults(s: SerpInsight, own: Set<string>): Result[] {
  const aiDomains = new Set((s.ai_overview?.sources ?? []).map(x => bareHost(x.domain)).filter(Boolean))
  const snippet   = s.featured_snippet ? bareHost(s.featured_snippet.domain) : ''

  const out: Result[] = []
  const seen = new Set<string>()

  for (const o of [...s.organic].sort((a, b) => a.rank - b.rank)) {
    const key = bareHost(o.domain)
    if (!key || seen.has(key)) continue      // one line per domain, deepest rank wins
    seen.add(key)
    const roles: Role[] = []
    if (snippet && key === snippet) roles.push('Answer box')
    if (aiDomains.has(key))         roles.push('Quoted by AI')
    out.push({ rank: o.rank, domain: o.domain, url: o.url, title: '', isOwn: own.has(key), roles })
  }

  // The featured snippet's holder can sit outside the top 10 too.
  if (snippet && !seen.has(snippet) && s.featured_snippet) {
    seen.add(snippet)
    out.push({
      rank: 0, domain: s.featured_snippet.domain, url: s.featured_snippet.url,
      title: s.featured_snippet.title, isOwn: own.has(snippet),
      roles: aiDomains.has(snippet) ? ['Answer box', 'Quoted by AI'] : ['Answer box'],
    })
  }

  for (const src of s.ai_overview?.sources ?? []) {
    const key = bareHost(src.domain)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push({ rank: 0, domain: src.domain, url: src.url, title: src.title, isOwn: own.has(key), roles: ['Quoted by AI'] })
  }

  return out
}

/** "https://www.example.com/x" and "example.com" both key on "example.com". */
function bareHost(v: string | null | undefined): string {
  return String(v ?? '').trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '')
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

/** One domain per line: its position, who it is, and every role it plays on this page. */
function ResultList({ rows }: { rows: Result[] }) {
  if (rows.length === 0) return null
  return (
    <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
      {rows.map(r => (
        <li key={`${r.rank}-${r.domain}`} style={{
          display: 'grid', gridTemplateColumns: '2.25rem minmax(0, 1fr)', alignItems: 'baseline',
          gap: 4, padding: '3px 0',
        }}>
          <span style={{
            fontSize: '0.72rem', fontVariantNumeric: 'tabular-nums',
            color: r.isOwn ? 'var(--green)' : 'var(--text-faint)',
            fontWeight: r.isOwn ? 700 : 400,
          }}>
            {r.rank > 0 ? `#${r.rank}` : '—'}
          </span>
          <span style={{ minWidth: 0 }}>
            <Domain source={r} strong={r.isOwn} />
            {r.roles.map(role => (
              <span key={role} className={`badge ${ROLE_TONE[role]}`} style={{ marginLeft: 6 }} title={ROLE_TITLE[role]}>{role}</span>
            ))}
            {r.title && (
              <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-faint)', lineHeight: 1.35, overflowWrap: 'anywhere' }}>{r.title}</span>
            )}
          </span>
        </li>
      ))}
    </ol>
  )
}

function ZoneHeading({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
      color: 'var(--text-faint)', marginBottom: 6,
    }}>
      {children}
    </div>
  )
}

function Domain({ source, strong }: { source: Pick<Result | SerpSource, 'domain' | 'url'>; strong?: boolean }) {
  const style = {
    fontSize: '0.8125rem', color: strong ? 'var(--green)' : 'var(--text-primary)',
    fontWeight: strong ? 600 : 400, textDecoration: 'none', overflowWrap: 'anywhere' as const,
  }
  const href = source.url || (source.domain ? `https://${source.domain}` : '')
  return href
    ? <a href={href} target="_blank" rel="noopener noreferrer" style={style}>{source.domain}</a>
    : <span style={style}>{source.domain}</span>
}
