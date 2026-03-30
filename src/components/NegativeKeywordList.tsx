// NegativeKeywordList — displays negative keywords (campaign or ad-group level)
// Server component — no interactivity needed.

export interface NegativeKeywordRow {
  keyword_id:   string
  keyword_text: string
  match_type:   string | null
  level:        'campaign' | 'adgroup'
}

const MATCH_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  BROAD:  { bg: '#fef2f2', color: '#b91c1c', label: 'Broad'  },
  PHRASE: { bg: '#fff7ed', color: '#c2410c', label: 'Phrase' },
  EXACT:  { bg: '#fdf4ff', color: '#7e22ce', label: 'Exact'  },
}

export default function NegativeKeywordList({ rows, level }: { rows: NegativeKeywordRow[]; level: 'campaign' | 'adgroup' }) {
  const filtered = rows.filter(r => r.level === level)
  if (!filtered.length) return null

  return (
    <div className="flex flex-wrap gap-2">
      {filtered.map(kw => {
        const style = MATCH_STYLE[kw.match_type ?? ''] ?? { bg: '#f1f5f9', color: '#475569', label: kw.match_type ?? '' }
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
