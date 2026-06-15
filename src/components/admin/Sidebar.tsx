'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Buildings,
  PlugsConnected,
  NotePencil,
  UsersThree,
  GearSix,
  HardDrives,
  SignOut,
  CaretRight,
  RocketLaunch,
  Bell,
  GlobeSimple,
} from '@phosphor-icons/react'
import SoundToggle from './SoundToggle'

interface NavItem {
  href: string
  label: string
  icon: React.ReactNode
  matchPrefix?: boolean
  alertsKey?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { href: '/admin/dashboard',   label: 'Clients',          icon: <Buildings size={16} aria-hidden />,     matchPrefix: true  },
  { href: '/admin/connections', label: 'Integrations',     icon: <PlugsConnected size={16} aria-hidden />, matchPrefix: true  },
  { href: '/admin/content',     label: 'Content',          icon: <NotePencil size={16} aria-hidden />,    matchPrefix: true  },
  { href: '/admin/ad-fuel',     label: 'Ad Fuel',          icon: <RocketLaunch size={16} aria-hidden />,  matchPrefix: true  },
  { href: '/admin/sites',       label: 'Sites',            icon: <GlobeSimple size={16} aria-hidden />,   matchPrefix: true  },
  { href: '/admin/alerts',      label: 'Alerts',           icon: <Bell size={16} aria-hidden />,          matchPrefix: true, alertsKey: true },
  { href: '/admin/users',       label: 'Users',            icon: <UsersThree size={16} aria-hidden />,    matchPrefix: true  },
  { href: '/admin/settings',    label: 'Agency Settings',  icon: <GearSix size={16} aria-hidden />,       matchPrefix: true  },
  { href: '/admin/system',      label: 'System',           icon: <HardDrives size={16} aria-hidden />,    matchPrefix: true  },
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
  const pathname    = usePathname()
  const router      = useRouter()
  const [loggingOut, setLoggingOut] = useState(false)

  async function handleLogout() {
    setLoggingOut(true)
    await fetch('/api/auth/admin-logout', { method: 'POST' })
    router.push('/admin')
    router.refresh()
  }

  function isActive(item: NavItem): boolean {
    if (item.matchPrefix === false) {
      return pathname === item.href
    }
    return pathname === item.href || pathname.startsWith(item.href + '/')
  }

  const initials = userName
    .split(' ')
    .map(p => p[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

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
        <div className="space-y-0.5">
          {NAV_ITEMS.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item focus-ring ${isActive(item) ? 'active' : ''}`}
              style={{ display: 'flex', alignItems: 'center' }}
            >
              <span className="flex items-center flex-shrink-0" style={{ width: '1rem', justifyContent: 'center' }}>
                {item.icon}
              </span>
              {item.label}
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
      </nav>

      {/* User card + logout */}
      <div style={{ padding: '0.75rem 0.5rem', borderTop: '1px solid var(--border-subtle)' }}>
        <SoundToggle />
        {isSuperAdmin ? (
          <div className="flex items-center gap-2.5 p-2 rounded-lg">
            <div
              className="h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
              style={{ background: 'var(--blue)' }}
            >
              SA
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate leading-tight" style={{ color: 'var(--text-primary)' }}>Super Admin</p>
              <p className="text-xs truncate leading-tight" style={{ color: 'var(--text-faint)' }}>Master account</p>
            </div>
          </div>
        ) : (
          <Link
            href="/admin/users/me"
            className="flex items-center gap-2.5 p-2 rounded-lg focus-ring group"
            style={{ textDecoration: 'none', transition: 'background 0.1s' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-subtle)')}
            onMouseLeave={e => (e.currentTarget.style.background = '')}
          >
            {userAvatarUrl ? (
              <img src={userAvatarUrl} alt={userName} className="h-8 w-8 rounded-full object-cover flex-shrink-0" />
            ) : (
              <div
                className="h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                style={{ background: 'var(--blue)' }}
              >
                {initials}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate leading-tight" style={{ color: 'var(--text-primary)' }}>{userName}</p>
              <p className="text-xs truncate leading-tight" style={{ color: 'var(--text-faint)' }}>{userEmail}</p>
            </div>
            <CaretRight
              size={12}
              aria-hidden
              className="flex-shrink-0 opacity-0 group-hover:opacity-100"
              style={{ color: 'var(--text-faint)', transition: 'opacity 0.15s' }}
            />
          </Link>
        )}

        <button
          onClick={handleLogout}
          disabled={loggingOut}
          aria-label="Sign out"
          className="focus-ring w-full mt-1 flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm"
          style={{
            color: 'var(--text-muted)',
            textAlign: 'left',
            background: 'transparent',
            border: 'none',
            cursor: loggingOut ? 'not-allowed' : 'pointer',
            transition: 'background 0.1s, color 0.1s',
          }}
          onMouseEnter={e => { if (!loggingOut) e.currentTarget.style.background = 'var(--bg-subtle)' }}
          onMouseLeave={e => { e.currentTarget.style.background = '' }}
        >
          <span className="flex items-center" style={{ width: '1rem', justifyContent: 'center' }}>
            <SignOut size={15} aria-hidden />
          </span>
          {loggingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </aside>
  )
}
