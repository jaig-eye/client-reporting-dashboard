'use client'

// The admin frame: sidebar on desktop, off-canvas drawer on a phone.
//
// The sidebar used to be a fixed 220px at every width, so a 390px screen had ~170px left for the
// page and every admin table clipped. Below 1024px it now slides in over the content, behind a
// top bar, and closes when you navigate.

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { List, X, Bell } from '@phosphor-icons/react'
import Link from 'next/link'
import Sidebar from './Sidebar'
import SettingsShell, { isSettingsPath } from './SettingsShell'

interface Props {
  agencyName: string
  agencyLogoUrl?: string
  userName: string
  userEmail: string
  userAvatarUrl?: string
  isSuperAdmin?: boolean
  unreadAlertCount?: number
  children: ReactNode
}

export default function AdminShell({ children, ...nav }: Props) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  // Navigating is what you opened the drawer to do, so close it on arrival.
  useEffect(() => { setOpen(false) }, [pathname])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const alerts = nav.unreadAlertCount ?? 0

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <button
          type="button"
          className="admin-topbar__btn focus-ring"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-label="Open navigation"
        >
          <List size={20} />
        </button>

        {/* The logo already carries the agency's name, so show one or the other — never both. */}
        {nav.agencyLogoUrl ? (
          <span className="admin-topbar__brand">
            <img src={nav.agencyLogoUrl} alt={nav.agencyName} className="admin-topbar__logo" />
          </span>
        ) : (
          <span className="admin-topbar__name">{nav.agencyName}</span>
        )}

        <Link href="/admin/alerts" className="admin-topbar__btn focus-ring" aria-label={alerts > 0 ? `Alerts, ${alerts} unread` : 'Alerts'}>
          <Bell size={20} />
          {alerts > 0 && <span className="admin-topbar__badge">{alerts > 99 ? '99+' : alerts}</span>}
        </Link>
      </header>

      <Sidebar {...nav} open={open} onClose={() => setOpen(false)} />

      {open && <div className="admin-scrim" onClick={() => setOpen(false)} aria-hidden />}

      <div className="admin-main">
        <main className="admin-content">
          {isSettingsPath(pathname) ? <SettingsShell>{children}</SettingsShell> : children}
        </main>
      </div>

      {open && (
        <button
          type="button"
          className="admin-drawer-close focus-ring"
          onClick={() => setOpen(false)}
          aria-label="Close navigation"
        >
          <X size={20} />
        </button>
      )}
    </div>
  )
}
