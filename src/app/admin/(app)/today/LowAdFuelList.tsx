'use client'

// Low Ad Fuel list on the Today page, with filter chips and a muted-clients toggle.
// Clients whose low-balance alerts are muted (clients.ad_fuel_alert_muted) are hidden by default.

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, BellSlash, CheckCircle, Warning, WarningOctagon } from '@phosphor-icons/react'
import { balanceColor, DEFAULT_LOW_BALANCE } from '@/lib/adFuelColor'

export interface LowFuelRow {
  clientId:       string
  clientName:     string
  afBalance:      number
  alertThreshold: number | null
  muted:          boolean
}

type Filter = 'all' | 'negative' | 'low'

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export default function LowAdFuelList({ rows }: { rows: LowFuelRow[] }) {
  const [filter, setFilter]       = useState<Filter>('all')
  const [showMuted, setShowMuted] = useState(false)

  const mutedCount = rows.filter(r => r.muted).length
  const visible    = rows.filter(r => showMuted || !r.muted)
  const negative   = visible.filter(r => r.afBalance < 0).length
  const low        = visible.length - negative
  const list       = visible.filter(r =>
    filter === 'all' ? true : filter === 'negative' ? r.afBalance < 0 : r.afBalance >= 0)

  const chips: { id: Filter; label: string; count: number }[] = [
    { id: 'all',      label: 'All',            count: visible.length },
    { id: 'negative', label: 'Below zero',     count: negative },
    { id: 'low',      label: 'At alert level', count: low },
  ]

  return (
    <>
      {(visible.length > 0 || mutedCount > 0) && (
        <div className="today-filters">
          {visible.length > 0 && (
            <div className="today-chips" role="group" aria-label="Filter low balances">
              {chips.map(c => (
                <button
                  key={c.id}
                  type="button"
                  className="today-chip"
                  aria-pressed={filter === c.id}
                  onClick={() => setFilter(c.id)}
                >
                  {c.label}<span className="today-chip__count">{c.count}</span>
                </button>
              ))}
            </div>
          )}
          {mutedCount > 0 && (
            <button type="button" className="today-muted-toggle" aria-pressed={showMuted} onClick={() => setShowMuted(v => !v)}>
              <BellSlash size={12} weight="bold" aria-hidden />
              {showMuted ? 'Hide muted' : `Show ${mutedCount} muted`}
            </button>
          )}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="today-clear">
          <CheckCircle size={16} weight="fill" aria-hidden style={{ color: 'var(--green)', flexShrink: 0 }} />
          {mutedCount > 0
            ? 'Every client with alerts on is above their alert level.'
            : 'Every client is above their alert level.'}
        </p>
      ) : list.length === 0 ? (
        <p className="today-clear">
          <CheckCircle size={16} weight="fill" aria-hidden style={{ color: 'var(--green)', flexShrink: 0 }} />
          {filter === 'negative' ? 'No clients are below zero.' : 'No clients are sitting at their alert level.'}
        </p>
      ) : (
        <ul className="today-list">
          {list.map(r => (
            <li key={r.clientId} className="today-row">
              <div className="today-row__main">
                <p className="today-row__title">{r.clientName}</p>
                <p className="today-row__meta">
                  {r.afBalance < 0 ? (
                    <span className="today-tag" style={{ color: 'var(--red)' }}>
                      <WarningOctagon size={14} weight="fill" aria-hidden />Below zero
                    </span>
                  ) : (
                    <span className="today-tag" style={{ color: 'var(--amber)' }}>
                      <Warning size={14} weight="fill" aria-hidden />Alert level {money(r.alertThreshold ?? DEFAULT_LOW_BALANCE)}
                    </span>
                  )}
                  {r.muted && (
                    <span className="today-tag" style={{ color: 'var(--text-muted)' }}>
                      <BellSlash size={13} weight="bold" aria-hidden />Muted
                    </span>
                  )}
                </p>
              </div>
              <div className="today-row__aside">
                <span className="today-amount" style={{ color: r.muted ? 'var(--text-muted)' : balanceColor(r.afBalance, r.alertThreshold) }}>
                  {money(r.afBalance)}
                </span>
                <Link href={`/admin/clients/${r.clientId}?tab=billing`} className="today-link">
                  Billing<ArrowRight size={12} weight="bold" aria-hidden />
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
