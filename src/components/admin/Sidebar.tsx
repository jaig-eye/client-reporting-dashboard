'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Buildings,
  PlugsConnected,
  NotePencil,
  UsersThree,
  GearSix,
  HardDrives,
  RocketLaunch,
  Bell,
  GlobeSimple,
  EnvelopeSimple,
} from '@phosphor-icons/react'
import UserMenu from './UserMenu'

interface NavItem {
  href: string
  label: string
  icon: React.ReactNode
  matchPrefix?: boolean
  alertsKey?: boolean
  beta?: boolean
}

interface NavSection {
  title: string
  items: NavItem[]
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Operations',
    items: [
      { href: '/admin/dashboard', label: 'Clients',  icon: <Buildings size={16} aria-hidden />,     matchPrefix: true },
      { href: '/admin/content',   label: 'Content',  icon: <NotePencil size={16} aria-hidden />,    matchPrefix: true },
      { href: '/admin/emails',    label: 'Emails',   icon: <EnvelopeSimple size={16} aria-hidden />, matchPrefix: true, beta: true },
      { href: '/admin/ad-fuel',   label: 'Ad Fuel',  icon: <RocketLaunch size={16} aria-hidden />,  matchPrefix: true },
    ],
  },
  {
    title: 'Our Tools',
    items: [
      { href: '/admin/sites', label: 'Site Monitoring', icon: <GlobeSimple size={16} aria-hidden />, matchPrefix: true },
    ],
  },
  {
    title: 'Admin',
    items: [
      { href: '/admin/connections', label: 'Integrations',    icon: <PlugsConnected size={16} aria-hidden />, matchPrefix: true },
      { href: '/admin/users',       label: 'Users',           icon: <UsersThree size={16} aria-hidden />,     matchPrefix: true },
      { href: '/admin/alerts',      label: 'Alerts',          icon: <Bell size={16} aria-hidden />,           matchPrefix: true, alertsKey: true },
      { href: '/admin/settings',    label: 'Agency Settings', icon: <GearSix size={16} aria-hidden />,        matchPrefix: true },
      { href: '/admin/system',      label: 'System',          icon: <HardDrives size={16} aria-hidden />,     matchPrefix: true },
    ],
  },
]

interface SidebarProps {
  agencyName: string
  agencyLogoUrl?: string
  appVersion: string
  userName: string
  userEmail: string
  userAvatarUrl?: string
  isSuperAdmin?: boolean
  unreadAlertCount?: number
}

export default function Sidebar({
  agencyName,
  agencyLogoUrl,
  appVersion,
  userName,
  userEmail,
  userAvatarUrl,
  isSuperAdmin = false,
  unreadAlertCount = 0,
}: SidebarProps) {
  const pathname = usePathname()

  function isActive(item: NavItem): boolean {
    if (item.matchPrefix === false) {
      return pathname === item.href
    }
    return pathname === item.href || pathname.startsWith(item.href + '/')
  }

  return (
    <aside
      className="flex flex-col h-screen sticky top-0"
      style={{
        width: 'var(--sidebar-width)',
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--border)',
        flexShrink: 0,
      }}
    >
      {/* Agency branding */}
      <div style={{ padding: '1.25rem 1rem 1rem', borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="mb-0.5">
          {agencyLogoUrl ? (
            <img src={agencyLogoUrl} alt={agencyName} style={{ display: 'block', width: '100%', height: 'auto', maxHeight: 48, objectFit: 'contain', objectPosition: 'left' }} />
          ) : (
            <div
              className="h-7 w-7 rounded-lg flex items-center justify-center text-white text-xs font-bold"
              style={{ background: 'var(--blue)', flexShrink: 0 }}
            >
              {agencyName.slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>
        <p className="text-xs" style={{ color: 'var(--text-faint)', marginTop: 2 }}>
          v{appVersion}
        </p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto" style={{ padding: '0.625rem 0.5rem' }}>
        {NAV_SECTIONS.map((section, si) => (
          <div key={section.title} style={{ marginTop: si === 0 ? 0 : '1rem' }}>
            <p style={{
              fontSize: '0.625rem', fontWeight: 700, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: 'var(--text-faint)',
              padding: '0 0.5rem', margin: '0 0 0.25rem',
            }}>
              {section.title}
            </p>
            <div className="space-y-0.5">
              {section.items.map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive(item) ? 'page' : undefined}
                  className={`nav-item focus-ring ${isActive(item) ? 'active' : ''}`}
                  style={{ display: 'flex', alignItems: 'center' }}
                >
                  <span className="flex items-center flex-shrink-0" style={{ width: '1rem', justifyContent: 'center' }}>
                    {item.icon}
                  </span>
                  {item.label}
                  {item.beta && (
                    <span style={{
                      fontSize: '0.5rem', fontWeight: 700, letterSpacing: '0.05em',
                      background: 'var(--blue)', color: '#fff',
                      padding: '1px 4px', borderRadius: 3,
                      marginLeft: 5, verticalAlign: 'middle', lineHeight: 1.4,
                    }}>
                      BETA
                    </span>
                  )}
                  {item.alertsKey && unreadAlertCount > 0 && (
                    <span
                      style={{
                        marginLeft:     'auto',
                        minWidth:       18,
                        height:         18,
                        background:     'var(--red)',
                        color:          '#fff',
                        borderRadius:   9,
                        fontSize:       '0.625rem',
                        fontWeight:     700,
                        display:        'flex',
                        alignItems:     'center',
                        justifyContent: 'center',
                        padding:        '0 5px',
                        animation:      'badge-pop 0.2s ease',
                      }}
                    >
                      {unreadAlertCount > 99 ? '99+' : unreadAlertCount}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Account row + three-dot menu */}
      <div style={{ padding: '0.75rem 0.5rem', borderTop: '1px solid var(--border-subtle)' }}>
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
