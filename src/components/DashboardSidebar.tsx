'use client'

// ─────────────────────────────────────────────────────────────────────────────
// DashboardSidebar
//
// Persistent left-sidebar navigation for the client dashboard and admin preview.
// Replaces the flat PlatformTabs header with a structured hierarchy that mirrors
// how reporting conversations flow: Summary → Paid Ads → Analytics → SEO.
//
// Props:
//   activeConnectorTypes — which connector types this client has active connections for
//   agencyLogoUrl        — optional agency logo shown at the top of the sidebar
//   agencyName           — agency display name
//   clientLogoUrl        — optional client logo
//   clientName           — client display name
// ─────────────────────────────────────────────────────────────────────────────

import { usePathname, useSearchParams, useRouter } from 'next/navigation'
import { useState } from 'react'
import type { ConnectorType } from '@/lib/types'

interface SidebarProps {
  activeConnectorTypes: ConnectorType[]
  agencyLogoUrl?: string | null
  agencyName?: string
  clientLogoUrl?: string | null
  clientName?: string
  basePath?: string        // prefix for all nav links (e.g. /admin/preview/[clientId])
  isAdminPreview?: boolean // when true, show all nav items even if connector not active
}

// ─── Nav item definitions ────────────────────────────────────────────────────

interface NavItem {
  key: string
  label: string
  href?: string
  icon?: string
  children?: NavItem[]
  requiredConnector?: ConnectorType
  badge?: string   // e.g. "Coming Soon"
  disabled?: boolean
}

const NAV: NavItem[] = [
  {
    key: 'summary',
    label: 'Summary',
    icon: '◈',
    href: '/dashboard',
  },
  {
    key: 'paid_ads',
    label: 'Paid Ads',
    icon: '◎',
    children: [
      { key: 'google_ads',  label: 'Google Ads', requiredConnector: 'google_ads',  href: '/dashboard?source=google_ads' },
      { key: 'meta_ads',    label: 'Meta Ads',   requiredConnector: 'meta_ads',    href: '/dashboard?source=meta_ads' },
    ],
  },
  {
    key: 'analytics',
    label: 'Analytics',
    icon: '◷',
    children: [
      { key: 'ga4', label: 'GA4', requiredConnector: 'google_analytics', href: '/dashboard/analytics' },
    ],
  },
  {
    key: 'seo',
    label: 'SEO',
    icon: '◉',
    children: [
      { key: 'gsc', label: 'Search Console',          requiredConnector: 'google_search_console',   href: '/dashboard/seo/search-console' },
      { key: 'gbp', label: 'Google Business Profile', requiredConnector: 'google_business_profile',  href: '/dashboard/seo/gbp' },
      { key: 'ahrefs', label: 'Authority (Ahrefs)',   disabled: true, badge: 'Soon', href: '/dashboard/seo/authority' },
    ],
  },
]

// ─── Component ────────────────────────────────────────────────────────────────

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
  // Read date params directly from URL so they're always current
  const from    = searchParams.get('from')    ?? ''
  const to      = searchParams.get('to')      ?? ''
  const compare = searchParams.get('compare') ?? ''

  // Sections default open
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
      // Preview mode: currentPath is the segment after basePath, item paths strip /dashboard
      const currentPath = pathname.replace(basePath, '') || '/'
      const comparePath = itemPath.replace(/^\/dashboard/, '') || '/'
      if (comparePath === '/' && !item.children) {
        return currentPath === '/' && (activeSource === '' || activeSource === 'all')
      }
      if (itemSource) {
        return currentPath === comparePath && activeSource === itemSource
      }
      return currentPath.startsWith(comparePath) && comparePath !== '/'
    } else {
      // Regular dashboard mode
      if (itemPath === '/dashboard' && !item.children) {
        return pathname === '/dashboard' && (activeSource === '' || activeSource === 'all')
      }
      if (itemSource) {
        return pathname === itemPath && activeSource === itemSource
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
      // Strip /dashboard prefix — preview root = basePath, sub-pages = basePath + /sub/path
      const subPath = url.pathname.replace(/^\/dashboard/, '')
      router.push(basePath + subPath + (url.search || ''))
    } else {
      router.push(url.pathname + (url.search || ''))
    }
  }

  function hasConnector(type?: ConnectorType): boolean {
    if (!type) return true
    return activeConnectorTypes.includes(type)
  }

  return (
    <aside
      style={{
        width: 220,
        flexShrink: 0,
        minHeight: '100vh',
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        position: 'sticky',
        top: 0,
        overflowY: 'auto',
      }}
    >
      {/* Brand header */}
      <div
        style={{
          padding: '16px 16px 12px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        {/* Agency branding */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          {agencyLogoUrl ? (
            <img src={agencyLogoUrl} alt={agencyName ?? ''} style={{ height: 20, maxWidth: 100, objectFit: 'contain' }} />
          ) : (
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {agencyName ?? 'Agency'}
            </span>
          )}
        </div>
        {/* Client identity */}
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
      <nav style={{ flex: 1, padding: '8px 0' }}>
        {NAV.map(section => {
          if (section.children) {
            // For client view, hide children whose connector isn't active
            const visibleChildren = isAdminPreview
              ? section.children
              : section.children.filter(child => !child.requiredConnector || hasConnector(child.requiredConnector))
            // Hide entire section if no visible children
            if (visibleChildren.length === 0) return null

            const sectionOpen = open[section.key] !== false
            return (
              <div key={section.key}>
                {/* Section header — clickable to collapse */}
                <button
                  onClick={() => toggle(section.key)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 16px',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    letterSpacing: '0.07em',
                    textTransform: 'uppercase',
                    color: 'var(--text-faint)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    marginTop: 8,
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: '0.6rem', opacity: 0.7 }}>{section.icon}</span>
                    {section.label}
                  </span>
                  <span style={{ fontSize: '0.6rem', opacity: 0.6, transform: sectionOpen ? 'rotate(0)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}>▾</span>
                </button>

                {sectionOpen && (
                  <div>
                    {visibleChildren.map(child => {
                      const connected  = hasConnector(child.requiredConnector)
                      const active     = isActive(child)
                      const showConnect = isAdminPreview && child.requiredConnector && !connected && !child.disabled

                      return (
                        <div key={child.key}>
                          <button
                            onClick={() => connected && !child.disabled ? navigate(child) : undefined}
                            disabled={child.disabled}
                            style={{
                              width: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              padding: '7px 16px 7px 28px',
                              fontSize: '0.8125rem',
                              fontWeight: active ? 600 : 400,
                              color: child.disabled
                                ? 'var(--text-faint)'
                                : active
                                ? 'var(--text-primary)'
                                : connected ? 'var(--text-secondary, var(--text-muted))' : 'var(--text-faint)',
                              background: active ? 'var(--blue-subtle, rgba(59,130,246,0.08))' : 'transparent',
                              borderTop: 'none',
                              borderRight: 'none',
                              borderBottom: 'none',
                              borderLeft: active ? '2px solid var(--blue)' : '2px solid transparent',
                              borderRadius: 0,
                              cursor: child.disabled || !connected ? 'default' : 'pointer',
                              textAlign: 'left',
                              transition: 'background 0.1s',
                            }}
                          >
                            {/* Status dot */}
                            <span style={{
                              width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                              background: child.disabled
                                ? 'var(--text-faint)'
                                : connected
                                ? (active ? 'var(--blue)' : 'var(--green)')
                                : 'var(--border)',
                            }} />

                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {child.label}
                            </span>

                            {child.badge && (
                              <span style={{
                                fontSize: '0.6rem', fontWeight: 600,
                                padding: '1px 5px', borderRadius: 20,
                                background: 'var(--bg-base)', color: 'var(--text-faint)',
                                border: '1px solid var(--border)',
                              }}>
                                {child.badge}
                              </span>
                            )}

                            {showConnect && (
                              <span style={{ fontSize: '0.6rem', color: 'var(--blue)', fontWeight: 600 }}>
                                + Connect
                              </span>
                            )}
                          </button>
                        </div>
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
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                fontSize: '0.8125rem',
                fontWeight: active ? 700 : 500,
                color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                background: active ? 'var(--blue-subtle, rgba(59,130,246,0.08))' : 'transparent',
                borderTop: 'none',
                borderRight: 'none',
                borderBottom: 'none',
                borderLeft: active ? '2px solid var(--blue)' : '2px solid transparent',
                borderRadius: 0,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background 0.1s',
                marginBottom: 2,
              }}
            >
              <span style={{ fontSize: '0.7rem', opacity: 0.8 }}>{section.icon}</span>
              {section.label}
            </button>
          )
        })}
      </nav>

      {/* Footer — subtle version indicator */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
        <p style={{ fontSize: '0.65rem', color: 'var(--text-faint)', margin: 0 }}>
          LaunchLocal Reporting
        </p>
      </div>
    </aside>
  )
}
