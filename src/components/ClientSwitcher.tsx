'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

interface ClientOption {
  id:   string
  name: string
}

export default function ClientSwitcher({
  clients,
  currentClientId,
}: {
  clients:         ClientOption[]
  currentClientId: string
}) {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)

  const current = clients.find(c => c.id === currentClientId)

  function switchTo(id: string) {
    const p = new URLSearchParams(searchParams.toString())
    p.set('viewAs', id)
    // Remove source so the new client auto-redirects to their default platform
    p.delete('source')
    router.push(`/dashboard?${p.toString()}`)
    setOpen(false)
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '0.3rem 0.6rem',
          background: 'var(--bg-subtle)', border: '1px solid var(--border)',
          borderRadius: 8, cursor: 'pointer', fontSize: '0.8rem',
          color: 'var(--text-secondary)', fontWeight: 500,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="8" cy="5" r="3" />
          <path d="M2 14c0-3.314 2.686-6 6-6s6 2.686 6 6" strokeLinecap="round" />
        </svg>
        <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {current?.name ?? 'Select client'}
        </span>
        <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 10.5L3 5.5h10L8 10.5z" />
        </svg>
      </button>

      {open && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 49 }}
            onClick={() => setOpen(false)}
          />
          <div style={{
            position: 'absolute', top: 36, right: 0, minWidth: 200, maxWidth: 280,
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            zIndex: 50, padding: '6px 4px', maxHeight: 320, overflowY: 'auto',
          }}>
            <p style={{
              fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-faint)',
              textTransform: 'uppercase', letterSpacing: '0.05em',
              padding: '4px 10px 6px',
            }}>
              Agency clients
            </p>
            {clients.map(c => (
              <button
                key={c.id}
                onClick={() => switchTo(c.id)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '7px 10px', borderRadius: 6, border: 'none',
                  background: c.id === currentClientId ? 'var(--bg-subtle)' : 'transparent',
                  color: c.id === currentClientId ? 'var(--blue)' : 'var(--text-secondary)',
                  fontWeight: c.id === currentClientId ? 600 : 400,
                  fontSize: '0.82rem', cursor: 'pointer',
                }}
                onMouseEnter={e => { if (c.id !== currentClientId) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-subtle)' }}
                onMouseLeave={e => { if (c.id !== currentClientId) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
              >
                {c.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
