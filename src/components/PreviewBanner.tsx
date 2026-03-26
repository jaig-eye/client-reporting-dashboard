'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function PreviewBanner({
  client,
  allClients,
}: {
  client:     { id: string; name: string }
  allClients: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  async function switchTo(clientId: string) {
    if (clientId === client.id) { setOpen(false); return }
    setLoading(true)
    await fetch(`/api/admin/preview/${clientId}`, { method: 'POST' })
    router.push('/dashboard')
    router.refresh()
    setLoading(false)
    setOpen(false)
  }

  async function exitPreview() {
    await fetch('/api/admin/preview/exit', { method: 'POST' })
    router.push('/admin')
  }

  return (
    <div style={{
      background: '#1e293b',
      color: '#e2e8f0',
      padding: '0 1.5rem',
      height: 36,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      fontSize: '0.78rem',
      position: 'relative',
      zIndex: 20,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: '#64748b', fontWeight: 500 }}>ADMIN PREVIEW</span>
        <span style={{ color: '#475569' }}>·</span>

        {/* Client switcher */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setOpen(!open)}
            disabled={loading}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 6, padding: '3px 8px', color: '#e2e8f0',
              cursor: 'pointer', fontSize: '0.78rem', fontWeight: 500,
            }}
          >
            {client.name}
            <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 10.5L3 5.5h10L8 10.5z" />
            </svg>
          </button>

          {open && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={() => setOpen(false)} />
              <div style={{
                position: 'absolute', top: 30, left: 0, minWidth: 200,
                background: '#1e293b', border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                zIndex: 50, padding: '4px 0',
              }}>
                {allClients.map(c => (
                  <button
                    key={c.id}
                    onClick={() => switchTo(c.id)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '7px 12px', border: 'none',
                      background: c.id === client.id ? 'rgba(255,255,255,0.08)' : 'transparent',
                      color: c.id === client.id ? '#60a5fa' : '#cbd5e1',
                      fontSize: '0.8rem', fontWeight: c.id === client.id ? 600 : 400,
                      cursor: 'pointer',
                    }}
                    onMouseEnter={e => { if (c.id !== client.id) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.05)' }}
                    onMouseLeave={e => { if (c.id !== client.id) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <button
        onClick={exitPreview}
        style={{
          background: 'none', border: 'none', color: '#64748b',
          cursor: 'pointer', fontSize: '0.75rem', padding: '2px 6px',
          borderRadius: 4,
        }}
        onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
        onMouseLeave={e => (e.currentTarget.style.color = '#64748b')}
      >
        ← Back to Admin
      </button>
    </div>
  )
}
