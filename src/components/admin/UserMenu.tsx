'use client'

// Bottom-of-sidebar account row + three-dot popover menu.
// Consolidates profile, alerts, the payment-sounds toggle, and sign-out into one
// menu so the sidebar footer stays clean. Reuses SoundToggle verbatim.

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { DotsThreeVertical, UserCircle, Bell, SignOut } from '@phosphor-icons/react'
import SoundToggle from './SoundToggle'

interface Props {
  userName:         string
  userEmail:        string
  userAvatarUrl?:   string
  isSuperAdmin?:    boolean
  unreadAlertCount?: number
}

export default function UserMenu({
  userName, userEmail, userAvatarUrl, isSuperAdmin = false, unreadAlertCount = 0,
}: Props) {
  const router = useRouter()
  const [open, setOpen]           = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const rootRef    = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // Escape closes and returns focus to the trigger (keyboard users don't get lost).
  function closeAndRefocus() { setOpen(false); triggerRef.current?.focus() }

  // Close on click-outside and Escape
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') closeAndRefocus() }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await fetch('/api/auth/admin-logout', { method: 'POST' })
      router.push('/admin')
      router.refresh()
    } catch {
      setLoggingOut(false)  // let the user retry rather than hang on "Signing out…"
    }
  }

  const initials = userName.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2)

  const avatar = userAvatarUrl
    ? <img src={userAvatarUrl} alt="" className="h-8 w-8 rounded-full object-cover flex-shrink-0" />
    : <div className="h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0" style={{ background: 'var(--blue)' }}>
        {isSuperAdmin ? 'SA' : initials}
      </div>

  const menuItemStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
    padding: '0.5rem 0.625rem', borderRadius: 8, fontSize: '0.8125rem',
    color: 'var(--text-secondary)', textDecoration: 'none', background: 'transparent',
    border: 'none', cursor: 'pointer', textAlign: 'left', minHeight: 36,
  }
  const hoverOn  = (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = 'var(--bg-subtle)' }
  const hoverOff = (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = 'transparent' }

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      {/* User row + trigger */}
      <div className="flex items-center gap-2.5 p-2 rounded-lg" style={{ position: 'relative' }}>
        {avatar}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate leading-tight" style={{ color: 'var(--text-primary)' }}>
            {isSuperAdmin ? 'Super Admin' : userName}
          </p>
          <p className="text-xs truncate leading-tight" style={{ color: 'var(--text-faint)' }}>
            {isSuperAdmin ? 'Master account' : userEmail}
          </p>
        </div>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-haspopup="true"
          aria-expanded={open}
          aria-label={unreadAlertCount > 0 ? `Account menu, ${unreadAlertCount} unread alert${unreadAlertCount === 1 ? '' : 's'}` : 'Account menu'}
          className="focus-ring flex-shrink-0"
          style={{
            position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 30, height: 30, borderRadius: 8, border: 'none', cursor: 'pointer',
            background: open ? 'var(--bg-subtle)' : 'transparent', color: 'var(--text-muted)',
            transition: 'background 0.1s',
          }}
          onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'var(--bg-subtle)' }}
          onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'transparent' }}
        >
          <DotsThreeVertical size={18} weight="bold" aria-hidden />
          {unreadAlertCount > 0 && (
            <span
              aria-hidden
              style={{
                position: 'absolute', top: 4, right: 4, width: 8, height: 8, borderRadius: '50%',
                background: 'var(--red)', boxShadow: '0 0 0 2px var(--sidebar-bg)',
              }}
            />
          )}
        </button>
      </div>

      {/* Popover */}
      {open && (
        <div
          aria-label="Account"
          style={{
            position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, right: 0,
            background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10,
            boxShadow: '0 8px 28px rgba(0,0,0,0.16)', padding: 6, zIndex: 60,
          }}
        >
          {!isSuperAdmin && (
            <Link href="/admin/users/me" className="focus-ring" style={menuItemStyle}
              onClick={() => setOpen(false)} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
              <UserCircle size={16} aria-hidden />
              Edit profile
            </Link>
          )}

          <Link href="/admin/alerts" className="focus-ring" style={menuItemStyle}
            onClick={() => setOpen(false)} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
            <Bell size={16} aria-hidden />
            <span style={{ flex: 1 }}>Alerts</span>
            {unreadAlertCount > 0 && (
              <span style={{
                minWidth: 18, height: 18, background: 'var(--red)', color: '#fff', borderRadius: 9,
                fontSize: '0.625rem', fontWeight: 700, display: 'flex', alignItems: 'center',
                justifyContent: 'center', padding: '0 5px',
              }}>
                {unreadAlertCount > 99 ? '99+' : unreadAlertCount}
              </span>
            )}
          </Link>

          {/* Payment sounds toggle (reused; full-width button fits the menu) */}
          <SoundToggle />

          <div style={{ height: 1, background: 'var(--border)', margin: '4px 2px' }} />

          <button type="button" onClick={handleLogout} disabled={loggingOut}
            className="focus-ring" style={{ ...menuItemStyle, color: 'var(--text-muted)', cursor: loggingOut ? 'not-allowed' : 'pointer' }}
            onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
            <SignOut size={16} aria-hidden />
            {loggingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  )
}
