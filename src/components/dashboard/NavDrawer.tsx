'use client'

// The client dashboard's navigation on a phone: the same sidebar, sliding in behind a menu button.
//
// This replaced a bottom tab bar, which ran out of room as soon as a client had more than five
// sections (or a long CRM name) and clipped the last ones off the edge. A drawer holds any number of
// sections and matches how the admin side already works.

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { List, X } from '@phosphor-icons/react'

interface Props {
  clientName?: string
  clientLogoUrl?: string | null
  /** Height of the fixed admin preview bar above the page, when it is showing. */
  topOffset?: number
  children: ReactNode
}

export default function DashboardNavDrawer({ clientName, clientLogoUrl, topOffset = 0, children }: Props) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const search   = useSearchParams()

  // Close once the tap has taken you somewhere.
  useEffect(() => { setOpen(false) }, [pathname, search])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <header className="dash-topbar" style={{ top: topOffset }}>
        <button
          type="button"
          className="dash-topbar__btn focus-ring"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-label="Open navigation"
        >
          <List size={20} />
        </button>
        {clientLogoUrl && <img src={clientLogoUrl} alt="" className="dash-topbar__logo" />}
        <span className="dash-topbar__name">{clientName}</span>
      </header>

      <div className="dash-drawer" data-open={open ? 'true' : 'false'} style={{ top: topOffset }}>
        {children}
      </div>

      {open && (
        <>
          <div className="dash-drawer__scrim" style={{ top: topOffset }} onClick={() => setOpen(false)} aria-hidden />
          <button
            type="button"
            className="dash-drawer__close focus-ring"
            style={{ top: topOffset + 8 }}
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
          >
            <X size={20} />
          </button>
        </>
      )}
    </>
  )
}
