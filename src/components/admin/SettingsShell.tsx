'use client'

// One Settings area with its own menu. Configuration used to sit behind a sidebar group (Agency
// settings, Users, System, My profile), seven pill tabs inside Agency settings, a button on the
// Content page, and a categories page nothing linked to. Every settings page now shows the same
// grouped menu: a column beside the page on a wide screen, and below that a "Settings › Branding"
// button that opens the list in a sheet.
//
// It wraps pages rather than moving them (AdminShell puts it around any settings path), so every
// URL and ?tab= link keeps working. On /admin/settings the Agency sections switch in place: the
// menu pushes ?tab= and AgencySettings reads it, so there's no request and edits survive.

import { Suspense, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { CaretDown, CaretRight, Check } from '@phosphor-icons/react'
import Dialog from '@/components/ui/Dialog'
import { SETTINGS_TABS, isSettingsTab, type SettingsTab } from '@/app/admin/(app)/settings/tabs'

interface SettingsItem {
  id:    string
  label: string
  href:  string
  /** An Agency settings section, which switches in place while you're on that page. */
  tab?:  boolean
}
interface SettingsGroup { title: string; items: SettingsItem[] }

function section(id: SettingsTab): SettingsItem {
  const label = SETTINGS_TABS.find(t => t.id === id)?.label ?? id
  return { id, label, href: id === 'branding' ? '/admin/settings' : `/admin/settings?tab=${id}`, tab: true }
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    title: 'Agency',
    items: [
      section('branding'), section('colors'), section('layouts'), section('benchmarks'),
      { id: 'categories', label: 'Campaign categories', href: '/admin/categories' },
      section('ai'),
      { id: 'content', label: 'Content', href: '/admin/content/settings' },
      section('notifications'), section('sync'),
    ],
  },
  {
    title: 'Workspace',
    items: [
      { id: 'users',  label: 'Users',         href: '/admin/users' },
      { id: 'system', label: 'System & logs', href: '/admin/system' },
    ],
  },
  {
    title: 'Personal',
    items: [{ id: 'profile', label: 'My profile', href: '/admin/users/me' }],
  },
]

const under = (path: string, base: string) => path === base || path.startsWith(base + '/')
const SETTINGS_BASES = ['/admin/settings', '/admin/categories', '/admin/metric-mapping', '/admin/content/settings', '/admin/users', '/admin/system']

/** Every route that belongs to Settings. The sidebar and AdminShell both use this. */
export function isSettingsPath(path: string): boolean {
  return SETTINGS_BASES.some(b => under(path, b))
}

function activeId(path: string, tab: string | null): string {
  if (under(path, '/admin/settings'))         return isSettingsTab(tab) ? tab : 'branding'
  if (under(path, '/admin/categories') || under(path, '/admin/metric-mapping')) return 'categories'
  if (under(path, '/admin/content/settings')) return 'content'
  if (path === '/admin/users/me')             return 'profile'
  if (under(path, '/admin/users'))            return 'users'
  if (under(path, '/admin/system'))           return 'system'
  return ''
}

function SettingsMenu({ tab }: { tab: string | null }) {
  const pathname = usePathname() ?? ''
  const active = activeId(pathname, tab)
  const current = SETTINGS_GROUPS.flatMap(g => g.items).find(i => i.id === active)
  const [sheetOpen, setSheetOpen] = useState(false)
  const currentRef = useRef<HTMLAnchorElement>(null)

  function pick(item: SettingsItem, e: MouseEvent<HTMLAnchorElement>) {
    setSheetOpen(false)
    // Already on Agency settings: switch the section in place. A new-tab click still navigates.
    if (!item.tab || pathname !== '/admin/settings') return
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    window.history.pushState(null, '', item.href)
    window.scrollTo({ top: 0 })
  }

  const groups = (inSheet: boolean) => SETTINGS_GROUPS.map(g => (
    <div key={g.title} className="sx-group">
      <p className="sx-group-title" id={`sx-${inSheet ? 's' : 'n'}-${g.title}`}>{g.title}</p>
      <ul className="sx-list" aria-labelledby={`sx-${inSheet ? 's' : 'n'}-${g.title}`}>
        {g.items.map(item => {
          const on = item.id === active
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                ref={inSheet && on ? currentRef : undefined}
                className="sx-item"
                aria-current={on ? 'page' : undefined}
                onClick={e => pick(item, e)}
              >
                {item.label}
                {inSheet && on && <Check size={15} weight="bold" className="sx-check" aria-hidden />}
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  ))

  return (
    <>
      <nav className="sx-nav" aria-label="Settings">{groups(false)}</nav>

      <div className="sx-picker">
        <button type="button" className="sx-picker-btn" aria-haspopup="dialog" onClick={() => setSheetOpen(true)}>
          <span className="sx-picker-root">Settings</span>
          <CaretRight size={12} weight="bold" className="sx-picker-sep" aria-hidden />
          <span className="sx-picker-current">{current?.label ?? 'Choose a section'}</span>
          <CaretDown size={14} weight="bold" className="sx-picker-caret" aria-hidden />
        </button>
      </div>
      <Dialog
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Settings"
        size="sm"
        initialFocus={currentRef}
        bodyClassName="sx-sheet"
      >
        <nav aria-label="Settings sections">{groups(true)}</nav>
      </Dialog>
    </>
  )
}

function SettingsMenuFromUrl() {
  return <SettingsMenu tab={useSearchParams().get('tab')} />
}

export default function SettingsShell({ children }: { children: ReactNode }) {
  return (
    <div className="sx-shell">
      {/* useSearchParams wants a Suspense boundary; the fallback still draws the menu. */}
      <Suspense fallback={<SettingsMenu tab={null} />}>
        <SettingsMenuFromUrl />
      </Suspense>
      <div className="sx-content">{children}</div>
    </div>
  )
}
