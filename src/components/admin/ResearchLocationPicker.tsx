'use client'

import { useEffect, useRef, useState } from 'react'

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

/**
 * Type a place, pick the geo target. The list comes from DataForSEO's free locations endpoint
 * via /api/admin/content/dfs-locations; nothing here spends.
 */
export default function ResearchLocationPicker({ value, onChange, disabled, inputStyle }: {
  value:       ResearchLocationValue | null
  onChange:    (v: ResearchLocationValue | null) => void
  disabled?:   boolean
  inputStyle?: React.CSSProperties
}) {
  const [q, setQ]                 = useState('')
  const [options, setOptions]     = useState<ResearchLocationValue[]>([])
  const [open, setOpen]           = useState(false)
  const [searching, setSearching] = useState(false)
  const [note, setNote]           = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    const needle = q.trim()
    if (needle.length < 2) { setOptions([]); setNote(null); return }
    let cancelled = false
    timer.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/admin/content/dfs-locations?q=${encodeURIComponent(needle)}`)
        const d = await res.json() as { locations?: ResearchLocationValue[]; error?: string }
        if (cancelled) return
        setOptions(d.locations ?? [])
        setNote(d.error ?? ((d.locations ?? []).length ? null : 'No matching city, county or state.'))
        setOpen(true)
      } catch {
        if (!cancelled) { setOptions([]); setNote('Lookup failed.') }
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 250)
    return () => { cancelled = true; if (timer.current) clearTimeout(timer.current) }
  }, [q])

  if (value) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 12px', borderRadius: 999,
        background: 'var(--bg-subtle)', border: '1px solid var(--border)', fontSize: '0.8125rem',
      }}>
        {formatLocation(value)}
        {value.type && <span style={{ color: 'var(--text-faint)', fontSize: '0.7rem' }}>{value.type}</span>}
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
      <input
        type="text"
        className="input"
        value={q}
        onChange={e => setQ(e.target.value)}
        onFocus={() => { if (options.length || note) setOpen(true) }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Type a city, county or state…"
        disabled={disabled}
        autoComplete="off"
        style={{ width: '100%', ...inputStyle }}
      />
      {searching && (
        <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: '0.7rem', color: 'var(--text-faint)' }}>…</span>
      )}
      {open && (options.length > 0 || note) && (
        <ul role="listbox" style={{
          position: 'absolute', zIndex: 30, top: '100%', left: 0, right: 0, margin: '4px 0 0', padding: 4,
          listStyle: 'none', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.08)', maxHeight: 240, overflowY: 'auto',
        }}>
          {note && <li style={{ padding: '6px 10px', fontSize: '0.75rem', color: 'var(--text-faint)' }}>{note}</li>}
          {options.map(o => (
            <li key={o.code}>
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onChange(o); setQ(''); setOptions([]); setNote(null); setOpen(false) }}
                style={{
                  width: '100%', textAlign: 'left', padding: '6px 10px', border: 'none', background: 'transparent',
                  cursor: 'pointer', fontSize: '0.8125rem', borderRadius: 6, display: 'flex', justifyContent: 'space-between', gap: 8,
                }}
              >
                <span>{formatLocation(o)}</span>
                <span style={{ color: 'var(--text-faint)', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>{o.type}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
