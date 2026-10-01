'use client'

// The admin's navigation. Two groups: Operations (the daily work) and Agency (integrations, usage,
// and the Settings hub — agency settings, users, system and logs, your profile — which opens in
// place). On phones and tablets AdminShell turns this into a drawer.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import {
  Buildings, NotePencil, EnvelopeSimple, RocketLaunch, GlobeSimple, Bell,
  PlugsConnected, ChartLineUp, GearSix, CaretRight, SlidersHorizontal, UsersThree, HardDrives, UserCircle,
} from '@phosphor-icons/react'
import UserMenu from './UserMenu'

interface NavLink {
  href:   string
  label:  string
  icon:   ReactNode
  /** Other path prefixes that count as this item (a client's page belongs to Clients). */
  also?:  string[]
  /** Paths under href that belong to another item. */
  except?: string[]
  count?: 'alerts'
  beta?:  boolean
}

const ICON = 18

const OPERATIONS: NavLink[] = [
  { href: '/admin/dashboard', label: 'Clients', icon: <Buildings size={ICON} />, also: ['/admin/clients'] },
  { href: '/admin/content',   label: 'Content', icon: <NotePencil size={ICON} /> },
  { href: '/admin/emails',    label: 'Emails',  icon: <EnvelopeSimple size={ICON} />, beta: true },
  { href: '/admin/ad-fuel',   label: 'Ad Fuel', icon: <RocketLaunch size={ICON} /> },
  { href: '/admin/sites',     label: 'Sites',   icon: <GlobeSimple size={ICON} /> },
  { href: '/admin/alerts',    label: 'Alerts',  icon: <Bell size={ICON} />, count: 'alerts' },
]

const AGENCY: NavLink[] = [
  { href: '/admin/connections', label: 'Integrations', icon: <PlugsConnected size={ICON} /> },
  { href: '/admin/usage',       label: 'Usage',        icon: <ChartLineUp size={ICON} /> },
]

const SETTINGS: NavLink[] = [
  { href: '/admin/settings', label: 'Agency settings', icon: <SlidersHorizontal size={16} />, also: ['/admin/categories', '/admin/metric-mapping'] },
  { href: '/admin/users',    label: 'Users',           icon: <UsersThree size={16} />, except: ['/admin/users/me'] },
  { href: '/admin/system',   label: 'System & logs',   icon: <HardDrives size={16} /> },
  { href: '/admin/users/me', label: 'My profile',      icon: <UserCircle size={16} /> },
]

function matches(pathname: string, item: NavLink): boolean {
  const under = (p: string) => pathname === p || pathname.startsWith(p + '/')
  if (item.except?.some(under)) return false
  return under(item.href) || (item.also ?? []).some(under)
}

export interface SidebarProps {
  agencyName:       string
  agencyLogoUrl?:   string
  userName:         string
  userEmail:        string
  userAvatarUrl?:   string
  isSuperAdmin?:    boolean
  unreadAlertCount?: number
  id?:              string
}

export default function Sidebar({
  agencyName, agencyLogoUrl, userName, userEmail, userAvatarUrl, isSuperAdmin = false, unreadAlertCount = 0, id,
}: SidebarProps) {
  const pathname = usePathname() ?? ''
  const inSettings = SETTINGS.some(s => matches(pathname, s))
  const [settingsOpen, setSettingsOpen] = useState(inSettings)
  // Arriving on a settings page opens the group; leaving it doesn't close what someone opened.
  useEffect(() => { if (inSettings) setSettingsOpen(true) }, [inSettings])

  const item = (n: NavLink) => {
    const on = matches(pathname, n)
    const count = n.count === 'alerts' ? unreadAlertCount : 0
    return (
      <Link key={n.href} href={n.href} className="adm-nav-item" aria-current={on ? 'page' : undefined}>
        <span className="adm-nav-icon" aria-hidden>{n.icon}</span>
        <span className="adm-nav-label">{n.label}</span>
        {n.beta && <span className="adm-nav-beta">Beta</span>}
        {count > 0 && <span className="adm-nav-count" aria-label={`${count} unread`}>{count > 99 ? '99+' : count}</span>}
      </Link>
    )
  }

  return (
    <aside className="adm-sidebar" id={id} aria-label="Admin navigation">
      <div className="adm-brand">
        {agencyLogoUrl
          ? <img src={agencyLogoUrl} alt={agencyName} />
          : <><span className="adm-brand-mark" aria-hidden>{agencyName.slice(0, 1).toUpperCase()}</span><span className="adm-brand-name">{agencyName}</span></>}
      </div>

      <nav className="adm-nav">
        <div className="adm-nav-section">
          <p className="adm-nav-title">Operations</p>
          <div className="adm-nav-list">{OPERATIONS.map(item)}</div>
        </div>

        <div className="adm-nav-section">
          <p className="adm-nav-title">Agency</p>
          <div className="adm-nav-list">
            {AGENCY.map(item)}
            <button
              type="button"
              className="adm-nav-item"
              aria-expanded={settingsOpen}
              aria-controls="adm-settings-nav"
              onClick={() => setSettingsOpen(o => !o)}
            >
              <span className="adm-nav-icon" aria-hidden><GearSix size={ICON} /></span>
              <span className="adm-nav-label">Settings</span>
              <CaretRight size={12} weight="bold" className="adm-nav-caret" aria-hidden />
            </button>
            {settingsOpen && (
              <div className="adm-nav-sub" id="adm-settings-nav">{SETTINGS.map(item)}</div>
            )}
          </div>
        </div>
      </nav>

      <div className="adm-account">
        <UserMenu
          userName={userName}
          userEmail={userEmail}
          userAvatarUrl={userAvatarUrl}
          isSuperAdmin={isSuperAdmin}
          unreadAlertCount={unreadAlertCount}
        />
      </div>
    </aside>
  )
}
