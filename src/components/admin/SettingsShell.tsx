'use client'

// One Settings area, with its own menu.
//
// Configuration used to be spread across five sidebar items (Connections, Users, Agency Settings,
// System) plus a gear chip on the Content page and a profile page reached from the user menu — and
// Agency Settings alone hid seven tabs. This frame gives every settings page the same grouped menu:
// a column on desktop (the Mercury / Ghost pattern), a scrollable pill strip on a phone.
//
// It wraps pages rather than moving them, so every existing URL and link keeps working.

import { Suspense, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import ScrollTabs from '@/components/ui/ScrollTabs'

interface SettingsItem { id: string; label: string; href: string }
interface SettingsGroup { title: string; items: SettingsItem[] }

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    title: 'Agency',
    items: [
      { id: 'branding',      label: 'Branding',             href: '/admin/settings' },
      { id: 'benchmarks',    label: 'Benchmarks',           href: '/admin/settings?tab=benchmarks' },
      { id: 'colors',        label: 'Brand & chart colors', href: '/admin/settings?tab=colors' },
      { id: 'layouts',       label: 'Dashboard layouts',    href: '/admin/settings?tab=layouts' },
      { id: 'content',       label: 'Content writing',      href: '/admin/content/settings' },
      { id: 'ai',            label: 'AI',                   href: '/admin/settings?tab=ai' },
      { id: 'notifications', label: 'Notifications',        href: '/admin/settings?tab=notifications' },
      { id: 'sync',          label: 'Sync schedule',        href: '/admin/settings?tab=sync' },
    ],
  },
  {
    title: 'Workspace',
    items: [
      { id: 'connections', label: 'Connections',   href: '/admin/connections' },
      { id: 'users',       label: 'Users',         href: '/admin/users' },
      { id: 'system',      label: 'System & logs', href: '/admin/system' },
    ],
  },
  {
    title: 'Personal',
    items: [
      { id: 'profile', label: 'My profile', href: '/admin/users/me' },
    ],
  },
]

const AGENCY_TABS = new Set(['branding', 'benchmarks', 'colors', 'ai', 'sync', 'notifications', 'layouts'])

/** Every route that belongs to Settings — the sidebar and AdminShell both use this. */
export function isSettingsPath(pathname: string): boolean {
  return (
    pathname.startsWith('/admin/settings') ||
    pathname.startsWith('/admin/connections') ||
    pathname.startsWith('/admin/users') ||
    pathname.startsWith('/admin/system') ||
    pathname.startsWith('/admin/content/settings')
  )
}

function activeItem(pathname: string, tab: string | null): string {
  if (pathname.startsWith('/admin/settings/notifications')) return 'notifications'
  if (pathname.startsWith('/admin/settings')) return tab && AGENCY_TABS.has(tab) ? tab : 'branding'
  if (pathname.startsWith('/admin/content/settings')) return 'content'
  if (pathname.startsWith('/admin/connections'))      return 'connections'
  if (pathname === '/admin/users/me')                 return 'profile'
  if (pathname.startsWith('/admin/users'))            return 'users'
  if (pathname.startsWith('/admin/system'))           return 'system'
  return ''
}

function SettingsNav({ tab }: { tab: string | null }) {
  const pathname = usePathname()
  const active   = activeItem(pathname, tab)

  return (
    <>
      <nav className="settings-nav" aria-label="Settings">
        <p className="settings-nav__heading">Settings</p>
        {SETTINGS_GROUPS.map(group => (
          <div key={group.title} className="settings-nav__group">
            <p className="settings-nav__title">{group.title}</p>
            {group.items.map(item => (
              <Link
                key={item.id}
                href={item.href}
                scroll={false}
                className="settings-nav__item"
                data-active={item.id === active}
                aria-current={item.id === active ? 'page' : undefined}
              >
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="settings-nav-mobile">
        <ScrollTabs
          label="Settings"
          activeId={active}
          items={SETTINGS_GROUPS.flatMap(g => g.items).map(i => ({ id: i.id, label: i.label, href: i.href }))}
        />
      </div>
    </>
  )
}

function SettingsNavWithParams() {
  const search = useSearchParams()
  return <SettingsNav tab={search.get('tab')} />
}

export default function SettingsShell({ children }: { children: ReactNode }) {
  return (
    <div className="settings-shell">
      {/* useSearchParams needs a Suspense boundary; the fallback still renders the menu. */}
      <Suspense fallback={<SettingsNav tab={null} />}>
        <SettingsNavWithParams />
      </Suspense>
      <div className="settings-shell__content">{children}</div>
    </div>
  )
}
