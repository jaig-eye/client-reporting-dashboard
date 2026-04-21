// GscInsightsPanel — server component, right column of the admin content tab.
// Keyword-first design: each row shows the target keyword, ranking page (internal link target),
// and three metric chips (impressions, position, CTR) for content creation decisions.

function fmtImpr(n: number | null): string {
  if (!n) return '—'
  if (n >= 10000) return `${Math.round(n / 1000)}k`
  if (n >= 1000)  return `${(n / 1000).toFixed(1)}k`
  return n.toLocaleString()
}

function fmtPct(n: number | null): string {
  if (n === null || n === undefined) return '—'
  return `${(n * 100).toFixed(1)}%`
}

function fmtPos(n: number | null): string {
  if (n === null || n === undefined) return '—'
  return n.toFixed(1)
}

function posColor(pos: number | null): string {
  if (!pos) return 'var(--text-muted)'
  if (pos <= 5)  return '#16a34a'
  if (pos <= 10) return '#d97706'
  return 'var(--text-muted)'
}

function posBackground(pos: number | null): string {
  if (!pos) return 'var(--bg-muted)'
  if (pos <= 5)  return '#dcfce7'
  if (pos <= 10) return '#fef3c7'
  return 'var(--bg-muted)'
}

function truncatePage(url: string, max = 42): string {
  try {
    const u = new URL(url)
    const path = u.pathname + (u.search || '')
    return path.length > max ? path.slice(0, max) + '…' : path
  } catch {
    return url.length > max ? url.slice(0, max) + '…' : url
  }
}

export interface GscInsightRow {
  page:        string | null
  query:       string | null
  impressions: number | null
  ctr:         number | null
  position:    number | null
}

interface SectionProps {
  badge:       string
  badgeColor:  string
  badgeBg:     string
  posRange:    string
  subtitle:    string
  contentHint: string
  rows:        GscInsightRow[]
}

function KeywordRow({ r }: { r: GscInsightRow }) {
  const lowCtr = (r.ctr ?? 1) < 0.03
  return (
    <div style={{
      display:        'flex',
      alignItems:     'flex-start',
      justifyContent: 'space-between',
      gap:            '0.75rem',
      padding:        '0.625rem 0.875rem',
      borderRadius:   10,
      background:     'var(--bg-subtle, #f8f9fa)',
      marginBottom:   4,
    }}>
      {/* Left: keyword + ranking page */}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontWeight:   600,
          fontSize:     '0.8125rem',
          color:        'var(--text-primary)',
          whiteSpace:   'nowrap',
          overflow:     'hidden',
          textOverflow: 'ellipsis',
        }} title={r.query ?? ''}>
          {r.query || '—'}
        </div>
        {r.page ? (
          <a
            href={r.page}
            target="_blank"
            rel="noopener noreferrer"
            title={r.page}
            style={{
              fontSize:     '0.7rem',
              color:        'var(--blue, #2563eb)',
              display:      'block',
              whiteSpace:   'nowrap',
              overflow:     'hidden',
              textOverflow: 'ellipsis',
              marginTop:    2,
              textDecoration: 'none',
            }}
          >
            {truncatePage(r.page)}
          </a>
        ) : (
          <span style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>—</span>
        )}
      </div>

      {/* Right: metric chips */}
      <div style={{ display: 'flex', gap: '0.3rem', flexShrink: 0, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {/* Impressions */}
        <span style={{
          fontSize:    '0.7rem',
          fontWeight:  500,
          padding:     '2px 7px',
          borderRadius: 999,
          background:  'var(--bg-muted, #f3f4f6)',
          color:       'var(--text-secondary)',
          whiteSpace:  'nowrap',
        }}>
          {fmtImpr(r.impressions)} impr
        </span>

        {/* Position */}
        <span style={{
          fontSize:    '0.7rem',
          fontWeight:  600,
          padding:     '2px 7px',
          borderRadius: 999,
          background:  posBackground(r.position),
          color:       posColor(r.position),
          whiteSpace:  'nowrap',
        }}>
          pos {fmtPos(r.position)}
        </span>

        {/* CTR */}
        <span style={{
          fontSize:    '0.7rem',
          fontWeight:  500,
          padding:     '2px 7px',
          borderRadius: 999,
          background:  lowCtr ? '#fef3c7' : 'var(--bg-muted, #f3f4f6)',
          color:       lowCtr ? '#92400e' : 'var(--text-muted)',
          whiteSpace:  'nowrap',
        }}>
          {fmtPct(r.ctr)} CTR
        </span>
      </div>
    </div>
  )
}

function InsightSection({ badge, badgeColor, badgeBg, posRange, subtitle, contentHint, rows }: SectionProps) {
  if (rows.length === 0) return null
  return (
    <div style={{ marginBottom: '1.75rem' }}>
      {/* Header row: badge + position range */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.375rem' }}>
        <span style={{
          display:         'inline-block',
          padding:         '0.15rem 0.65rem',
          borderRadius:    999,
          fontSize:        '0.65rem',
          fontWeight:      700,
          letterSpacing:   '0.06em',
          textTransform:   'uppercase',
          background:      badgeBg,
          color:           badgeColor,
        }}>
          {badge}
        </span>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)', fontWeight: 500 }}>
          {posRange}
        </span>
      </div>

      {/* Strategy description */}
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.15rem', lineHeight: 1.45 }}>
        {subtitle}
      </p>
      <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', marginBottom: '0.75rem', lineHeight: 1.4 }}>
        {contentHint}
      </p>

      {/* Rows */}
      {rows.map((r, i) => <KeywordRow key={i} r={r} />)}
    </div>
  )
}

export default function GscInsightsPanel({ quickWins, growth, lowCtr }: {
  quickWins: GscInsightRow[]
  growth:    GscInsightRow[]
  lowCtr:    GscInsightRow[]
}) {
  const isEmpty = quickWins.length === 0 && growth.length === 0 && lowCtr.length === 0

  return (
    <div className="card p-6 mb-6">
      {/* Panel header */}
      <div style={{ marginBottom: '1.25rem' }}>
        <h3 className="section-title">GSC Opportunities</h3>
        <p className="section-desc" style={{ marginBottom: '0.5rem' }}>
          Keyword and page opportunities from Search Console — ranked by search demand.
        </p>
        <div style={{
          display:      'flex',
          gap:          '1rem',
          fontSize:     '0.72rem',
          color:        'var(--text-faint)',
          paddingTop:   '0.5rem',
          borderTop:    '1px solid var(--border)',
        }}>
          <span><strong style={{ color: 'var(--text-muted)' }}>Keyword</strong> → write new content targeting this</span>
          <span><strong style={{ color: 'var(--text-muted)' }}>Page</strong> → link to this from new content</span>
        </div>
      </div>

      {isEmpty ? (
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          No GSC data for this client yet. Connect Google Search Console and run a sync to see opportunities.
        </p>
      ) : (
        <>
          {/* Growth Targets first — best for new article creation */}
          <InsightSection
            badge="Growth Targets"
            badgeColor="#92400e"
            badgeBg="#fef3c7"
            posRange="Pos 10–20"
            subtitle="Site has relevance but no focused page — the strongest signal for a new dedicated article."
            contentHint="Write a new blog post targeting this keyword directly, then internally link to the ranking page."
            rows={growth}
          />
          <InsightSection
            badge="Quick Wins"
            badgeColor="#166534"
            badgeBg="#dcfce7"
            posRange="Pos 5–10"
            subtitle="Nearly page 1 — supporting cluster content can push these into the top 5."
            contentHint="Write adjacent or long-tail articles and link back to the ranking page to strengthen its authority."
            rows={quickWins}
          />
          <InsightSection
            badge="CTR Issues"
            badgeColor="#1e3a8a"
            badgeBg="#dbeafe"
            posRange="Pos 1–5 · low CTR"
            subtitle="Ranking well but few clicks — topic has demand the current page isn't fully capturing."
            contentHint="Create supporting articles for related queries to build topical depth and expand click share."
            rows={lowCtr}
          />
        </>
      )}
    </div>
  )
}
