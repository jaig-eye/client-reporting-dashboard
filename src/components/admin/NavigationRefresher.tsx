'use client'

// Forces a server-side data refresh on every admin page navigation.
// Prevents Next.js router cache from serving stale page data when
// clicking between pages.

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'

export default function NavigationRefresher() {
  const router   = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    router.refresh()
  }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
