// GscInsightsPanel — server component shown in the admin client Content tab.
// Displays the top GSC pages with improvement potential for this client:
// high impressions, low CTR, high average position (sitting just off page 1).
// Helps the admin understand what content gaps exist before generating topics.

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
  rows: GscInsightRow[]
}

export default function GscInsightsPanel({ rows }: Props) {
  return (
    <div className="card p-6 mb-6">
      <div className="mb-4">
        <h3 className="section-title">GSC Opportunities — Pages to Improve</h3>
        <p className="section-desc">
          Pages with high impressions but weak click-through rates or positions beyond 5 — good candidates for new supporting content or on-page optimisation.
        </p>
      </div>

      {rows.length === 0 ? (
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          No GSC data yet for this client. Connect Google Search Console and run a sync to see opportunities.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table" style={{ minWidth: 520 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Query</th>
                <th style={{ textAlign: 'left' }}>Page</th>
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
      )}
    </div>
  )
}
