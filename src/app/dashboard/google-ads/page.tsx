// /dashboard/google-ads — dedicated Google Ads source view
// Calls the main dashboard page with source hardcoded to 'google_ads'.
// Clean URL alternative to /dashboard?source=google_ads.

export const dynamic = 'force-dynamic'

import DashboardPage from '../page'

export default async function GoogleAdsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; compare?: string }>
}) {
  const sp = await searchParams
  return DashboardPage({
    searchParams: Promise.resolve({ ...sp, source: 'google_ads' }),
  })
}
