'use client'

// The account row at the bottom of the sidebar, and its menu: your profile, alerts, payment
// sounds, sign out. Opens upward, over the navigation.

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { DotsThreeVertical, UserCircle, Bell, SignOut } from '@phosphor-icons/react'
import SoundToggle from './SoundToggle'

interface Props {
  userName:          string
  userEmail:         string
  userAvatarUrl?:    string
  isSuperAdmin?:     boolean
  unreadAlertCount?: number
}

export default function UserMenu({
  userName, userEmail, userAvatarUrl, isSuperAdmin = false, unreadAlertCount = 0,
}: Props) {
  const router = useRouter()
  const [open, setOpen]             = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const rootRef    = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false) }
    // Escape closes and returns focus to the button, so the keyboard isn't lost.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus() } }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
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

  return (
    <div ref={rootRef} className="adm-um">
      <div className="adm-um-row">
        {userAvatarUrl
          ? <img src={userAvatarUrl} alt="" className="adm-um-avatar" />
          : <span className="adm-um-avatar adm-um-avatar--initials" aria-hidden>{isSuperAdmin ? 'SA' : initials}</span>}
        <div className="adm-um-text">
          <p className="adm-um-name">{isSuperAdmin ? 'Super Admin' : userName}</p>
          <p className="adm-um-email">{isSuperAdmin ? 'Master account' : userEmail}</p>
        </div>
        <button
          ref={triggerRef}
          type="button"
          className="adm-um-trigger"
          onClick={() => setOpen(o => !o)}
          aria-haspopup="true"
          aria-expanded={open}
          aria-label={unreadAlertCount > 0 ? `Account menu, ${unreadAlertCount} unread alert${unreadAlertCount === 1 ? '' : 's'}` : 'Account menu'}
        >
          <DotsThreeVertical size={18} weight="bold" aria-hidden />
          {unreadAlertCount > 0 && <span className="adm-um-dot" aria-hidden />}
        </button>
      </div>

      {open && (
        <div className="adm-um-menu" aria-label="Account" role="group">
          {!isSuperAdmin && (
            <Link href="/admin/users/me" className="adm-um-item" onClick={() => setOpen(false)}>
              <UserCircle size={16} aria-hidden />My profile
            </Link>
          )}
          <Link href="/admin/alerts" className="adm-um-item" onClick={() => setOpen(false)}>
            <Bell size={16} aria-hidden />
            <span style={{ flex: 1 }}>Alerts</span>
            {unreadAlertCount > 0 && <span className="adm-nav-count">{unreadAlertCount > 99 ? '99+' : unreadAlertCount}</span>}
          </Link>
          <SoundToggle />
          <div className="ui-menu-sep" role="separator" />
          <button type="button" onClick={handleLogout} disabled={loggingOut} className="adm-um-item">
            <SignOut size={16} aria-hidden />{loggingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  )
}
