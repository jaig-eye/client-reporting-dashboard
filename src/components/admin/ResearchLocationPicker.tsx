'use client'

import { useEffect, useId, useRef, useState } from 'react'

/** Same shape as content_settings.research_location — a Google geo target DataForSEO knows. */
export interface ResearchLocationValue { code: number; name: string; type: string }

/** Whatever the API or the database handed back, as a location or nothing. */
export function readLocationValue(v: unknown): ResearchLocationValue | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const code = Number(o.code)
  const name = typeof o.name === 'string' ? o.name.trim() : ''
  if (!Number.isFinite(code) || code <= 0 || !name) return null
  return { code, name, type: typeof o.type === 'string' ? o.type : '' }
}

/** "Los Angeles County, California" from DataForSEO's "Los Angeles County,California,United States". */
export function formatLocation(l: ResearchLocationValue | null | undefined): string {
  if (!l) return ''
  const parts = l.name.split(',').map(s => s.trim()).filter(Boolean)
  return (parts.length > 1 ? parts.slice(0, -1) : parts).join(', ')
}

/** DataForSEO's location_type, in words an operator would use. */
function kindLabel(type: string): string {
  switch (type) {
    case 'City':         return 'city'
    case 'County':       return 'county'
    case 'State':        return 'state'
    case 'Province':     return 'province'
    case 'Municipality': return 'municipality'
    case 'Region':       return 'region'
    case 'Territory':    return 'territory'
    default:             return type.toLowerCase()
  }
}

/**
 * Type a place, pick the geo target. The list comes from DataForSEO's free locations endpoint
 * via /api/admin/content/dfs-locations; nothing here spends. Keyboard: arrows move, Enter picks,
 * Escape closes.
 */
export default function ResearchLocationPicker({ value, onChange, disabled, inputStyle, label = 'Research location' }: {
  value:       ResearchLocationValue | null
  onChange:    (v: ResearchLocationValue | null) => void
  disabled?:   boolean
  inputStyle?: React.CSSProperties
  /** Accessible name for the combobox. */
  label?:      string
}) {
  const [q, setQ]                 = useState('')
  const [options, setOptions]     = useState<ResearchLocationValue[]>([])
  const [open, setOpen]           = useState(false)
  const [active, setActive]       = useState(0)
  const [searching, setSearching] = useState(false)
  const [note, setNote]           = useState<string | null>(null)
  const [notConnected, setNotConnected] = useState(false)
  const timer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listId = useId()

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    const needle = q.trim()
    if (needle.length < 2) { setOptions([]); setNote(null); setOpen(false); return }
    let cancelled = false
    timer.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/admin/content/dfs-locations?q=${encodeURIComponent(needle)}`)
        const d = await res.json() as { locations?: ResearchLocationValue[]; error?: string }
        if (cancelled) return
        const found = d.locations ?? []
        setOptions(found)
        setActive(0)
        setNotConnected(!!d.error)
        setNote(d.error ? null : found.length ? null : 'No matching city, county or state.')
        setOpen(!d.error)
      } catch {
        if (!cancelled) { setOptions([]); setNote("Couldn't reach the location list. Check your connection and type again.") }
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 250)
    return () => { cancelled = true; setSearching(false); if (timer.current) clearTimeout(timer.current) }
  }, [q])

  function pick(o: ResearchLocationValue) {
    onChange(o)
    setQ(''); setOptions([]); setNote(null); setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || options.length === 0) {
      if (e.key === 'Escape') setOpen(false)
      return
    }
    if (e.key === 'ArrowDown')      { e.preventDefault(); setActive(a => Math.min(options.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(a => Math.max(0, a - 1)) }
    else if (e.key === 'Enter')     { e.preventDefault(); const o = options[active]; if (o) pick(o) }
    else if (e.key === 'Escape')    { setOpen(false) }
  }

  if (value) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 12px', borderRadius: 999,
        background: 'var(--bg-subtle)', border: '1px solid var(--border)', fontSize: '0.8125rem',
      }}>
        <span>{formatLocation(value)}</span>
        {value.type && <span style={{ color: 'var(--text-faint)', fontSize: '0.72rem' }}>({kindLabel(value.type)})</span>}
        {!disabled && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label="Clear research location"
            title="Clear — research goes back to country-wide numbers"
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-faint)', padding: 0, lineHeight: 1, fontSize: '0.9rem' }}
          >
            ×
          </button>
        )}
      </span>
    )
  }

  return (
    <div style={{ position: 'relative' }}>
      {notConnected && (
        <p style={{ margin: '0 0 6px', fontSize: '0.75rem', color: 'var(--amber)' }}>
          Connect DataForSEO on the Integrations page to search locations.
        </p>
      )}
      <input
        type="text"
        className="input"
        role="combobox"
        aria-label={label}
        aria-expanded={open && options.length > 0}
        aria-controls={listId}
        aria-activedescendant={open && options[active] ? `${listId}-${options[active].code}` : undefined}
        aria-autocomplete="list"
        value={q}
        onChange={e => setQ(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => { if (options.length) setOpen(true) }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Type a city, county or state…"
        disabled={disabled || notConnected}
        autoComplete="off"
        style={{ width: '100%', ...inputStyle }}
      />
      {searching && (
        <span aria-hidden="true" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: '0.7rem', color: 'var(--text-faint)' }}>…</span>
      )}
      {note && !open && (
        <p style={{ margin: '4px 0 0', fontSize: '0.72rem', color: 'var(--text-faint)' }}>{note}</p>
      )}
      {open && (
        <ul id={listId} role="listbox" style={{
          position: 'absolute', zIndex: 30, top: '100%', left: 0, right: 0, margin: '4px 0 0', padding: 4,
          listStyle: 'none', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.08)', maxHeight: 240, overflowY: 'auto',
        }}>
          {options.length === 0 && note && (
            <li aria-disabled="true" style={{ padding: '6px 10px', fontSize: '0.75rem', color: 'var(--text-faint)' }}>{note}</li>
          )}
          {options.map((o, i) => (
            <li
              key={o.code}
              id={`${listId}-${o.code}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={e => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o)}
              style={{
                padding: '6px 10px', cursor: 'pointer', fontSize: '0.8125rem', borderRadius: 6,
                display: 'flex', justifyContent: 'space-between', gap: 8,
                background: i === active ? 'var(--bg-subtle)' : 'transparent',
              }}
            >
              <span>{formatLocation(o)}</span>
              <span style={{ color: 'var(--text-faint)', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>({kindLabel(o.type)})</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
