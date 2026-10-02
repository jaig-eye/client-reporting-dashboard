'use client'

// The admin's navigation. Two groups: Operations (the daily work) and Agency (integrations, usage,
// and Settings, whose pages share their own menu: SettingsShell). On phones and tablets AdminShell
// turns this into a drawer.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import {
  Buildings, NotePencil, EnvelopeSimple, RocketLaunch, GlobeSimple, Bell, PlugsConnected, ChartLineUp, GearSix,
} from '@phosphor-icons/react'
import UserMenu from './UserMenu'
import { isSettingsPath } from './SettingsShell'

interface NavLink {
  href:   string
  label:  string
  icon:   ReactNode
  /** Other path prefixes that count as this item (a client's page belongs to Clients). */
  also?:  string[]
  /** Paths under href that belong to another item. */
  except?: string[]
  /** When matching by path prefix isn't enough (Settings spans several routes). */
  isActive?: (pathname: string) => boolean
  count?: 'alerts'
  beta?:  boolean
}

const ICON = 18

const OPERATIONS: NavLink[] = [
  { href: '/admin/dashboard', label: 'Clients', icon: <Buildings size={ICON} />, also: ['/admin/clients'] },
  { href: '/admin/content',   label: 'Content', icon: <NotePencil size={ICON} />, except: ['/admin/content/settings'] },
  { href: '/admin/emails',    label: 'Emails',  icon: <EnvelopeSimple size={ICON} />, beta: true },
  { href: '/admin/ad-fuel',   label: 'Ad Fuel', icon: <RocketLaunch size={ICON} /> },
  { href: '/admin/sites',     label: 'Sites',   icon: <GlobeSimple size={ICON} /> },
  { href: '/admin/alerts',    label: 'Alerts',  icon: <Bell size={ICON} />, count: 'alerts' },
]

const AGENCY: NavLink[] = [
  { href: '/admin/connections', label: 'Integrations', icon: <PlugsConnected size={ICON} /> },
  { href: '/admin/usage',       label: 'Usage',        icon: <ChartLineUp size={ICON} /> },
  { href: '/admin/settings',    label: 'Settings',     icon: <GearSix size={ICON} />, isActive: isSettingsPath },
]

function matches(pathname: string, item: NavLink): boolean {
  if (item.isActive) return item.isActive(pathname)
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
          <div className="adm-nav-list">{AGENCY.map(item)}</div>
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
