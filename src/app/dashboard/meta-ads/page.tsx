// /dashboard/meta-ads — dedicated Meta Ads source view
// Calls the main dashboard page with source hardcoded to 'meta_ads'.
// Clean URL alternative to /dashboard?source=meta_ads.

export const dynamic = 'force-dynamic'

import DashboardPage from '../page'

export default async function MetaAdsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; compare?: string }>
}) {
  const sp = await searchParams
  return DashboardPage({
    searchParams: Promise.resolve({ ...sp, source: 'meta_ads' }),
  })
}
