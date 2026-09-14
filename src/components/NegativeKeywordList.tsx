// NegativeKeywordList — displays negative keywords (campaign or ad-group level)
// Server component — no interactivity needed.

export interface NegativeKeywordRow {
  keyword_id:   string
  keyword_text: string
  match_type:   string | null
  level:        'campaign' | 'adgroup'
}

const MATCH_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  BROAD:  { bg: 'var(--red-subtle)', color: 'var(--red)', label: 'Broad'  },
  PHRASE: { bg: 'rgba(249,115,22,0.14)', color: '#f97316', label: 'Phrase' },
  EXACT:  { bg: 'rgba(139,92,246,0.12)', color: '#8b5cf6', label: 'Exact'  },
}

export default function NegativeKeywordList({ rows, level }: { rows: NegativeKeywordRow[]; level: 'campaign' | 'adgroup' }) {
  const filtered = rows.filter(r => r.level === level)
  if (!filtered.length) return null

  return (
    <div className="flex flex-wrap gap-2">
      {filtered.map(kw => {
        const style = MATCH_STYLE[kw.match_type ?? ''] ?? { bg: 'var(--bg-subtle)', color: 'var(--text-secondary)', label: kw.match_type ?? '' }
        return (
          <div
            key={kw.keyword_id}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '3px 10px 3px 8px', borderRadius: 99,
              border: '1px solid currentColor', opacity: 0.8,
              background: style.bg, color: style.color,
            }}
          >
            <span style={{ fontSize: '0.85rem', fontWeight: 500, fontFamily: 'monospace' }}>
              −{kw.keyword_text}
            </span>
            {kw.match_type && (
              <span style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.04em', opacity: 0.7 }}>
                {style.label}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
