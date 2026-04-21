// GscInsightsPanel — server component shown in the admin client Content tab.
// Three tiered sections: Quick Wins, Growth Targets, CTR Issues.
// Purpose: content generation strategy only — queries = keyword targets, pages = internal link destinations.

function fmtNum(n: number) { return n.toLocaleString() }
function fmtPct(n: number) { return `${(n * 100).toFixed(2)}%` }
function fmtPos(n: number) { return n.toFixed(1) }
function truncatePage(url: string, max = 55): string {
  try {
    const u = new URL(url)
    const path = u.pathname + (u.search || '')
    return path.length > max ? path.slice(0, max) + '…' : path
  } catch {
    return url.length > max ? url.slice(0, max) + '…' : url
  }
}

export interface GscInsightRow {
  page: string | null
  query: string | null
  impressions: number | null
  ctr: number | null
  position: number | null
}

interface Props {
  quickWins: GscInsightRow[]
  growth:    GscInsightRow[]
  lowCtr:    GscInsightRow[]
}

interface SectionProps {
  badge:    string
  badgeColor: string
  subtitle: string
  rows:     GscInsightRow[]
}

function InsightSection({ badge, badgeColor, subtitle, rows }: SectionProps) {
  if (rows.length === 0) return null
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
        <span style={{
          display: 'inline-block',
          padding: '0.15rem 0.6rem',
          borderRadius: 9999,
          fontSize: '0.7rem',
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          background: badgeColor,
          color: '#fff',
        }}>
          {badge}
        </span>
      </div>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
        {subtitle}
      </p>
      <div className="overflow-x-auto">
        <table className="data-table" style={{ minWidth: 520 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Query <span style={{ fontWeight: 400, opacity: 0.6 }}>→ keyword target</span></th>
              <th style={{ textAlign: 'left' }}>Page <span style={{ fontWeight: 400, opacity: 0.6 }}>→ link to this</span></th>
              <th style={{ textAlign: 'right' }}>Impressions</th>
              <th style={{ textAlign: 'right' }}>CTR</th>
              <th style={{ textAlign: 'right' }}>Avg. Position</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 500, color: 'var(--text-secondary)', maxWidth: 200 }}>
                  <span className="block truncate" title={r.query ?? ''}>{r.query || '—'}</span>
                </td>
                <td style={{ color: 'var(--text-muted)', maxWidth: 260 }}>
                  {r.page ? (
                    <a
                      href={r.page}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline block truncate"
                      style={{ color: 'var(--blue)' }}
                      title={r.page}
                    >
                      {truncatePage(r.page)}
                    </a>
                  ) : '—'}
                </td>
                <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                  {fmtNum(r.impressions ?? 0)}
                </td>
                <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                  {fmtPct(r.ctr ?? 0)}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <span style={{
                    color: (r.position ?? 99) <= 10 ? '#d97706' : 'var(--text-muted)',
                    fontWeight: (r.position ?? 99) <= 10 ? 600 : 400,
                  }}>
                    {fmtPos(r.position ?? 0)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function GscInsightsPanel({ quickWins, growth, lowCtr }: Props) {
  const isEmpty = quickWins.length === 0 && growth.length === 0 && lowCtr.length === 0

  return (
    <div className="card p-6 mb-6">
      <div className="mb-4">
        <h3 className="section-title">GSC Opportunities</h3>
        <p className="section-desc">
          Keyword and page opportunities from Search Console to guide new content creation — use queries as target keywords and pages as internal link destinations in new articles.
        </p>
      </div>

      {isEmpty ? (
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          No GSC opportunities found for this client. Connect Google Search Console and run a sync to see insights.
        </p>
      ) : (
        <>
          <InsightSection
            badge="Quick Wins"
            badgeColor="var(--green, #16a34a)"
            subtitle="Pos 5–10 · Nearly page 1 — write new content targeting adjacent or long-tail versions of these queries, then internally link to the ranking page to reinforce it."
            rows={quickWins}
          />
          <InsightSection
            badge="Growth Targets"
            badgeColor="#d97706"
            subtitle="Pos 10–20 · Off page 1 — create new articles targeting these queries or related keywords, with a strong internal link back to the existing ranking page."
            rows={growth}
          />
          <InsightSection
            badge="CTR Issues"
            badgeColor="var(--blue, #2563eb)"
            subtitle="Pos 1–5 · High impressions, low CTR — write supporting content for related queries to broaden topic authority and drive more click share to the ranking page."
            rows={lowCtr}
          />
        </>
      )}
    </div>
  )
}
