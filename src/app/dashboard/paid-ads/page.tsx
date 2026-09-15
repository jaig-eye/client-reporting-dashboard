// /dashboard/paid-ads — every paid channel on one page, and nothing else.
//
// In the rebuilt dashboard each channel has its own page, so this is the Summary page with the
// cross-channel cards (analytics, SEO, CRM, blog) left out: KPI cards, the daily chart, benchmarks,
// the Google/Meta comparison and the campaign breakdown, across both platforms.
//
// Opening a platform (?source=google_ads or ?source=meta_ads) shows that platform's campaign
// breakdown, so the "View campaigns" cards work here exactly as they do on the Summary page.
// Anything else is the all-platforms view.

export const dynamic = 'force-dynamic'

import DashboardPage from '../page'

const PLATFORM_SOURCES = new Set(['google_ads', 'meta_ads'])

export default async function PaidAdsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; compare?: string; source?: string }>
}) {
  const sp     = await searchParams
  const source = sp.source && PLATFORM_SOURCES.has(sp.source) ? sp.source : 'paid'
  return DashboardPage({ searchParams: Promise.resolve({ ...sp, source }) })
}
