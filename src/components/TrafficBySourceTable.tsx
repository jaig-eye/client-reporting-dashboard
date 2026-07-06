'use client'

import { useState, useMemo } from 'react'

type SourceRow = {
  source?: string | null
  medium?: string | null
  campaign?: string | null
  sessions?: number
  conversions?: number
  engaged_sessions?: number
}

function fmtNum(n: number) { return n.toLocaleString() }
function fmtPct(n: number) { return `${(n * 100).toFixed(1)}%` }

export default function TrafficBySourceTable({ rows }: { rows: SourceRow[] }) {
  const [sourceFilter,   setSourceFilter]   = useState('')
  const [mediumFilter,   setMediumFilter]   = useState('')
  const [campaignFilter, setCampaignFilter] = useState('')

  const sources   = useMemo(() => Array.from(new Set(rows.map(r => r.source   ?? '(direct)'))).sort(), [rows])
  const mediums   = useMemo(() => Array.from(new Set(rows.map(r => r.medium   ?? '(none)'))).sort(),   [rows])
  const campaigns = useMemo(() => Array.from(new Set(rows.map(r => r.campaign ?? '(not set)'))).sort(), [rows])

  const filtered = useMemo(() => {
    return rows
      .filter(r => !sourceFilter   || (r.source   ?? '(direct)') === sourceFilter)
      .filter(r => !mediumFilter   || (r.medium   ?? '(none)')   === mediumFilter)
      .filter(r => !campaignFilter || (r.campaign ?? '(not set)') === campaignFilter)
      .slice(0, 20)
  }, [rows, sourceFilter, mediumFilter, campaignFilter])

  const totals = useMemo(() => {
    const sessions         = filtered.reduce((s, r) => s + (r.sessions         ?? 0), 0)
    const engaged_sessions = filtered.reduce((s, r) => s + (r.engaged_sessions ?? 0), 0)
    const conversions      = filtered.reduce((s, r) => s + (r.conversions      ?? 0), 0)
    const engRate = sessions > 0 ? engaged_sessions / sessions : 0
    return { sessions, engaged_sessions, conversions, engRate }
  }, [filtered])

  // Count total matching rows (before the 20-row cap) for the count label
  const matchCount = useMemo(() => {
    return rows
      .filter(r => !sourceFilter   || (r.source   ?? '(direct)') === sourceFilter)
      .filter(r => !mediumFilter   || (r.medium   ?? '(none)')   === mediumFilter)
      .filter(r => !campaignFilter || (r.campaign ?? '(not set)') === campaignFilter)
      .length
  }, [rows, sourceFilter, mediumFilter, campaignFilter])

  const hasFilters = sourceFilter || mediumFilter || campaignFilter

  if (rows.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
        No UTM/source data synced yet — run a sync to populate.
      </p>
    )
  }

  const selectStyle: React.CSSProperties = {
    fontSize: '0.8rem',
    padding: '0.3rem 0.6rem',
    border: '1px solid var(--border)',
    borderRadius: '0.375rem',
    background: 'var(--bg-base)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
  }

  return (
    <div>
      {/* Filter controls */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} style={selectStyle}>
          <option value="">All Sources</option>
          {sources.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={mediumFilter} onChange={e => setMediumFilter(e.target.value)} style={selectStyle}>
          <option value="">All Mediums</option>
          {mediums.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={campaignFilter} onChange={e => setCampaignFilter(e.target.value)} style={selectStyle}>
          <option value="">All Campaigns</option>
          {campaigns.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {hasFilters && (
          <button
            onClick={() => { setSourceFilter(''); setMediumFilter(''); setCampaignFilter('') }}
            style={{ ...selectStyle, border: 'none', background: 'transparent', color: 'var(--text-muted)', textDecoration: 'underline', padding: '0.3rem 0.25rem' }}
          >
            Clear
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="data-table" style={{ minWidth: 600 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Source</th>
              <th style={{ textAlign: 'left' }}>Medium</th>
              <th style={{ textAlign: 'left' }}>Campaign</th>
              <th style={{ textAlign: 'right' }}>Sessions</th>
              <th style={{ textAlign: 'right' }}>Engaged</th>
              <th style={{ textAlign: 'right' }}>Eng. Rate</th>
              <th style={{ textAlign: 'right' }}>Conversions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => {
              const engRate = (r.sessions ?? 0) > 0 ? (r.engaged_sessions ?? 0) / (r.sessions ?? 0) : 0
              const showCampaign = r.campaign !== '(not set)' && r.campaign !== '' && r.campaign != null
              return (
                <tr key={i}>
                  <td style={{ fontWeight: 500 }}>{r.source ?? '(direct)'}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{r.medium ?? '(none)'}</td>
                  <td style={{ color: 'var(--text-faint)', fontSize: '0.8125rem' }}>{showCampaign ? r.campaign : '—'}</td>
                  <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtNum(r.sessions ?? 0)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtNum(r.engaged_sessions ?? 0)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtPct(engRate)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{(r.conversions ?? 0) > 0 ? fmtNum(r.conversions ?? 0) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr style={{ fontWeight: 600, borderTop: '2px solid var(--border)', background: 'var(--bg-subtle)' }}>
                <td style={{ color: 'var(--text-primary)' }}>Total</td>
                <td style={{ color: 'var(--text-faint)' }}>—</td>
                <td style={{ color: 'var(--text-faint)' }}>—</td>
                <td style={{ textAlign: 'right' }}>{fmtNum(totals.sessions)}</td>
                <td style={{ textAlign: 'right' }}>{fmtNum(totals.engaged_sessions)}</td>
                <td style={{ textAlign: 'right' }}>{fmtPct(totals.engRate)}</td>
                <td style={{ textAlign: 'right' }}>{totals.conversions > 0 ? fmtNum(totals.conversions) : '—'}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Row count label */}
      {(matchCount > 20 || hasFilters) && (
        <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)', marginTop: 8 }}>
          {hasFilters && matchCount > 20
            ? `Showing top 20 of ${matchCount} matching rows`
            : hasFilters
            ? `${matchCount} matching row${matchCount !== 1 ? 's' : ''}`
            : `Showing top 20 of ${rows.length} rows`}
        </p>
      )}
    </div>
  )
}
