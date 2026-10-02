'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { CaretDown, Check } from '@phosphor-icons/react'

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

  async function select(id: string) {
    setOpen(false)
    // Set the client_token cookie for the new client before navigating
    await fetch(`/api/admin/preview/${id}`, { method: 'POST' })
    router.push(`/admin/preview/${id}`)
  }

  return (
    <div ref={ref} className="pv-switch">
      <button type="button" className="pv-trigger" onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open}>
        {currentClient.logo_url && <img src={currentClient.logo_url} alt="" className="pv-logo" />}
        <span>{currentClient.name}</span>
        <CaretDown size={12} weight="bold" aria-hidden />
      </button>

      {open && (
        <div className="pv-menu">
          <div className="pv-search">
            <input
              ref={inputRef}
              className="input"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search clients"
              aria-label="Search clients"
              onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
            />
          </div>
          <div className="pv-list" role="listbox" aria-label="Clients">
            {filtered.length === 0 ? (
              <p className="pv-empty">No clients match.</p>
            ) : (
              filtered.map(c => (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={c.id === currentClient.id}
                  aria-current={c.id === currentClient.id || undefined}
                  className="pv-item"
                  onClick={() => select(c.id)}
                >
                  {c.logo_url
                    ? <img src={c.logo_url} alt="" className="pv-logo" />
                    : <span className="pv-initial" aria-hidden>{c.name.slice(0, 1).toUpperCase()}</span>}
                  <span className="pv-item-name">{c.name}</span>
                  {c.id === currentClient.id && <Check size={13} weight="bold" className="pv-check" aria-hidden />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
