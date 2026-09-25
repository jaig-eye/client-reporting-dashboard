'use client'

import type { SerpInsightRow } from '@/lib/content/serpInsights'

/**
 * "What Google shows" — the talking points the writer is handed, made visible.
 *
 * One row per keyword that has a stored SERP snapshot: a post's target keyword (captured when
 * the post was written) or a starting keyword (captured when research ran). The summary line
 * says what was on the page; opening it shows the questions, the sources and the map pack.
 */
export default function SerpInsightsSection({ rows, loading, search }: {
  rows:    SerpInsightRow[] | null
  loading: boolean
  search:  string
}) {
  const all = rows ?? []
  const filtered = all.filter(r => !search || r.keyword.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="card p-5" style={{ marginBottom: 16 }}>
      <div style={{ marginBottom: 10 }}>
        <span style={{
          display: 'inline-block', padding: '2px 10px', borderRadius: 999,
          fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
          background: '#fef3c7', color: '#92400e',
        }}>
          What Google shows
        </span>
        <span style={{ marginLeft: 8, fontSize: '0.72rem', color: 'var(--text-faint)' }}>DataForSEO</span>
        {all.length > 0 && (
          <span style={{ marginLeft: 8, fontSize: '0.72rem', color: 'var(--text-faint)' }}>
            {filtered.length} search{filtered.length === 1 ? '' : 'es'}
          </span>
        )}
      </div>
      <p style={{ margin: '0 0 10px', fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
        What Google actually shows for these searches — the questions people also ask, who its AI answer
        quotes, and who is in the map pack. The writer is handed this as talking points; it does not
        change how a post is written. Captured when a post is written and when research runs.
      </p>

      {loading ? (
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-faint)' }}>Loading…</p>
      ) : filtered.length === 0 ? (
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {search
            ? `No searches match "${search}".`
            : 'Nothing captured yet. This fills in as posts are written and research runs with DataForSEO connected for this client.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.slice(0, 40).map(r => <InsightRow key={r.keyword} row={r} />)}
          {filtered.length > 40 && (
            <p style={{ margin: '4px 0 0', fontSize: '0.72rem', color: 'var(--text-faint)' }}>Showing the 40 most recent of {filtered.length}.</p>
          )}
        </div>
      )}
    </div>
  )
}

function InsightRow({ row }: { row: SerpInsightRow }) {
  const s = row.insight
  const place = s.location ? s.location.split(',')[0] : null
  const when  = new Date(s.checked_at).toLocaleDateString()
  const aiPresent = s.ai_overview?.present === true
  const hasDetail = s.paa.length > 0 || s.related.length > 0 || (s.ai_overview?.sources.length ?? 0) > 0
    || s.local_pack.length > 0 || s.organic.length > 0 || !!s.featured_snippet

  return (
    <details style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '0.5rem 0.75rem' }}>
      <summary style={{ cursor: hasDetail ? 'pointer' : 'default', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>{row.keyword}</span>
        {s.query && s.query.toLowerCase() !== row.keyword.toLowerCase() && (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }} title="The phrase that was searched; the post's keyword was refined from it">searched as &ldquo;{s.query}&rdquo;</span>
        )}
        {s.ai_overview != null && (
          <Chip tone={aiPresent ? 'green' : 'gray'} title={aiPresent ? 'Google shows an AI answer for this search' : 'No AI answer on this search'}>
            {aiPresent ? 'AI answer' : 'No AI answer'}
          </Chip>
        )}
        {s.local_pack.length > 0 && <Chip tone="blue" title="Businesses in the map pack">Map pack · {s.local_pack.length}</Chip>}
        {s.paa.length > 0 && <Chip tone="gray" title="Questions people also ask">{s.paa.length} question{s.paa.length === 1 ? '' : 's'}</Chip>}
        {s.featured_snippet && <Chip tone="amber" title={`Featured snippet held by ${s.featured_snippet.domain}`}>Featured snippet</Chip>}
        <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
          {row.contentPostId ? 'for a post · ' : ''}{place ? `${place} · ` : ''}{when}
        </span>
      </summary>

      {hasDetail && (
        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, fontSize: '0.78rem' }}>
          {s.paa.length > 0 && (
            <Block label="Questions people also ask">
              <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {s.paa.map(q => <li key={q}>{q}</li>)}
              </ul>
            </Block>
          )}
          {(s.ai_overview?.sources.length ?? 0) > 0 && (
            <Block label="Sources Google's AI answer quotes">
              <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {s.ai_overview?.sources.map((src, i) => (
                  <li key={`${src.domain}-${i}`}>
                    <a href={src.url || `https://${src.domain}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-primary)', textDecoration: 'none' }} title={src.title}>
                      {src.domain}
                    </a>
                    {src.title && <span style={{ color: 'var(--text-faint)' }}> — {src.title}</span>}
                  </li>
                ))}
              </ul>
            </Block>
          )}
          {s.related.length > 0 && (
            <Block label="Related searches">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {s.related.map(r => <span key={r} className="badge badge-gray">{r}</span>)}
              </div>
            </Block>
          )}
          {s.local_pack.length > 0 && (
            <Block label={place ? `Map pack in ${place}` : 'Map pack'}>
              <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {s.local_pack.map((p, i) => (
                  <li key={`${p.title}-${i}`}>
                    {p.domain
                      ? <a href={`https://${p.domain}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-primary)', textDecoration: 'none' }}>{p.title}</a>
                      : <span>{p.title}</span>}
                    {p.rating != null && (
                      <span style={{ color: 'var(--text-faint)' }}> · ★ {p.rating.toFixed(1)}{p.votes != null ? ` (${p.votes.toLocaleString()})` : ''}</span>
                    )}
                  </li>
                ))}
              </ul>
            </Block>
          )}
          {(s.organic.length > 0 || s.featured_snippet) && (
            <Block label="Top results">
              {s.featured_snippet && (
                <p style={{ margin: '0 0 4px', color: 'var(--text-muted)' }}>
                  Featured snippet: <a href={s.featured_snippet.url || `https://${s.featured_snippet.domain}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-primary)', textDecoration: 'none' }}>{s.featured_snippet.domain}</a>
                </p>
              )}
              <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {s.organic.map(o => (
                  <li key={`${o.rank}-${o.domain}`} value={o.rank}>
                    <a href={o.url || `https://${o.domain}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-primary)', textDecoration: 'none' }} title={o.title}>{o.domain}</a>
                  </li>
                ))}
              </ol>
            </Block>
          )}
        </div>
      )}
    </details>
  )
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  )
}

function Chip({ tone, title, children }: { tone: 'green' | 'blue' | 'amber' | 'gray'; title?: string; children: React.ReactNode }) {
  return <span className={`badge badge-${tone}`} title={title}>{children}</span>
}
