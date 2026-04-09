'use client'

// No-op: pages use `export const dynamic = 'force-dynamic'` which causes the
// server component to re-render on every navigation without needing an explicit
// router.refresh(). The previous implementation called router.refresh() on every
// URL change, which created a double-render race that intermittently caused empty
// data states when switching between paid-ad source views.

export default function DashboardNavigationRefresher() {
  return null
}
