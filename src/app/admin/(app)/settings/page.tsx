// Agency settings — /admin/settings?tab=… The tab comes from the URL so a link (or the old
// /admin/settings/notifications redirect) opens the right one; the page itself is AgencySettings.

import '@/styles/admin/settings.css'
import AgencySettings from './AgencySettings'
import { SETTINGS_TABS, type SettingsTab } from './tabs'

export default function AgencySettingsPage({ searchParams }: { searchParams: { tab?: string | string[] } }) {
  const asked = Array.isArray(searchParams.tab) ? searchParams.tab[0] : searchParams.tab
  const tab = SETTINGS_TABS.some(t => t.id === asked) ? asked as SettingsTab : 'branding'
  return <AgencySettings initialTab={tab} />
}
