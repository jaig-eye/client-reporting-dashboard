'use client'

import { useState } from 'react'

type SortDir = 'asc' | 'desc'

function expectedCtrFloor(pos: number): number {
  if (pos <= 1)  return 0.20
  if (pos <= 2)  return 0.10
  if (pos <= 3)  return 0.07
  if (pos <= 5)  return 0.04
  if (pos <= 10) return 0.02
  return 0
}

// ─── Queries table ──────────────────────────────────────────────────────────

export interface GscQueryRow {
  query:         string
  clicks:        number
  impressions:   number
  ctr:           number
  position:      number
  positionDelta: number | null
}

type QuerySortCol = 'clicks' | 'impressions' | 'ctr' | 'position' | 'positionDelta'

export function GscQueriesTable({
  rows,
  showCompare,
}: {
  rows:        GscQueryRow[]
  showCompare: boolean
}) {
  const [sort, setSort] = useState<{ col: QuerySortCol; dir: SortDir }>({ col: 'clicks', dir: 'desc' })

  function toggle(col: QuerySortCol) {
    setSort(s => s.col === col ? { col, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { col, dir: 'desc' })
  }

  const sorted = [...rows].sort((a, b) => {
    const v = sort.dir === 'asc' ? 1 : -1
    const av = a[sort.col] ?? (sort.dir === 'asc' ? Infinity : -Infinity)
    const bv = b[sort.col] ?? (sort.dir === 'asc' ? Infinity : -Infinity)
    return (av - bv) * v
  })

  function Hdr({ col, label, align = 'right' }: { col: QuerySortCol; label: string; align?: 'left' | 'right' }) {
    const active = sort.col === col
    return (
      <th style={{ textAlign: align }}>
        <button
          onClick={() => toggle(col)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            fontSize: 'inherit', fontWeight: 'inherit', color: active ? 'var(--text-primary)' : 'inherit',
            display: 'inline-flex', alignItems: 'center', gap: 3,
          }}
        >
          {label}
          {active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : <span style={{ opacity: 0.35 }}> ▼</span>}
        </button>
      </th>
    )
  }

  return (
    <table className="data-table" style={{ minWidth: 520 }}>
      <thead>
        <tr>
          <th style={{ textAlign: 'left' }}>Query</th>
          <Hdr col="clicks"      label="Clicks" />
          <Hdr col="impressions" label="Impressions" />
          <Hdr col="ctr"         label="CTR" />
          <Hdr col="position"    label="Avg. Position" />
          {showCompare && <Hdr col="positionDelta" label="Change" />}
        </tr>
      </thead>
      <tbody>
        {sorted.map((q, i) => (
          <tr key={i}>
            <td style={{ fontWeight: 500, color: 'var(--text-secondary)', maxWidth: 320 }}>
              <span className="block truncate" title={q.query}>{q.query}</span>
            </td>
            <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{q.clicks.toLocaleString()}</td>
            <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{q.impressions.toLocaleString()}</td>
            <td style={{ textAlign: 'right', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {(q.ctr * 100).toFixed(2)}%
              {q.position <= 10 && q.ctr < expectedCtrFloor(q.position) * 0.6 && (
                <span
                  title={`Expected ~${(expectedCtrFloor(q.position) * 100).toFixed(0)}%+ for pos ${q.position.toFixed(1)}`}
                  style={{
                    marginLeft: 5, fontSize: '0.62rem', fontWeight: 600, padding: '1px 5px',
                    borderRadius: 999, background: '#fef3c7', color: '#92400e', cursor: 'default',
                  }}
                >
                  Low CTR
                </span>
              )}
            </td>
            <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
              <span style={{
                color: q.position <= 3 ? 'var(--green)' : q.position <= 10 ? '#d97706' : 'var(--text-muted)',
                fontWeight: q.position <= 10 ? 600 : 400,
              }}>
                {q.position.toFixed(1)}
              </span>
            </td>
            {showCompare && (
              <td style={{ textAlign: 'right' }}>
                {q.positionDelta != null && Math.abs(q.positionDelta) >= 0.05 ? (
                  <span style={{ color: q.positionDelta < 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                    {q.positionDelta < 0 ? '▲' : '▼'} {Math.abs(q.positionDelta).toFixed(1)}
                  </span>
                ) : (
                  <span style={{ color: 'var(--text-faint)' }}>—</span>
                )}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ─── Pages table ─────────────────────────────────────────────────────────────

export interface GscPageRow {
  page:           string
  clicks:         number
  impressions:    number
  ctr:            number
  position:       number
  positionDelta?: number
}

type PageSortCol = 'clicks' | 'impressions' | 'ctr' | 'position' | 'positionDelta'

function truncateUrl(url: string, max = 60) {
  try {
    const u    = new URL(url)
    const path = u.pathname + (u.search || '')
    return path.length > max ? path.slice(0, max) + '…' : path
  } catch {
    return url.length > max ? url.slice(0, max) + '…' : url
  }
}

export function GscPagesTable({ rows, showCompare }: { rows: GscPageRow[]; showCompare?: boolean }) {
  const [sort, setSort] = useState<{ col: PageSortCol; dir: SortDir }>({ col: 'clicks', dir: 'desc' })

  function toggle(col: PageSortCol) {
    setSort(s => s.col === col ? { col, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { col, dir: 'desc' })
  }

  const sorted = [...rows].sort((a, b) => {
    const v  = sort.dir === 'asc' ? 1 : -1
    const av = a[sort.col] ?? 0
    const bv = b[sort.col] ?? 0
    return (Number(av) - Number(bv)) * v
  })

  function Hdr({ col, label }: { col: PageSortCol; label: string }) {
    const active = sort.col === col
    return (
      <th style={{ textAlign: 'right' }}>
        <button
          onClick={() => toggle(col)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            fontSize: 'inherit', fontWeight: 'inherit', color: active ? 'var(--text-primary)' : 'inherit',
            display: 'inline-flex', alignItems: 'center', gap: 3,
          }}
        >
          {label}
          {active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : <span style={{ opacity: 0.35 }}> ▼</span>}
        </button>
      </th>
    )
  }

  return (
    <table className="data-table" style={{ minWidth: 520 }}>
      <thead>
        <tr>
          <th style={{ textAlign: 'left' }}>Page</th>
          <Hdr col="clicks"      label="Clicks" />
          <Hdr col="impressions" label="Impressions" />
          <Hdr col="ctr"         label="CTR" />
          <Hdr col="position"    label="Avg. Position" />
          {showCompare && <Hdr col="positionDelta" label="Change" />}
        </tr>
      </thead>
      <tbody>
        {sorted.map((p, i) => (
          <tr key={i}>
            <td style={{ fontWeight: 500, color: 'var(--text-secondary)', maxWidth: 320 }}>
              <a
                href={p.page}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline block truncate"
                style={{ color: 'var(--blue)' }}
                title={p.page}
              >
                {truncateUrl(p.page)}
              </a>
            </td>
            <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{p.clicks.toLocaleString()}</td>
            <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{p.impressions.toLocaleString()}</td>
            <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{(p.ctr * 100).toFixed(2)}%</td>
            <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
              <span style={{
                color: p.position <= 3 ? 'var(--green)' : p.position <= 10 ? '#d97706' : 'var(--text-muted)',
                fontWeight: p.position <= 10 ? 600 : 400,
              }}>
                {p.position.toFixed(1)}
              </span>
            </td>
            {showCompare && (
              <td style={{ textAlign: 'right' }}>
                {p.positionDelta !== undefined && Math.abs(p.positionDelta) >= 0.05
                  ? <span style={{ fontWeight: 600, fontSize: '0.75rem',
                      color: p.positionDelta < 0 ? 'var(--green)' : 'var(--red)' }}>
                      {p.positionDelta < 0 ? '▲' : '▼'}{Math.abs(p.positionDelta).toFixed(1)}
                    </span>
                  : <span style={{ color: 'var(--text-faint)', fontSize: '0.75rem' }}>—</span>
                }
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
