'use client'

import { useState } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import type { NoteField, NoteTemplate } from '@/lib/note-templates'

function hasValue(values: Record<string, string>, key: string) {
  return (values[key] ?? '').trim() !== ''
}

/**
 * A note category's structured fields, in two tiers:
 *
 * - essential fields sit in a compact grid, always visible;
 * - optional ('more') fields sit behind a "More details" disclosure;
 * - retired ('legacy') fields never appear for a blank note, but show up inside
 *   the disclosure when the note being edited already holds a value, so that
 *   value can still be seen, changed or cleared rather than silently kept.
 *
 * Shared by the composer and the note editor so both stay in step.
 */
export function NoteTemplateFields({
  template,
  values,
  onChange,
  disabled,
  afterEssential,
}: {
  template: NoteTemplate
  values:   Record<string, string>
  onChange: (key: string, value: string) => void
  disabled?: boolean
  /** Rendered between the essential fields and "More details" (the credential box). */
  afterEssential?: React.ReactNode
}) {
  const essential = template.fields.filter(f => !f.tier)
  const optional  = template.fields.filter(f =>
    f.tier === 'more' || (f.tier === 'legacy' && hasValue(values, f.key)),
  )
  const optionalFilled = optional.filter(f => hasValue(values, f.key)).length
  // Open by default when there is something in there to see.
  const [open, setOpen] = useState(optionalFilled > 0)

  if (essential.length === 0 && optional.length === 0 && !afterEssential) return null

  function renderInput(f: NoteField) {
    const v = values[f.key] ?? ''
    const id = `note-field-${template.key}-${f.key}`
    let control: React.ReactNode
    if (f.type === 'select') {
      control = (
        <select id={id} className="note-field__input" value={v} disabled={disabled}
          onChange={e => onChange(f.key, e.target.value)}>
          <option value="">Select…</option>
          {/* Keep a stored answer selectable even if the option list changed. */}
          {v && !(f.options ?? []).includes(v) && <option value={v}>{v}</option>}
          {(f.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    } else if (f.type === 'textarea') {
      control = (
        <textarea id={id} className="note-field__input" value={v} disabled={disabled} rows={2}
          placeholder={f.placeholder} onChange={e => onChange(f.key, e.target.value)} />
      )
    } else {
      control = (
        <input id={id} className="note-field__input"
          type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : f.type === 'url' ? 'url' : 'text'}
          value={v} disabled={disabled} placeholder={f.placeholder}
          onChange={e => onChange(f.key, e.target.value)} />
      )
    }
    return (
      <div key={f.key} className={`note-field${f.wide ? ' note-field--wide' : ''}`}>
        <label htmlFor={id} className="note-field__label">{f.label}</label>
        {control}
      </div>
    )
  }

  return (
    <div className="note-fields">
      {essential.length > 0 && <div className="note-fields__grid">{essential.map(renderInput)}</div>}
      {afterEssential}
      {optional.length > 0 && (
        <div className="note-fields__more">
          <button
            type="button"
            className="note-fields__toggle"
            aria-expanded={open}
            onClick={() => setOpen(o => !o)}
          >
            <CaretDown size={12} weight="bold" className="note-fields__caret" aria-hidden />
            More details
            {optionalFilled > 0 && <span className="note-fields__count">{optionalFilled}</span>}
          </button>
          {open && <div className="note-fields__grid">{optional.map(renderInput)}</div>}
        </div>
      )}
    </div>
  )
}

/** Read-only rendering of whatever answers a note actually has — every tier, legacy included. */
export function NoteFieldsReadout({
  template,
  values,
}: {
  template: NoteTemplate
  values:   Record<string, string>
}) {
  const present = template.fields.filter(f => hasValue(values, f.key))
  if (present.length === 0) return null

  return (
    <dl className="note-readout">
      {present.map(f => (
        <div key={f.key} className="note-readout__row">
          <dt>{f.label}</dt>
          <dd>
            {f.type === 'url' && /^https?:\/\//i.test(values[f.key])
              ? <a href={values[f.key]} target="_blank" rel="noopener noreferrer">{values[f.key]}</a>
              : values[f.key]}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * One-line summary of a structure-only note for the feed preview: the essential
 * answers, in template order. Never includes the credential, which is not in
 * the note payload at all.
 */
export function noteFieldsSummary(template: NoteTemplate, values: Record<string, string> | null): string {
  if (!values) return ''
  const ordered = [...template.fields.filter(f => !f.tier), ...template.fields.filter(f => f.tier)]
  return ordered
    .filter(f => hasValue(values, f.key))
    .slice(0, 3)
    .map(f => values[f.key].split('\n')[0])
    .join(' · ')
}

/** Small tone-coded category pill. */
export function NoteCategoryChip({ template, size = 'sm' }: { template: NoteTemplate; size?: 'sm' | 'md' }) {
  return (
    <span className={`note-chip note-tone--${template.tone}${size === 'md' ? ' note-chip--md' : ''}`}>
      {template.label}
    </span>
  )
}
