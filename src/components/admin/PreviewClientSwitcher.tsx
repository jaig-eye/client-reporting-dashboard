'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface ClientOption {
  id: string
  name: string
  logo_url: string | null
}

export default function PreviewClientSwitcher({
  currentClient,
  clients,
}: {
  currentClient: ClientOption
  clients: ClientOption[]
}) {
  const router   = useRouter()
  const [open, setOpen]     = useState(false)
  const [query, setQuery]   = useState('')
  const ref      = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Close on outside click
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  // Focus search input when opened
  useEffect(() => {
    if (open) {
      setQuery('')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const filtered = clients.filter(c =>
    c.name.toLowerCase().includes(query.toLowerCase())
  )

  function select(id: string) {
    setOpen(false)
    router.push(`/admin/preview/${id}`)
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 6, padding: '4px 10px 4px 8px', cursor: 'pointer',
          color: '#e2e8f0', fontSize: '0.78rem', fontWeight: 500, whiteSpace: 'nowrap',
        }}
      >
        {currentClient.logo_url && (
          <img src={currentClient.logo_url} alt="" style={{ height: 16, width: 16, objectFit: 'contain', borderRadius: 2, flexShrink: 0 }} />
        )}
        <span>{currentClient.name}</span>
        <span style={{ opacity: 0.5, fontSize: '0.65rem', marginLeft: 2 }}>▾</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 999,
            background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            width: 260, maxHeight: 360, display: 'flex', flexDirection: 'column',
          }}
        >
          {/* Search */}
          <div style={{ padding: '8px 10px', borderBottom: '1px solid #334155' }}>
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search clients…"
              style={{
                width: '100%', background: 'rgba(255,255,255,0.07)',
                border: '1px solid #475569', borderRadius: 5, padding: '5px 9px',
                color: '#e2e8f0', fontSize: '0.78rem', outline: 'none',
              }}
            />
          </div>

          {/* List */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.length === 0 ? (
              <p style={{ padding: '12px 12px', color: '#64748b', fontSize: '0.75rem' }}>No clients found</p>
            ) : (
              filtered.map(c => (
                <button
                  key={c.id}
                  onClick={() => select(c.id)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', background: c.id === currentClient.id ? 'rgba(255,255,255,0.08)' : 'transparent',
                    border: 'none', cursor: 'pointer', color: '#cbd5e1', fontSize: '0.8rem',
                    textAlign: 'left',
                  }}
                  onMouseEnter={e => { if (c.id !== currentClient.id) e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
                  onMouseLeave={e => { if (c.id !== currentClient.id) e.currentTarget.style.background = 'transparent' }}
                >
                  {c.logo_url ? (
                    <img src={c.logo_url} alt="" style={{ height: 18, width: 18, objectFit: 'contain', borderRadius: 2, flexShrink: 0 }} />
                  ) : (
                    <div style={{ height: 18, width: 18, background: '#3b82f6', borderRadius: 3, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '0.6rem', fontWeight: 700 }}>
                      {c.name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                  {c.id === currentClient.id && <span style={{ color: '#3b82f6', fontSize: '0.7rem' }}>✓</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
