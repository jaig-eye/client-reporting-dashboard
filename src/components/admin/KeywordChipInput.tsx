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

import { useId, useRef, useState, type KeyboardEvent, type ClipboardEvent } from 'react'

export function splitPhrases(text: string): string[] {
  return Array.from(new Set(
    String(text ?? '').split(/[,\n;]+/).map(v => v.trim()).filter(Boolean),
  ))
}

export default function KeywordChipInput({
  value, onChange, placeholder, id, disabled, max = 40, onPending,
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
}) {
  const [draft, setDraft] = useState('')
  const phrases = splitPhrases(value)

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
        onBlur={() => commit(draft)}
        placeholder={phrases.length ? '' : placeholder}
        style={{
          flex: '1 1 140px', minWidth: 120, border: 'none', outline: 'none',
          background: 'transparent', color: 'var(--text-primary)', fontSize: '0.8125rem', padding: 0,
        }}
      />
    </div>
  )
}
