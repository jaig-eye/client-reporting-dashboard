'use client'

// Forces a server-side data refresh on every dashboard navigation —
// including source switches (?source=X) and drill-downs (campaign / adset / ad).
// Watches both pathname and search params so all navigations are covered.

import { Suspense, useEffect } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'

function Refresher() {
  const router      = useRouter()
  const pathname    = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    router.refresh()
  }, [pathname, searchParams.toString()]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

export default function DashboardNavigationRefresher() {
  return (
    <Suspense fallback={null}>
      <Refresher />
    </Suspense>
  )
}
