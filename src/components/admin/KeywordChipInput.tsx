'use client'

// A list of short phrases, entered one at a time.
//
// These fields were a comma-separated textarea, which reads as one long sentence and hides how
// many entries there are or where one ends. Five services in a single line is genuinely hard to
// scan, and it invites editing the wrong half of a phrase.
//
// Enter or comma commits the current text; Backspace on an empty field removes the last chip.
// Paste is split on commas and newlines, so pasting a list still works.
//
// The value is exchanged as the same comma-joined string the callers already store, so nothing
// downstream has to change.

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ClipboardEvent } from 'react'
import { isRegionToken } from '@/lib/content/usStates'

export function splitPhrases(text: string): string[] {
  const raw = String(text ?? '')
  const out: string[] = []
  let buf = '', depth = 0

  // Split on separators, but not inside brackets and not before a state.
  //
  // "Melbourne, FL" is one place written the way everyone writes an address, and the old splitter
  // turned it into "Melbourne" and "FL" — which then resolved to nothing, or worse, to a city of
  // that name in another state. "Brevard County, Florida (including Cocoa, Palm Bay…)" fared worse
  // still: fourteen chips, one of them ")".
  for (const ch of raw) {
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1)
    if (depth === 0 && (ch === ',' || ch === '\n' || ch === ';')) { out.push(buf); buf = '' }
    else buf += ch
  }
  out.push(buf)

  // Re-join a fragment that is only a state onto the place it belongs to.
  const merged: string[] = []
  for (const part of out.map(v => v.trim()).filter(Boolean)) {
    if (merged.length > 0 && isRegionToken(part)) merged[merged.length - 1] += `, ${part}`
    else merged.push(part)
  }
  return Array.from(new Set(merged))
}

export default function KeywordChipInput({
  value, onChange, placeholder, id, disabled, max = 40, onPending, suggestPlaces = false,
}: {
  /** Comma-joined, as stored. */
  value:        string
  onChange:     (next: string) => void
  placeholder?: string
  id?:          string
  disabled?:    boolean
  max?:         number
  /**
   * Text typed but not yet committed to a chip.
   *
   * A caller with its own submit button needs this. Typing a phrase and pressing that button
   * used to do nothing: the text lived here until Enter, comma or blur turned it into a chip, so
   * the parent still saw an empty value and kept the button disabled. The button cannot enable
   * itself on a blur that only happens because you clicked it.
   */
  onPending?:   (text: string) => void
  /**
   * Offer real places from DataForSEO's location list as you type.
   *
   * Only Service Areas sets this. Typing a place freehand is how "Melbourne" ended up meaning a
   * city in whichever state sorted first — picking one off a list removes the guess entirely,
   * because the stored text is then a name the search is known to resolve. The lookup is free and
   * cached for a day, and needs no DataForSEO connection on the client.
   */
  suggestPlaces?: boolean
}) {
  const [draft, setDraft] = useState('')
  const phrases = splitPhrases(value)

  // ── Place suggestions ─────────────────────────────────────────────────────
  const [places, setPlaces] = useState<Array<{ code: number; name: string; type: string }>>([])
  const [openList, setOpenList] = useState(false)
  useEffect(() => {
    if (!suggestPlaces) return
    const q = draft.trim()
    if (q.length < 2) { setPlaces([]); return }
    let cancelled = false
    // Debounced: this runs on every keystroke and the first call on a cold instance downloads the
    // whole location list before it can answer.
    const t = setTimeout(() => {
      fetch(`/api/admin/content/dfs-locations?q=${encodeURIComponent(q)}`)
        .then(r => r.ok ? r.json() : { locations: [] })
        .then(d => { if (!cancelled) { setPlaces((d.locations ?? []).slice(0, 6)); setOpenList(true) } })
        .catch(() => { if (!cancelled) setPlaces([]) })
    }, 350)
    return () => { cancelled = true; clearTimeout(t) }
  }, [draft, suggestPlaces])

  // Clicking the box focuses its own input.
  //
  // This used to be document.getElementById(id ?? 'chip-input'), and no caller passed an id — so
  // every chip input on the page shared the literal 'chip-input' and getElementById handed back
  // whichever came first in the DOM. Clicking Service Areas, or Search keyword research from, put
  // the caret in Services Offered. A ref can only ever mean this instance.
  const inputRef = useRef<HTMLInputElement>(null)
  // A real unique id so a caller's <label htmlFor> still lands on the right field.
  const autoId   = useId()
  const inputId  = id ?? `chips-${autoId}`

  const commit = (text: string) => {
    const added = splitPhrases(text)
    if (!added.length) return
    const next = Array.from(new Set([...phrases, ...added])).slice(0, max)
    onChange(next.join(', '))
    setDraft('')
    onPending?.('')
  }

  const removeAt = (i: number) => onChange(phrases.filter((_, n) => n !== i).join(', '))

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(draft); return }
    // Backspace on an empty field takes back the last one — the usual behaviour for this control.
    if (e.key === 'Backspace' && !draft && phrases.length) { e.preventDefault(); removeAt(phrases.length - 1) }
  }

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text')
    if (!/[,\n;]/.test(text)) return        // a single phrase: let it type normally
    e.preventDefault()
    commit(text)
  }

  return (
    <div
      className="input"
      style={{
        // relative: the suggestion list below is positioned against this box.
        position: 'relative',
        display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
        minHeight: 38, height: 'auto', padding: '6px 8px',
        cursor: disabled ? 'not-allowed' : 'text', opacity: disabled ? 0.6 : 1,
      }}
      onClick={() => { if (!disabled) inputRef.current?.focus() }}
    >
      {phrases.map((p, i) => (
        <span
          key={`${p}-${i}`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            background: 'var(--bg-subtle)', border: '1px solid var(--border)',
            borderRadius: 999, padding: '2px 6px 2px 9px', fontSize: '0.78rem',
            color: 'var(--text-primary)', maxWidth: '100%',
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p}</span>
          {!disabled && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); removeAt(i) }}
              aria-label={`Remove ${p}`}
              style={{
                border: 'none', background: 'transparent', cursor: 'pointer', lineHeight: 1,
                fontSize: '0.95rem', color: 'var(--text-faint)', padding: '0 2px',
              }}
            >×</button>
          )}
        </span>
      ))}
      <input
        id={inputId}
        ref={inputRef}
        type="text"
        value={draft}
        disabled={disabled}
        onChange={e => { setDraft(e.target.value); onPending?.(e.target.value) }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        // Delayed so a click on a suggestion lands before the list unmounts — a plain onBlur
        // commits the raw draft and the pick never happens.
        onBlur={() => { setTimeout(() => setOpenList(false), 150); commit(draft) }}
        placeholder={phrases.length ? '' : placeholder}
        autoComplete="off"
        role={suggestPlaces ? 'combobox' : undefined}
        aria-expanded={suggestPlaces ? openList && places.length > 0 : undefined}
        aria-autocomplete={suggestPlaces ? 'list' : undefined}
        style={{
          flex: '1 1 140px', minWidth: 120, border: 'none', outline: 'none',
          background: 'transparent', color: 'var(--text-primary)', fontSize: '0.8125rem', padding: 0,
        }}
      />

      {/* Real places, named exactly as the search will find them again. */}
      {suggestPlaces && openList && places.length > 0 && (
        <ul
          role="listbox"
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, margin: '4px 0 0',
            padding: 4, listStyle: 'none', maxHeight: 220, overflowY: 'auto',
            background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8,
            boxShadow: '0 4px 14px rgba(0,0,0,0.10)',
          }}
        >
          {places.map(p => (
            <li key={p.code} role="option" aria-selected={false}>
              <button
                type="button"
                // onMouseDown, not onClick: the input's blur fires first otherwise and commits the
                // half-typed draft instead of the place that was picked.
                onMouseDown={e => { e.preventDefault(); commit(p.name); setDraft(''); onPending?.(''); setOpenList(false) }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                  border: 'none', background: 'transparent', borderRadius: 6,
                  padding: '6px 8px', fontSize: '0.8125rem', color: 'var(--text-primary)',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-subtle)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                {p.name.split(',')[0]}
                <span style={{ color: 'var(--text-faint)' }}>
                  {p.name.includes(',') ? `, ${p.name.split(',').slice(1).join(', ')}` : ''}
                  {p.type ? ` · ${p.type}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
