'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Client {
  id: string
  name: string
  dashboard_token: string
}

interface Props {
  currentClientId: string
  currentClientName: string
  dashboardToken: string
  clients: Client[]
  appUrl: string
}

export default function AdminDashboardBar({
  currentClientId,
  currentClientName,
  dashboardToken,
  clients,
  appUrl,
}: Props) {
  const router = useRouter()
  const [switching, setSwitching] = useState(false)
  const [copied,    setCopied]    = useState(false)

  async function handleClientSwitch(clientId: string) {
    if (clientId === currentClientId) return
    setSwitching(true)
    // Use GET redirect via the preview route
    window.location.href = `/api/admin/preview/${clientId}`
  }

  function handleCopyLink() {
    const url = `${appUrl}/api/auth/access?token=${dashboardToken}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      height: 40,
      zIndex: 9999,
      background: 'var(--accent, #2563eb)',
      display: 'flex',
      alignItems: 'center',
      paddingLeft: '0.75rem',
      paddingRight: '0.75rem',
      gap: '0.75rem',
      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
    }}>
      {/* Back button */}
      <a
        href="/admin/dashboard"
        style={{
          display: 'flex', alignItems: 'center', gap: '0.3rem',
          color: 'rgba(255,255,255,0.85)', textDecoration: 'none',
          fontSize: '0.75rem', fontWeight: 500, whiteSpace: 'nowrap',
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
        onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.85)')}
      >
        ← Admin
      </a>

      <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.875rem' }}>|</span>

      {/* Admin badge */}
      <span style={{
        background: 'rgba(255,255,255,0.15)', borderRadius: 4,
        padding: '0.125rem 0.4rem', fontSize: '0.6875rem', fontWeight: 700,
        color: '#fff', letterSpacing: '0.03em', textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}>
        Admin View
      </span>

      {/* Client switcher */}
      <select
        value={currentClientId}
        disabled={switching}
        onChange={e => handleClientSwitch(e.target.value)}
        style={{
          background: 'rgba(255,255,255,0.15)',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: 6, color: '#fff',
          fontSize: '0.75rem', fontWeight: 500,
          padding: '0.25rem 0.5rem',
          cursor: 'pointer', maxWidth: 180,
          appearance: 'none', WebkitAppearance: 'none',
        }}
      >
        {clients.map(c => (
          <option key={c.id} value={c.id} style={{ background: '#1e40af', color: '#fff' }}>
            {c.name}
          </option>
        ))}
      </select>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Settings link */}
      <a
        href={`/admin/clients/${currentClientId}`}
        style={{
          color: 'rgba(255,255,255,0.85)', textDecoration: 'none',
          fontSize: '0.75rem', fontWeight: 500, whiteSpace: 'nowrap',
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
        onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.85)')}
      >
        Client Settings
      </a>

      {/* Share link */}
      <button
        onClick={handleCopyLink}
        style={{
          background: 'rgba(255,255,255,0.15)',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: 6, color: '#fff',
          fontSize: '0.75rem', fontWeight: 500,
          padding: '0.25rem 0.65rem',
          cursor: 'pointer', whiteSpace: 'nowrap',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.25)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')}
      >
        {copied ? '✓ Copied!' : '⎘ Share Link'}
      </button>
    </div>
  )
}
