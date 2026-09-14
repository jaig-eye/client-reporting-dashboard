'use client'

// Bottom navigation for a client's dashboard on a phone.
//
// The sidebar was 220px at every width, so on a 390px screen the client's own report had ~170px to
// render in and every chart and table collapsed. Below 1024px the sidebar steps aside and the same
// destinations sit along the bottom, where a thumb can reach them.
//
// A section with one destination navigates straight there; a section with several (SEO, Paid Ads)
// opens a sheet listing them, so nothing becomes unreachable.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV, type NavItem } from '@/components/DashboardSidebar'
import type { ConnectorType } from '@/lib/types'

interface Props {
  activeConnectorTypes: ConnectorType[]
  crmName?: string
  hasLocalDominator?: boolean
  isAdminPreview?: boolean
}

export default function DashboardMobileNav({
  activeConnectorTypes, crmName = 'CRM', hasLocalDominator = false, isAdminPreview = false,
}: Props) {
  const pathname = usePathname()
  const [sheet, setSheet] = useState<NavItem | null>(null)

  useEffect(() => { setSheet(null) }, [pathname])

  const has = (type: ConnectorType) => activeConnectorTypes.includes(type)

  const visible = (item: NavItem): NavItem[] => {
    if (!item.children) return [item]
    const children = isAdminPreview ? item.children : item.children.filter(child => {
      if (child.requiredConnector && !has(child.requiredConnector)) return false
      if (child.key === 'maps_ranking' && !hasLocalDominator) return false
      return true
    })
    return children
  }

  const sections = NAV
    .map(section => ({ section, children: visible(section) }))
    .filter(({ children }) => children.length > 0)

  if (sections.length <= 1) return null

  const label = (item: NavItem) => (item.key === 'crm' ? crmName : item.label)

  const isActive = (item: NavItem, children: NavItem[]) =>
    item.href
      ? pathname === item.href
      : children.some(c => c.href && pathname.startsWith(c.href))

  return (
    <>
      {sheet && (
        <>
          <div className="dash-sheet__scrim" onClick={() => setSheet(null)} aria-hidden />
          <div className="dash-sheet" role="dialog" aria-label={label(sheet)}>
            <p className="dash-sheet__title">{label(sheet)}</p>
            {visible(sheet).map(child => (
              <Link
                key={child.key}
                href={child.href ?? '/dashboard'}
                className="dash-sheet__item"
                aria-current={pathname === child.href ? 'page' : undefined}
              >
                {child.label}
              </Link>
            ))}
          </div>
        </>
      )}

      <nav className="dash-bottom-nav" aria-label="Sections">
        {sections.map(({ section, children }) => {
          const active = isActive(section, children)
          const single = !section.children || children.length === 1
          const href   = section.href ?? children[0]?.href ?? '/dashboard'

          return single ? (
            <Link
              key={section.key}
              href={href}
              className="dash-bottom-nav__item"
              data-active={active ? 'true' : 'false'}
              aria-current={active ? 'page' : undefined}
            >
              <span className="dash-bottom-nav__icon" aria-hidden>{section.icon}</span>
              <span className="dash-bottom-nav__label">{label(section)}</span>
            </Link>
          ) : (
            <button
              key={section.key}
              type="button"
              className="dash-bottom-nav__item"
              data-active={active ? 'true' : 'false'}
              onClick={() => setSheet(section)}
              aria-haspopup="dialog"
            >
              <span className="dash-bottom-nav__icon" aria-hidden>{section.icon}</span>
              <span className="dash-bottom-nav__label">{label(section)}</span>
            </button>
          )
        })}
      </nav>
    </>
  )
}
