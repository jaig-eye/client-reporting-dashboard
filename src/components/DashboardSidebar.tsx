'use client'

import { usePathname, useSearchParams, useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  SquaresFour,
  ChartBar,
  ChartLineUp,
  MagnifyingGlass,
  CaretDown,
  Gauge,
  Circle,
} from '@phosphor-icons/react'
import type { ConnectorType } from '@/lib/types'

interface SidebarProps {
  activeConnectorTypes: ConnectorType[]
  agencyLogoUrl?: string | null
  agencyName?: string
  clientLogoUrl?: string | null
  clientName?: string
  basePath?: string
  isAdminPreview?: boolean
}

interface NavItem {
  key: string
  label: string
  href?: string
  icon?: React.ReactNode
  children?: NavItem[]
  requiredConnector?: ConnectorType
  badge?: string
  disabled?: boolean
}

const NAV: NavItem[] = [
  {
    key: 'summary',
    label: 'Summary',
    icon: <SquaresFour size={15} aria-hidden />,
    href: '/dashboard',
  },
  {
    key: 'paid_ads',
    label: 'Paid Ads',
    icon: <ChartBar size={13} aria-hidden />,
    children: [
      { key: 'google_ads', label: 'Google Ads', requiredConnector: 'google_ads',  href: '/dashboard?source=google_ads' },
      { key: 'meta_ads',   label: 'Meta Ads',   requiredConnector: 'meta_ads',    href: '/dashboard?source=meta_ads'   },
    ],
  },
  {
    key: 'analytics',
    label: 'Analytics',
    icon: <ChartLineUp size={13} aria-hidden />,
    children: [
      { key: 'ga4', label: 'GA4', requiredConnector: 'google_analytics', href: '/dashboard/analytics' },
    ],
  },
  {
    key: 'seo',
    label: 'SEO',
    icon: <MagnifyingGlass size={13} aria-hidden />,
    children: [
      { key: 'gsc',    label: 'Search Console',          requiredConnector: 'google_search_console',  href: '/dashboard/seo/search-console' },
      { key: 'gbp',    label: 'Business Profile',        requiredConnector: 'google_business_profile', href: '/dashboard/seo/gbp'            },
      { key: 'ahrefs', label: 'Authority (Ahrefs)',      disabled: true, badge: 'Soon',               href: '/dashboard/seo/authority'      },
    ],
  },
]

export default function DashboardSidebar({
  activeConnectorTypes,
  agencyLogoUrl,
  agencyName,
  clientLogoUrl,
  clientName,
  basePath = '',
  isAdminPreview = false,
}: SidebarProps) {
  const pathname     = usePathname()
  const searchParams = useSearchParams()
  const router       = useRouter()
  const activeSource = searchParams.get('source') ?? ''
  const from    = searchParams.get('from')    ?? ''
  const to      = searchParams.get('to')      ?? ''
  const compare = searchParams.get('compare') ?? ''

  const [open, setOpen] = useState<Record<string, boolean>>({
    paid_ads:  true,
    analytics: true,
    seo:       true,
  })

  function toggle(key: string) {
    setOpen(prev => ({ ...prev, [key]: !prev[key] }))
  }

  function isActive(item: NavItem): boolean {
    if (!item.href) return false
    const url = new URL(item.href, 'http://x')
    const itemPath   = url.pathname
    const itemSource = url.searchParams.get('source') ?? ''

    if (basePath) {
      const currentPath = pathname.replace(basePath, '') || '/'
      const comparePath = itemPath.replace(/^\/dashboard/, '') || '/'
      if (itemSource) {
        return currentPath === comparePath && activeSource === itemSource
      }
      if (comparePath === '/' && !item.children) {
        return currentPath === '/' && (activeSource === '' || activeSource === 'all')
      }
      return currentPath.startsWith(comparePath) && comparePath !== '/'
    } else {
      if (itemSource) {
        return pathname === itemPath && activeSource === itemSource
      }
      if (itemPath === '/dashboard' && !item.children) {
        return pathname === '/dashboard' && (activeSource === '' || activeSource === 'all')
      }
      return pathname.startsWith(itemPath) && itemPath !== '/dashboard'
    }
  }

  function navigate(item: NavItem) {
    if (item.disabled || !item.href) return
    const url = new URL(item.href, 'http://x')
    if (from) url.searchParams.set('from', from)
    if (to)   url.searchParams.set('to',   to)
    if (compare && compare !== 'none') url.searchParams.set('compare', compare)
    if (basePath) {
      const subPath = url.pathname.replace(/^\/dashboard/, '')
      router.push(basePath + subPath + (url.search || ''))
    } else {
      router.push(url.pathname + (url.search || ''))
    }
    // Invalidate router cache so re-visiting the same source URL always
    // fetches fresh server data. Called synchronously here (not in useEffect)
    // to avoid the double-render race that affected the old NavigationRefresher.
    router.refresh()
  }

  function hasConnector(type?: ConnectorType): boolean {
    if (!type) return true
    return activeConnectorTypes.includes(type)
  }

  return (
    <aside
      style={{
        width: 'var(--sidebar-width)',
        flexShrink: 0,
        minHeight: '100vh',
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        position: 'sticky',
        top: 0,
        overflowY: 'auto',
      }}
    >
      {/* Brand header */}
      <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--border)' }}>
        {/* Agency */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          {agencyLogoUrl ? (
            <img src={agencyLogoUrl} alt={agencyName ?? ''} aria-hidden={!agencyName} style={{ height: 20, maxWidth: 100, objectFit: 'contain' }} />
          ) : (
            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {agencyName ?? 'Agency'}
            </span>
          )}
        </div>
        {/* Client */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {clientLogoUrl && (
            <img src={clientLogoUrl} alt={clientName ?? ''} style={{ height: 18, maxWidth: 60, objectFit: 'contain', borderRadius: 3 }} />
          )}
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {clientName ?? ''}
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, padding: '8px 8px' }}>
        {NAV.map(section => {
          if (section.children) {
            const visibleChildren = isAdminPreview
              ? section.children
              : section.children.filter(child => !child.requiredConnector || hasConnector(child.requiredConnector))
            if (visibleChildren.length === 0) return null

            const sectionOpen = open[section.key] !== false
            return (
              <div key={section.key}>
                <button
                  onClick={() => toggle(section.key)}
                  className="focus-ring"
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '5px 8px',
                    marginTop: 10,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    borderRadius: '0.375rem',
                  }}
                  aria-expanded={sectionOpen}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }} className="section-label">
                    <span style={{ opacity: 0.7, display: 'flex', alignItems: 'center' }}>{section.icon}</span>
                    {section.label}
                  </span>
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      color: 'var(--text-faint)',
                      transform: sectionOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                      transition: 'transform 0.15s',
                    }}
                  >
                    <CaretDown size={10} aria-hidden />
                  </span>
                </button>

                {sectionOpen && (
                  <div style={{ marginBottom: 4 }}>
                    {visibleChildren.map(child => {
                      const connected   = hasConnector(child.requiredConnector)
                      const active      = isActive(child)
                      const showConnect = isAdminPreview && child.requiredConnector && !connected && !child.disabled

                      return (
                        <button
                          key={child.key}
                          onClick={() => connected && !child.disabled ? navigate(child) : undefined}
                          disabled={child.disabled}
                          className="focus-ring"
                          style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 7,
                            padding: '6px 8px 6px 20px',
                            fontSize: '0.8125rem',
                            fontWeight: active ? 600 : 400,
                            color: child.disabled
                              ? 'var(--text-faint)'
                              : active
                              ? 'var(--text-primary)'
                              : connected ? 'var(--text-secondary)' : 'var(--text-faint)',
                            background: active ? 'rgba(37,99,235,0.04)' : 'transparent',
                            borderTop: 'none',
                            borderRight: 'none',
                            borderBottom: 'none',
                            borderLeft: active ? '2px solid var(--blue)' : '2px solid transparent',
                            borderRadius: '0 0.375rem 0.375rem 0',
                            cursor: child.disabled || !connected ? 'default' : 'pointer',
                            textAlign: 'left',
                            transition: 'background 0.1s, color 0.1s',
                          }}
                        >
                          {/* Status dot */}
                          <Circle
                            size={5}
                            weight="fill"
                            aria-hidden
                            style={{
                              flexShrink: 0,
                              color: child.disabled
                                ? 'var(--text-faint)'
                                : connected
                                ? (active ? 'var(--blue)' : 'var(--green)')
                                : 'var(--border)',
                            }}
                          />

                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {child.label}
                          </span>

                          {child.badge && (
                            <span className="badge badge-gray" style={{ fontSize: '0.6rem' }}>
                              {child.badge}
                            </span>
                          )}

                          {showConnect && (
                            <span style={{ fontSize: '0.6rem', color: 'var(--blue)', fontWeight: 600 }}>
                              + Connect
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          }

          // Top-level item (Summary)
          const active = isActive(section)
          return (
            <button
              key={section.key}
              onClick={() => navigate(section)}
              className="focus-ring"
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 8px',
                fontSize: '0.8125rem',
                fontWeight: active ? 700 : 500,
                color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                background: active ? 'rgba(37,99,235,0.04)' : 'transparent',
                borderTop: 'none',
                borderRight: 'none',
                borderBottom: 'none',
                borderLeft: active ? '2px solid var(--blue)' : '2px solid transparent',
                borderRadius: '0 0.375rem 0.375rem 0',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background 0.1s, color 0.1s',
                marginBottom: 2,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', color: active ? 'var(--blue)' : 'var(--text-faint)' }}>
                {section.icon}
              </span>
              {section.label}
            </button>
          )
        })}
      </nav>

      {/* Footer */}
      <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 5 }}>
        <Gauge size={11} aria-hidden style={{ color: 'var(--text-faint)' }} />
        <p style={{ fontSize: '0.65rem', color: 'var(--text-faint)', margin: 0 }}>
          LaunchLocal Reporting
        </p>
      </div>
    </aside>
  )
}
