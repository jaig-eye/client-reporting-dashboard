'use client'

// The admin frame. On a laptop: the sidebar beside the page. Below 1024px: a top bar with a menu
// button, the agency's logo and the alerts bell, and the sidebar slides in as a drawer — closed by
// the backdrop, Escape, or going to another page.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { List, Bell } from '@phosphor-icons/react'
import Sidebar, { type SidebarProps } from './Sidebar'

export default function AdminShell({ children, flush = false, ...nav }: SidebarProps & { children: ReactNode; /** No padding or width cap: the client-dashboard preview fills the page. */ flush?: boolean }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const menuBtn = useRef<HTMLButtonElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // Going somewhere closes the drawer.
  useEffect(() => { setOpen(false) }, [pathname])

  // While closed on a small screen the drawer is off-canvas: keep it out of the tab order and
  // away from screen readers. While open: Escape closes it, and the page behind doesn't scroll.
  useEffect(() => {
    const sidebar = rootRef.current?.querySelector<HTMLElement>('.adm-sidebar')
    const mq = window.matchMedia('(max-width: 1023px)')
    const sync = () => {
      if (!sidebar) return
      if (mq.matches && !open) sidebar.setAttribute('inert', '')
      else sidebar.removeAttribute('inert')
    }
    sync()
    mq.addEventListener('change', sync)
    if (!open) return () => mq.removeEventListener('change', sync)

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); menuBtn.current?.focus() } }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    sidebar?.querySelector<HTMLElement>('a, button')?.focus()
    return () => {
      mq.removeEventListener('change', sync)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open])

  const alerts = nav.unreadAlertCount ?? 0

  return (
    <div ref={rootRef} className="adm" data-drawer={open ? 'open' : 'closed'}>
      <Sidebar {...nav} id="adm-sidebar" />
      <div className="adm-scrim" onClick={() => setOpen(false)} aria-hidden />

      <div className="adm-main">
        <header className="adm-topbar">
          <button
            ref={menuBtn}
            type="button"
            className="adm-iconbtn"
            aria-label="Open navigation"
            aria-controls="adm-sidebar"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <List size={22} aria-hidden />
          </button>
          <div className="adm-topbar-brand">
            {nav.agencyLogoUrl
              ? <img src={nav.agencyLogoUrl} alt={nav.agencyName} />
              : <><span className="adm-brand-mark" aria-hidden>{nav.agencyName.slice(0, 1).toUpperCase()}</span><span className="adm-brand-name">{nav.agencyName}</span></>}
          </div>
          <Link href="/admin/alerts" className="adm-iconbtn" aria-label={alerts > 0 ? `Alerts, ${alerts} unread` : 'Alerts'}>
            <Bell size={21} aria-hidden />
            {alerts > 0 && <span className="adm-nav-count" aria-hidden>{alerts > 99 ? '99+' : alerts}</span>}
          </Link>
        </header>

        <main className={`adm-content${flush ? ' adm-content--flush' : ''}`} id="main">{children}</main>
      </div>
    </div>
  )
}
