// Agency settings — /admin/settings?tab=… AgencySettings reads the section from the URL, so a link
// (or the old /admin/settings/notifications redirect) opens the right one and the Settings menu
// can switch it in place.

import '@/styles/admin/settings.css'
import { redirect } from 'next/navigation'
import AgencySettings from './AgencySettings'

// Rendered per request: AgencySettings reads ?tab= while it renders on the server.
export const dynamic = 'force-dynamic'

export default function AgencySettingsPage({ searchParams }: { searchParams: { tab?: string | string[] } }) {
  // The AI keys moved to Integrations; an old ?tab=ai link (a bookmark, a notification) follows them.
  if (searchParams.tab === 'ai') redirect('/admin/connections#int-ai')
  return <AgencySettings />
}
