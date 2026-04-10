'use client'

// Persists the admin overview date range to localStorage so it survives navigation.
// On first load with no searchParams, redirects to the stored range (or MTD).

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function getMtdRange(): { from: string; to: string } {
  const now   = new Date()
  const from  = new Date(now.getFullYear(), now.getMonth(), 1)
  const fmt   = (d: Date) => d.toISOString().split('T')[0]
  return { from: fmt(from), to: fmt(now) }
}

const STORAGE_KEY = 'adminOverviewRange'

export default function AdminDateSync() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const from         = searchParams.get('from')
  const to           = searchParams.get('to')

  useEffect(() => {
    if (from && to) {
      // Save current range to localStorage whenever URL params are set
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ from, to })) } catch {}
      return
    }

    // No params in URL — try to restore from localStorage, else use MTD
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const { from: f, to: t } = JSON.parse(stored) as { from: string; to: string }
        if (f && t) {
          router.replace(`?from=${f}&to=${t}`)
          return
        }
      }
    } catch {}

    // Fallback to MTD
    const { from: f, to: t } = getMtdRange()
    router.replace(`?from=${f}&to=${t}`)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])

  return null
}
