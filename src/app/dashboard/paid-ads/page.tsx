// /dashboard/paid-ads — every paid channel on one page, and nothing else.
//
// In the rebuilt dashboard each channel has its own page, so this is the Summary page with the
// cross-channel cards (analytics, SEO, CRM, blog) left out: KPI cards, the daily chart, benchmarks,
// the Google/Meta comparison and the campaign breakdown, across both platforms.

export const dynamic = 'force-dynamic'

import DashboardPage from '../page'

export default async function PaidAdsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; compare?: string }>
}) {
  const sp = await searchParams
  return DashboardPage({ searchParams: Promise.resolve({ ...sp, source: 'paid' }) })
}
