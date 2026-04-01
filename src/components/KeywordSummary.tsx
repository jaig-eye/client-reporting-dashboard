// KeywordSummary — server component showing keyword intelligence for a date range.
// Receives pre-aggregated keyword data from the dashboard page server component.

export interface AggKeyword {
  text: string
  impressions: number
  clicks: number
  conversions: number
  spend: number
}

interface Props {
  keywords: AggKeyword[]
  negativeCount: number
  conversionLabel?: string
}

function fmt$(n: number) {
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`
}

export default function KeywordSummary({ keywords, negativeCount, conversionLabel = 'Leads' }: Props) {
  if (!keywords.length) return null

  const total       = keywords.length
  const withImpr    = keywords.filter(k => k.impressions > 0).length
  const withClicks  = keywords.filter(k => k.clicks > 0).length
  const topConv     = keywords.filter(k => k.conversions > 0).sort((a, b) => b.conversions - a.conversions).slice(0, 10)
  const nonConv     = keywords.filter(k => k.conversions === 0 && k.spend > 0).sort((a, b) => b.spend - a.spend)
  const wastedSpend = nonConv.reduce((s, k) => s + k.spend, 0)
  const topBySpend  = [...keywords].sort((a, b) => b.spend - a.spend).slice(0, 10)
  const maxSpend    = topBySpend[0]?.spend || 1

  return (
    <div className="space-y-4">

      {/* Summary stats */}
      <div className="card p-5">
        <div className="flex flex-wrap items-start gap-8">
          <div className="flex-shrink-0">
            <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>
              Total Active
            </p>
            <p className="text-4xl font-bold" style={{ color: 'var(--text-primary)' }}>{total}</p>
          </div>
          <div className="flex-1 space-y-3 pt-1" style={{ minWidth: 220 }}>
            <StatBar label="Keywords have impressions" pct={withImpr / total} />
            <StatBar label="Keywords have clicks"      pct={withClicks / total} />
          </div>
          {negativeCount > 0 && (
            <div className="flex-shrink-0">
              <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>
                Negative Keywords
              </p>
              <p className="text-4xl font-bold" style={{ color: 'var(--text-primary)' }}>{negativeCount}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>active exclusions</p>
            </div>
          )}
        </div>
      </div>

      {/* Top converting + non-converting */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {topConv.length > 0 && (
          <div className="card p-5">
            <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--text-primary)' }}>
              Top Converting Keywords
            </p>
            <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
              {topConv.length} keyword{topConv.length !== 1 ? 's' : ''} driving {conversionLabel.toLowerCase()}
            </p>
            <div className="flex flex-wrap gap-2">
              {topConv.map((k, i) => (
                <span
                  key={i}
                  title={`${k.conversions.toFixed(0)} ${conversionLabel.toLowerCase()}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '3px 10px', borderRadius: 99,
                    fontSize: '0.75rem', fontWeight: 500,
                    background: 'var(--green-subtle)', color: 'var(--green)',
                    border: '1px solid #bbf7d0',
                  }}
                >
                  {k.text}
                  <span style={{ fontSize: '0.68rem', opacity: 0.65, fontWeight: 700 }}>
                    {k.conversions.toFixed(0)}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}

        {nonConv.length > 0 && (
          <div className="card p-5">
            <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--text-primary)' }}>
              Non-Converting Keywords
            </p>
            <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
              {nonConv.length} keywords · {fmt$(wastedSpend)} in unconverted spend
            </p>
            <div className="flex flex-wrap gap-2">
              {nonConv.slice(0, 10).map((k, i) => (
                <span
                  key={i}
                  title={`${fmt$(k.spend)} spend, 0 conversions`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '3px 10px', borderRadius: 99,
                    fontSize: '0.75rem', fontWeight: 500,
                    background: 'var(--red-subtle)', color: 'var(--red)',
                    border: '1px solid #fecaca',
                  }}
                >
                  {k.text}
                  <span style={{ fontSize: '0.68rem', opacity: 0.65, fontWeight: 700 }}>
                    {fmt$(k.spend)}
                  </span>
                </span>
              ))}
              {nonConv.length > 10 && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)', padding: '3px 6px' }}>
                  +{nonConv.length - 10} more
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Top keywords by spend — horizontal bar chart */}
      <div className="card p-5">
        <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          Top Keywords by Spend
        </p>
        <div className="space-y-2">
          {topBySpend.map((k, i) => (
            <div key={i} className="flex items-center gap-3">
              <p
                className="text-xs truncate flex-shrink-0"
                style={{ color: 'var(--text-secondary)', width: '38%' }}
                title={k.text}
              >
                {k.text}
              </p>
              <div className="flex-1 h-5 rounded overflow-hidden" style={{ background: 'var(--bg-subtle)' }}>
                <div
                  className="h-full rounded flex items-center justify-end pr-2 transition-all duration-500"
                  style={{
                    width: `${Math.max(8, (k.spend / maxSpend) * 100)}%`,
                    background: 'var(--blue)',
                  }}
                >
                  <span className="text-xs font-semibold text-white">{fmt$(k.spend)}</span>
                </div>
              </div>
              {k.conversions > 0 && (
                <span className="text-xs flex-shrink-0" style={{ color: 'var(--green)', minWidth: 32, textAlign: 'right' }}>
                  {k.conversions.toFixed(0)}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}

function StatBar({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="flex items-center gap-3">
      <p className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)', width: 190 }}>{label}</p>
      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-subtle)' }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${(pct * 100).toFixed(1)}%`, background: 'var(--blue)' }}
        />
      </div>
      <span className="text-xs font-semibold flex-shrink-0" style={{ color: 'var(--text-secondary)', minWidth: 48, textAlign: 'right' }}>
        {(pct * 100).toFixed(2)}%
      </span>
    </div>
  )
}
