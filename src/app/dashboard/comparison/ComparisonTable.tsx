'use client'

// The comparison table itself: collapsible channel groups, a channel and metric filter, and a CSV
// export. Everything here is presentation — the figures are worked out on the server.

import { useMemo, useState } from 'react'
import { CaretDown, ArrowUp, ArrowDown, DownloadSimple } from '@phosphor-icons/react'
import { ConnectorLogo } from '@/components/ConnectorLogo'

import { formatMetric, percentChange, isImprovement, type ComparisonMetric, type ComparisonSection } from './format'
export type { ComparisonMetric, ComparisonSection } from './format'

function ChangePill({ metric }: { metric: ComparisonMetric }) {
  const pct = percentChange(metric.current, metric.previous)
  if (pct == null || Math.abs(pct) < 0.05) {
    return <span className="cmp-pill cmp-pill--flat">—</span>
  }
  // A smaller cost is an improvement, so the arrow and the colour part company.
  const good = isImprovement(pct, metric.lowerIsBetter)
  return (
    <span className={`cmp-pill ${good ? 'cmp-pill--good' : 'cmp-pill--bad'}`}>
      {pct > 0 ? <ArrowUp size={10} weight="bold" aria-hidden /> : <ArrowDown size={10} weight="bold" aria-hidden />}
      {pct > 0 ? '+' : '−'}{Math.abs(pct).toFixed(1)}%
    </span>
  )
}

export default function ComparisonTable({
  sections, currentLabel, previousLabel, clientName,
}: {
  sections: ComparisonSection[]
  currentLabel: string
  previousLabel: string
  clientName: string
}) {
  const [channel, setChannel]   = useState('all')
  const [keyOnly, setKeyOnly]   = useState(true)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const shown = useMemo(() => sections
    .filter(s => channel === 'all' || s.id === channel)
    .map(s => ({ ...s, metrics: keyOnly ? s.metrics.filter(m => m.key) : s.metrics }))
    .filter(s => s.metrics.length > 0),
    [sections, channel, keyOnly])

  function exportCsv() {
    const rows: string[][] = [['Channel', 'Metric', currentLabel, previousLabel, 'Change %']]
    for (const s of shown) {
      for (const m of s.metrics) {
        const pct = percentChange(m.current, m.previous)
        rows.push([s.name, m.label, String(m.current), String(m.previous), pct == null ? '' : pct.toFixed(1)])
      }
    }
    const csv  = rows.map(r => r.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\r\n')
    const url  = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${clientName.replace(/[^\w-]+/g, '-').toLowerCase()}-comparison.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="card cmp-card" aria-labelledby="cmp-title">
      <div className="cmp-head">
        <div>
          <h2 id="cmp-title" className="section-title">Channel performance</h2>
          <p className="section-desc">{currentLabel} compared with {previousLabel}</p>
        </div>
        <div className="cmp-controls">
          <label className="cmp-select">
            <span className="sr-only">Channel</span>
            <select value={channel} onChange={e => setChannel(e.target.value)}>
              <option value="all">All channels</option>
              {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="cmp-select">
            <span className="sr-only">Which metrics</span>
            <select value={keyOnly ? 'key' : 'all'} onChange={e => setKeyOnly(e.target.value === 'key')}>
              <option value="key">Show: key metrics</option>
              <option value="all">Show: every metric</option>
            </select>
          </label>
          <button type="button" className="btn btn-secondary cmp-export" onClick={exportCsv}>
            <DownloadSimple size={14} weight="bold" aria-hidden /> Export
          </button>
        </div>
      </div>

      <div className="table-scroll">
        <table className="data-table cmp-table">
          <thead>
            <tr>
              <th scope="col">Channel / metric</th>
              <th scope="col" className="num">{currentLabel}</th>
              <th scope="col" className="num">{previousLabel}</th>
              <th scope="col" className="num">Change</th>
            </tr>
          </thead>
          {shown.map(section => {
            const isOpen = !collapsed[section.id]
            return (
              <tbody key={section.id}>
                <tr className="cmp-group">
                  <th scope="rowgroup" colSpan={4}>
                    <button
                      type="button"
                      className="cmp-group__toggle"
                      aria-expanded={isOpen}
                      onClick={() => setCollapsed(c => ({ ...c, [section.id]: isOpen }))}
                    >
                      <CaretDown size={13} weight="bold" aria-hidden className={isOpen ? 'cmp-caret' : 'cmp-caret cmp-caret--closed'} />
                      {section.logo
                        ? <ConnectorLogo type={section.logo} size={16} className="cmp-group__logo" aria-hidden />
                        : <span className="cmp-group__dot" style={{ background: section.color }} aria-hidden />}
                      {section.name}
                      <span className="cmp-group__count">{section.metrics.length} {section.metrics.length === 1 ? 'metric' : 'metrics'}</span>
                    </button>
                  </th>
                </tr>
                {isOpen && section.metrics.map(m => (
                  <tr key={`${section.id}:${m.label}`}>
                    <td className="cmp-metric">{m.label}</td>
                    <td className="num cmp-now">{formatMetric(m.current, m.format)}</td>
                    <td className="num cmp-prev">{formatMetric(m.previous, m.format)}</td>
                    <td className="num"><ChangePill metric={m} /></td>
                  </tr>
                ))}
              </tbody>
            )
          })}
        </table>
      </div>

      {shown.length === 0 && (
        <p className="cmp-empty">No metrics match this filter.</p>
      )}
    </section>
  )
}
