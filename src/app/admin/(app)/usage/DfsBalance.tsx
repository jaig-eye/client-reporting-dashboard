'use client'

// The DataForSEO account's balance, asked of DataForSEO live — after the page has loaded, so a slow
// answer never holds the page up.

import { useEffect, useState } from 'react'
import { Sk } from '@/components/ui/Skeleton'

export default function DfsBalance() {
  const [state, setState] = useState<{ configured: boolean; balance: number | null } | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/dataforseo-usage?balance_only=1')
      .then(r => r.ok ? r.json() : { configured: false, balance: null })
      .then((d: { configured?: boolean; balance?: number | null }) => { if (!cancelled) setState({ configured: !!d.configured, balance: d.balance ?? null }) })
      .catch(() => { if (!cancelled) setState({ configured: false, balance: null }) })
    return () => { cancelled = true }
  }, [])
  if (!state) return <Sk w={84} h={24} r={6} />
  if (!state.configured) return <span className="us-muted">Not connected</span>
  if (state.balance === null) return <span className="us-muted" title="DataForSEO didn't answer">Unavailable</span>
  return <>${state.balance.toFixed(2)}</>
}
