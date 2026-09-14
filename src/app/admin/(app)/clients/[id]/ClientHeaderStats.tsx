'use client'

// The four numbers you open a client to check, in the record header.
//
// They used to live in an "At a Glance" card in the Overview tab's right-hand column, so on any
// other tab — and on any phone, where that column stacked to the bottom — you could open a client
// and see nothing but their mailing address.

import { useEffect, useState } from 'react'
import { balanceColor } from '@/lib/adFuelColor'

interface Stats {
  adFuelBalance?:        number | null
  pendingAch?:           number | null
  mtdSpend?:             number | null
  siteUptime7d?:         number | null
  contentPipelineCount?: number | null
}

const money = (n: number) =>
  `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`

export default function ClientHeaderStats({ clientId, lowBalanceThreshold }: {
  clientId: string
  /** The client's own low-balance alert threshold; the shared rule's default applies when unset. */
  lowBalanceThreshold?: number | null
}) {
  const [stats, setStats]     = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    fetch(`/api/admin/clients/${clientId}/overview-stats`)
      .then(r => (r.ok ? r.json() : null))
      .then((data: Stats | null) => { if (live && data) setStats(data) })
      .catch(() => {})
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [clientId])

  const balance = stats?.adFuelBalance
  const uptime  = stats?.siteUptime7d
  const queued  = stats?.contentPipelineCount ?? 0

  const tiles = [
    {
      label: 'Ad Fuel',
      value: balance != null ? money(balance) : '—',
      color: balance == null ? undefined : balanceColor(balance, lowBalanceThreshold),
    },
    { label: 'Spend this month', value: stats?.mtdSpend != null ? money(stats.mtdSpend) : '—' },
    {
      label: 'Uptime, 7 days',
      value: uptime != null ? `${uptime.toFixed(1)}%` : '—',
      color: uptime == null ? undefined : uptime >= 99 ? 'var(--green)' : uptime >= 95 ? 'var(--amber)' : 'var(--red)',
    },
    {
      label: 'Posts in progress',
      value: String(queued),
      color: queued > 0 ? 'var(--blue)' : 'var(--text-muted)',
    },
  ]

  return (
    <div className="client-header-stats">
      {tiles.map(tile => (
        <div key={tile.label} className="client-header-stats__tile">
          <span className="client-header-stats__label">{tile.label}</span>
          <span
            className="client-header-stats__value"
            style={{ color: loading ? 'var(--text-faint)' : tile.color ?? 'var(--text-primary)' }}
          >
            {loading ? '···' : tile.value}
          </span>
        </div>
      ))}
    </div>
  )
}
