'use client'

// A list of short phrases, entered one at a time.
//
// These fields were a comma-separated textarea, which reads as one long sentence and hides how
// many entries there are or where one ends. Five services in a single line is genuinely hard to
// scan, and it invites editing the wrong half of a phrase.
//
// Enter or comma commits the current text; Backspace on an empty field removes the last chip.
// Paste is split on commas and newlines, so pasting a list still works. With place suggestions
// on, the field is a combobox: the arrow keys move through the list, Enter picks, Escape closes.
//
// The value is exchanged as the same comma-joined string the callers already store, so nothing
// downstream has to change.

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ClipboardEvent } from 'react'
import { splitPhrases } from '@/lib/content/phrases'
import { isRegionToken, REGION_BY_CODE } from '@/lib/content/usStates'

// Re-exported so existing imports keep working. The implementation lives in lib, because research
// and the prompts have to split a stored list exactly the way this input wrote it.
export { splitPhrases }

/**
 * "Melbourne,Florida,United States" → "Melbourne, Florida".
 *
 * DataForSEO names a place with every level down to the country. The first part and the region
 * are what the location search needs to find it again unambiguously; anything between (a county)
 * and the country only make the chip longer.
 *
 * The label has to survive being read back by splitPhrases as ONE area, or picking a place would
 * add two chips. "Washington, District of Columbia" does not (a state after a state is split), so
 * the two-letter code is tried next ("Washington, DC"), and failing both only the place is kept.
 */
function placeLabel(name: string): string {
  const parts = name.split(',').map(s => s.trim()).filter(Boolean)
  const head  = parts[0] ?? name
  if (parts.length < 3) return head   // a state or a country on its own
  const region = parts[parts.length - 2]
  const code = Object.entries(REGION_BY_CODE).find(([, full]) => full.toLowerCase() === region.toLowerCase())?.[0]
  const candidates = [`${head}, ${region}`, ...(code ? [`${head}, ${code.toUpperCase()}`] : [])]
  const survives = (c: string) => { const read = splitPhrases(c); return read.length === 1 && read[0] === c }
  return candidates.find(c => isRegionToken(region) && survives(c)) ?? head
}

export default function KeywordChipInput({
  value, onChange, placeholder, id, disabled, max = 40, onPending, suggestPlaces = false, ariaLabel,
}: {
  /** Comma-joined, as stored. */
  value:        string
  onChange:     (next: string) => void
  placeholder?: string
  id?:          string
  /** For a field with no visible <label htmlFor> pointing at it. */
  ariaLabel?:   string
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
  /** The suggestion the arrow keys are on, or -1. Focus stays in the text field throughout. */
  const [active, setActive] = useState(-1)
  useEffect(() => {
    if (!suggestPlaces) return
    const q = draft.trim()
    if (q.length < 2) { setPlaces([]); setActive(-1); return }
    let cancelled = false
    // Debounced: this runs on every keystroke and the first call on a cold instance downloads the
    // whole location list before it can answer.
    const t = setTimeout(() => {
      fetch(`/api/admin/content/dfs-locations?q=${encodeURIComponent(q)}`)
        .then(r => r.ok ? r.json() : { locations: [] })
        .then(d => { if (!cancelled) { setPlaces((d.locations ?? []).slice(0, 6)); setOpenList(true); setActive(-1) } })
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
  const listId   = `${inputId}-places`
  const optionId = (i: number) => `${listId}-${i}`
  const listOpen = suggestPlaces && openList && places.length > 0

  // Bring the whole list into view when it opens.
  //
  // In the setup wizard, Service Areas sits near the bottom of a modal that scrolls on its own, and
  // the list opened below the field ran past the modal's edge: the last places were cut off, with
  // nothing to say there were more. Scrolling whatever box holds the field just far enough to show
  // the list fixes that anywhere this input is used, and moves nothing when it already fits.
  const listRef = useRef<HTMLUListElement>(null)
  useEffect(() => {
    if (listOpen) listRef.current?.scrollIntoView({ block: 'nearest' })
  }, [listOpen, places.length])

  /**
   * Add text as chips, read back exactly the way the stored value will be read.
   *
   * The whole list goes through splitPhrases rather than only the new text, so what is on screen
   * after a commit is what research and the writer will see — "Melbourne" then "FL" is one area
   * to them, so it is one chip here — and the cap counts what is actually kept.
   */
  const commit = (text: string) => {
    const added = splitPhrases(text)
    if (!added.length) return
    const next = splitPhrases([...phrases, ...added].join(', ')).slice(0, max)
    onChange(next.join(', '))
    setDraft('')
    onPending?.('')
  }

  const closeList = () => { setOpenList(false); setActive(-1) }

  /** A picked place goes in as "City, State" — the form location search resolves unambiguously. */
  const pickPlace = (name: string) => {
    commit(placeLabel(name))
    closeList()
    inputRef.current?.focus()
  }

  const removeAt = (i: number) => onChange(phrases.filter((_, n) => n !== i).join(', '))

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // The suggestion list, driven from the field the way a combobox is: arrows move, Enter picks,
    // Escape closes. Escape stops here so it does not also close a dialog this sits in.
    if (listOpen) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % places.length); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(i => (i <= 0 ? places.length - 1 : i - 1)); return }
      if (e.key === 'Escape')    { e.preventDefault(); e.stopPropagation(); closeList(); return }
      if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pickPlace(places[active].name); return }
    } else if (suggestPlaces && e.key === 'ArrowDown' && places.length > 0) {
      e.preventDefault(); setOpenList(true); setActive(0); return
    }
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
              className="focus-ring"
              onClick={e => { e.stopPropagation(); removeAt(i) }}
              aria-label={`Remove ${p}`}
              style={{
                border: 'none', background: 'transparent', cursor: 'pointer', lineHeight: 1,
                fontSize: '0.95rem', color: 'var(--text-faint)', padding: '0 2px', borderRadius: 999,
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
        // A pointer pick keeps focus here (the options cancel mousedown), so a blur is a real
        // leaving: commit what was typed and close the list.
        onBlur={() => { closeList(); commit(draft) }}
        placeholder={phrases.length ? '' : placeholder}
        autoComplete="off"
        aria-label={ariaLabel}
        role={suggestPlaces ? 'combobox' : undefined}
        aria-expanded={suggestPlaces ? listOpen : undefined}
        aria-autocomplete={suggestPlaces ? 'list' : undefined}
        aria-controls={suggestPlaces && listOpen ? listId : undefined}
        aria-activedescendant={listOpen && active >= 0 ? optionId(active) : undefined}
        style={{
          flex: '1 1 140px', minWidth: 120, border: 'none', outline: 'none',
          background: 'transparent', color: 'var(--text-primary)', fontSize: '0.8125rem', padding: 0,
        }}
      />

      {/* Real places, named exactly as the search will find them again. */}
      {listOpen && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Matching places"
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, margin: '4px 0 0',
            padding: 4, listStyle: 'none', maxHeight: 220, overflowY: 'auto',
            background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
            boxShadow: '0 4px 14px rgba(0,0,0,0.10)',
          }}
        >
          {places.map((p, i) => {
            const on = i === active
            return (
              <li
                key={p.code}
                id={optionId(i)}
                role="option"
                aria-selected={on}
                // Mousedown is cancelled so the field keeps focus and does not commit the half-typed
                // draft on blur; the pick itself is a click, so it works for touch and pointer alike.
                onMouseDown={e => e.preventDefault()}
                onClick={e => { e.stopPropagation(); pickPlace(p.name) }}
                onMouseEnter={() => setActive(i)}
                style={{
                  cursor: 'pointer', borderRadius: 6, padding: '6px 8px',
                  fontSize: '0.8125rem', color: 'var(--text-primary)',
                  background: on ? 'var(--bg-hover)' : 'transparent',
                  boxShadow: on ? 'inset 2px 0 0 var(--accent)' : undefined,
                }}
              >
                {p.name.split(',')[0]}
                <span style={{ color: 'var(--text-faint)' }}>
                  {p.name.includes(',') ? `, ${p.name.split(',').slice(1).join(', ')}` : ''}
                  {p.type ? ` · ${p.type}` : ''}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
