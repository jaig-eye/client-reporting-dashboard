// GscInsightsPanel — server component, right column of the admin content tab.
// Page-grouped design: each card = a core page to support, with all ranking keywords below it.
// Keyword rows = new article targets; page header = internal link destination.

function fmtImpr(n: number | null | undefined): string {
  if (!n) return '—'
  if (n >= 10000) return `${Math.round(n / 1000)}k`
  if (n >= 1000)  return `${(n / 1000).toFixed(1)}k`
  return n.toLocaleString()
}

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return `${(n * 100).toFixed(1)}%`
}

function fmtPos(n: number | null | undefined): string {
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
  if (!pos) return 'var(--bg-muted, #f3f4f6)'
  if (pos <= 5)  return '#dcfce7'
  if (pos <= 10) return '#fef3c7'
  return 'var(--bg-muted, #f3f4f6)'
}

function truncatePath(url: string, max = 48): string {
  try {
    const u = new URL(url)
    const path = u.pathname + (u.search || '')
    return path.length > max ? path.slice(0, max) + '…' : path
  } catch {
    return url.length > max ? url.slice(0, max) + '…' : url
  }
}

export interface GscInsightRow {
  page:              string | null
  query:             string | null
  impressions:       number | null
  ctr:               number | null
  position:          number | null
  recentlyTargeted?: boolean
}

interface PageGroup {
  page:       string | null
  totalImpr:  number
  avgPos:     number
  queries:    GscInsightRow[]
}

function groupByPage(rows: GscInsightRow[]): PageGroup[] {
  const map = new Map<string, PageGroup>()
  for (const r of rows) {
    const key = r.page ?? ''
    const ex  = map.get(key)
    if (ex) {
      ex.totalImpr += r.impressions ?? 0
      ex.queries.push(r)
      ex.avgPos = ex.queries.reduce((s, q) => s + (q.position ?? 0), 0) / ex.queries.length
    } else {
      map.set(key, {
        page:      r.page,
        totalImpr: r.impressions ?? 0,
        avgPos:    r.position ?? 0,
        queries:   [r],
      })
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.totalImpr - a.totalImpr)
}

function QueryRow({ r }: { r: GscInsightRow }) {
  const lowCtr = (r.ctr ?? 1) < 0.03
  return (
    <div style={{
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'space-between',
      gap:            '0.5rem',
      padding:        '0.45rem 0.75rem',
      borderRadius:   7,
      background:     'var(--bg-base, #fff)',
    }}>
      {/* Keyword + recently-targeted badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flex: 1, minWidth: 0 }}>
        <span style={{
          minWidth:     0,
          fontSize:     '0.8rem',
          fontWeight:   500,
          color:        'var(--text-primary)',
          whiteSpace:   'nowrap',
          overflow:     'hidden',
          textOverflow: 'ellipsis',
        }} title={r.query ?? ''}>
          {r.query || '—'}
        </span>
        {r.recentlyTargeted && (
          <span style={{
            flexShrink: 0, fontSize: '0.62rem', color: 'var(--text-faint)',
            padding: '1px 5px', borderRadius: 999, background: 'var(--bg-muted, #f3f4f6)',
            whiteSpace: 'nowrap',
          }}>
            ↩ used
          </span>
        )}
      </div>

      {/* Metrics */}
      <div style={{ display: 'flex', gap: '0.3rem', flexShrink: 0, alignItems: 'center' }}>
        <span style={{
          fontSize: '0.68rem', fontWeight: 500, padding: '2px 6px', borderRadius: 999,
          background: 'var(--bg-muted, #f3f4f6)', color: 'var(--text-muted)',
        }}>
          {fmtImpr(r.impressions)} impr
        </span>
        <span style={{
          fontSize: '0.68rem', fontWeight: 600, padding: '2px 6px', borderRadius: 999,
          background: posBackground(r.position), color: posColor(r.position),
        }}>
          pos {fmtPos(r.position)}
        </span>
        <span style={{
          fontSize: '0.68rem', fontWeight: 500, padding: '2px 6px', borderRadius: 999,
          background: lowCtr ? '#fef3c7' : 'var(--bg-muted, #f3f4f6)',
          color:      lowCtr ? '#92400e' : 'var(--text-muted)',
        }}>
          {fmtPct(r.ctr)} CTR
        </span>
      </div>
    </div>
  )
}

function PageCard({ group }: { group: PageGroup }) {
  const path = group.page ? truncatePath(group.page) : '—'
  const kwCount = group.queries.length
  return (
    <div style={{
      borderRadius: 10,
      border:       '1px solid var(--border, #e5e7eb)',
      overflow:     'hidden',
      marginBottom: '0.625rem',
    }}>
      {/* Page header */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        gap:            '0.75rem',
        padding:        '0.6rem 0.875rem',
        background:     'var(--bg-subtle, #f8f9fa)',
        borderBottom:   '1px solid var(--border, #e5e7eb)',
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>
              Core Page
            </span>
            {group.page ? (
              <a
                href={group.page}
                target="_blank"
                rel="noopener noreferrer"
                title={group.page}
                style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--blue, #2563eb)', textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}
              >
                {path}
              </a>
            ) : (
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)' }}>—</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.3rem', flexShrink: 0, alignItems: 'center' }}>
          <span style={{
            fontSize: '0.68rem', fontWeight: 500, padding: '2px 7px', borderRadius: 999,
            background: 'var(--bg-muted, #f3f4f6)', color: 'var(--text-muted)',
          }}>
            {fmtImpr(group.totalImpr)} impr
          </span>
          <span style={{
            fontSize: '0.68rem', fontWeight: 500, padding: '2px 7px', borderRadius: 999,
            background: 'var(--bg-muted, #f3f4f6)', color: 'var(--text-muted)',
          }}>
            {kwCount} {kwCount === 1 ? 'keyword' : 'keywords'}
          </span>
        </div>
      </div>

      {/* Keyword rows */}
      <div style={{ padding: '0.375rem' }}>
        {group.queries.map((r, i) => <QueryRow key={i} r={r} />)}
      </div>
    </div>
  )
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

function InsightSection({ badge, badgeColor, badgeBg, posRange, subtitle, contentHint, rows }: SectionProps) {
  if (rows.length === 0) return null
  const groups = groupByPage(rows)
  return (
    <div style={{ marginBottom: '1.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.375rem' }}>
        <span style={{
          display: 'inline-block', padding: '0.15rem 0.65rem', borderRadius: 999,
          fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
          background: badgeBg, color: badgeColor,
        }}>
          {badge}
        </span>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)', fontWeight: 500 }}>
          {posRange}
        </span>
      </div>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.15rem', lineHeight: 1.45 }}>
        {subtitle}
      </p>
      <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', marginBottom: '0.75rem', lineHeight: 1.4 }}>
        {contentHint}
      </p>
      {groups.map((g, i) => <PageCard key={i} group={g} />)}
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
      <div style={{ marginBottom: '1.25rem' }}>
        <h3 className="section-title">GSC Opportunities</h3>
        <p className="section-desc" style={{ marginBottom: '0.5rem' }}>
          Core pages grouped with their ranking keywords — use keywords as article targets, pages as internal link destinations.
        </p>
        <div style={{
          display: 'flex', gap: '0.5rem', fontSize: '0.7rem', color: 'var(--text-faint)',
          paddingTop: '0.5rem', borderTop: '1px solid var(--border)',
          flexWrap: 'wrap', rowGap: '0.25rem',
        }}>
          <span><span style={{ fontWeight: 700, color: 'var(--text-muted)' }}>Core Page</span> → internal link destination</span>
          <span style={{ color: 'var(--border)' }}>·</span>
          <span><span style={{ fontWeight: 700, color: 'var(--text-muted)' }}>Keywords</span> → target in new content</span>
          <span style={{ color: 'var(--border)' }}>·</span>
          <span><span style={{ fontWeight: 600, color: 'var(--text-faint)' }}>↩ used</span> = targeted in last 90 days</span>
        </div>
      </div>

      {isEmpty ? (
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          No GSC data yet. Connect Google Search Console and run a sync to see opportunities.
        </p>
      ) : (
        <>
          <InsightSection
            badge="Growth Targets"
            badgeColor="#92400e"
            badgeBg="#fef3c7"
            posRange="Pos 10–20"
            subtitle="Site has relevance but no focused page — strongest signal for a new dedicated article."
            contentHint="Write a new post targeting each keyword, then internally link to the core page."
            rows={growth}
          />
          <InsightSection
            badge="Quick Wins"
            badgeColor="#166534"
            badgeBg="#dcfce7"
            posRange="Pos 5–10"
            subtitle="Nearly page 1 — cluster content on these keywords can push the core page into the top 5."
            contentHint="Write adjacent or long-tail articles and link back to the core page to strengthen its authority."
            rows={quickWins}
          />
          <InsightSection
            badge="CTR Issues"
            badgeColor="#1e3a8a"
            badgeBg="#dbeafe"
            posRange="Pos 1–5 · low CTR"
            subtitle="Ranking well but few clicks — the core page isn't fully capturing demand for these queries."
            contentHint="Create supporting articles for each keyword to build topical depth and expand click share."
            rows={lowCtr}
          />
        </>
      )}
    </div>
  )
}
