'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Admin Sidebar
//
// Left sidebar navigation for the admin panel. Features:
//   - Agency logo + app version at the top
//   - Primary navigation sections
//   - User card at the bottom
//
// Sections and nav items are rendered as simple anchor links so active state
// is driven by pathname matching (no client-side router required for the shell).
// ─────────────────────────────────────────────────────────────────────────────

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface NavItem {
  href: string
  label: string
  /** Simple single-character or emoji icon. */
  icon: string
  /** Match sub-paths too (e.g. /admin/clients/[id] should highlight Clients). */
  matchPrefix?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { href: '/admin',                   label: 'Overview',          icon: '◈',  matchPrefix: false },
  { href: '/admin/clients',           label: 'Clients',           icon: '⊡',  matchPrefix: true  },
  { href: '/admin/connections',       label: 'Data Connections',  icon: '⟳',  matchPrefix: true  },
  { href: '/admin/categories',        label: 'Campaign Categories', icon: '⊞', matchPrefix: true },
  { href: '/admin/users',             label: 'Users',             icon: '◎',  matchPrefix: true  },
  { href: '/admin/settings',          label: 'Agency Settings',   icon: '⊙',  matchPrefix: true  },
  { href: '/admin/system',            label: 'System',            icon: '⚙',  matchPrefix: true  },
]

interface SidebarProps {
  agencyName: string
  agencyLogoUrl?: string
  appVersion: string
  userName: string
  userEmail: string
  userAvatarUrl?: string
}

export default function Sidebar({
  agencyName,
  agencyLogoUrl,
  appVersion,
  userName,
  userEmail,
  userAvatarUrl,
}: SidebarProps) {
  const pathname = usePathname()

  function isActive(item: NavItem): boolean {
    if (item.matchPrefix === false) {
      return pathname === item.href
    }
    return pathname === item.href || pathname.startsWith(item.href + '/')
  }

  // Get initials for avatar fallback
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
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border)',
        flexShrink: 0,
      }}
    >
      {/* ── Top: Agency branding ─────────────────────────── */}
      <div
        style={{
          padding: '1.25rem 1rem 1rem',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div className="flex items-center gap-2.5 mb-0.5">
          {agencyLogoUrl ? (
            <img
              src={agencyLogoUrl}
              alt={agencyName}
              className="h-7 max-w-[120px] object-contain"
            />
          ) : (
            <div
              className="h-7 w-7 rounded-lg flex items-center justify-center text-white text-xs font-bold"
              style={{ background: 'var(--blue)', flexShrink: 0 }}
            >
              {agencyName.slice(0, 1).toUpperCase()}
            </div>
          )}
          <span
            className="font-semibold text-sm truncate"
            style={{ color: 'var(--text-primary)' }}
          >
            {agencyName}
          </span>
        </div>
        <p
          className="text-xs ml-9"
          style={{ color: 'var(--text-faint)' }}
        >
          v{appVersion}
        </p>
      </div>

      {/* ── Navigation ───────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto" style={{ padding: '0.75rem 0.625rem' }}>
        <div className="space-y-0.5">
          {NAV_ITEMS.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item ${isActive(item) ? 'active' : ''}`}
            >
              <span
                className="text-base leading-none"
                style={{ width: '1.125rem', textAlign: 'center', flexShrink: 0 }}
                aria-hidden
              >
                {item.icon}
              </span>
              {item.label}
            </Link>
          ))}
        </div>
      </nav>

      {/* ── Bottom: User card ────────────────────────────── */}
      <div
        style={{
          padding: '0.75rem',
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        <Link
          href="/admin/users/me"
          className="flex items-center gap-2.5 p-2 rounded-lg transition-colors hover:bg-[var(--bg-subtle)] group"
          style={{ textDecoration: 'none' }}
        >
          {/* Avatar */}
          {userAvatarUrl ? (
            <img
              src={userAvatarUrl}
              alt={userName}
              className="h-8 w-8 rounded-full object-cover flex-shrink-0"
            />
          ) : (
            <div
              className="h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
              style={{ background: 'var(--blue)' }}
            >
              {initials}
            </div>
          )}

          {/* Name + email */}
          <div className="min-w-0 flex-1">
            <p
              className="text-sm font-medium truncate leading-tight"
              style={{ color: 'var(--text-primary)' }}
            >
              {userName}
            </p>
            <p
              className="text-xs truncate leading-tight"
              style={{ color: 'var(--text-faint)' }}
            >
              {userEmail}
            </p>
          </div>

          {/* Settings caret */}
          <span
            className="text-xs opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
            style={{ color: 'var(--text-faint)' }}
          >
            →
          </span>
        </Link>
      </div>
    </aside>
  )
}
