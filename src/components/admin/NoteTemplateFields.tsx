'use client'

import type { NoteField, NoteTemplate } from '@/lib/note-templates'

/**
 * Renders a note category's structured fields as a compact 2-column grid.
 * Fields marked `wide` span both columns. Shared by the add form and the
 * expanded-note editor so both stay in step when a template changes shape.
 */
export function NoteTemplateFields({
  template,
  values,
  onChange,
  disabled,
}: {
  template: NoteTemplate
  values:   Record<string, string>
  onChange: (key: string, value: string) => void
  disabled?: boolean
}) {
  if (template.fields.length === 0) return null

  const inp: React.CSSProperties = {
    width: '100%', padding: '0.32rem 0.5rem', boxSizing: 'border-box',
    background: 'var(--bg-subtle)', border: '1px solid var(--border)',
    borderRadius: 5, fontSize: '0.75rem', color: 'var(--text)', fontFamily: 'inherit',
  }

  function renderInput(f: NoteField) {
    const v = values[f.key] ?? ''
    if (f.type === 'select') {
      return (
        <select
          value={v}
          disabled={disabled}
          onChange={e => onChange(f.key, e.target.value)}
          style={{ ...inp, cursor: disabled ? 'default' : 'pointer' }}
        >
          <option value="">—</option>
          {(f.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    }
    if (f.type === 'textarea') {
      return (
        <textarea
          value={v}
          disabled={disabled}
          rows={2}
          placeholder={f.placeholder}
          onChange={e => onChange(f.key, e.target.value)}
          style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }}
        />
      )
    }
    return (
      <input
        type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : f.type === 'url' ? 'url' : 'text'}
        value={v}
        disabled={disabled}
        placeholder={f.placeholder}
        onChange={e => onChange(f.key, e.target.value)}
        style={inp}
      />
    )
  }

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gap: 6,
      padding: '0.5rem',
      background: 'var(--bg-subtle)',
      border: `1px solid ${template.color}33`,
      borderLeft: `2px solid ${template.color}`,
      borderRadius: 6,
    }}>
      {template.fields.map(f => (
        <label key={f.key} style={{ gridColumn: f.wide ? '1 / -1' : 'auto', minWidth: 0 }}>
          <span style={{
            display: 'block', fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.03em',
            textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 2,
          }}>
            {f.label}
          </span>
          {renderInput(f)}
        </label>
      ))}
    </div>
  )
}

/** Read-only rendering of whatever answers a note actually has. */
export function NoteFieldsReadout({
  template,
  values,
}: {
  template: NoteTemplate
  values:   Record<string, string>
}) {
  const present = template.fields.filter(f => (values[f.key] ?? '').trim() !== '')
  if (present.length === 0) return null

  return (
    <dl style={{
      display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)',
      gap: '4px 10px', margin: '0 0 0.75rem', padding: '0.55rem 0.7rem',
      background: 'var(--bg-subtle)',
      border: `1px solid ${template.color}33`,
      borderLeft: `2px solid ${template.color}`,
      borderRadius: 6, fontSize: '0.76rem',
    }}>
      {present.map(f => (
        <div key={f.key} style={{ display: 'contents' }}>
          <dt style={{ color: 'var(--text-faint)', whiteSpace: 'nowrap', fontSize: '0.7rem', paddingTop: 1 }}>
            {f.label}
          </dt>
          <dd style={{ margin: 0, color: 'var(--text)', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
            {f.type === 'url' && /^https?:\/\//i.test(values[f.key])
              ? <a href={values[f.key]} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue)' }}>{values[f.key]}</a>
              : values[f.key]}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** Small colour-coded category pill. */
export function NoteCategoryChip({ template, size = 'sm' }: { template: NoteTemplate; size?: 'sm' | 'md' }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: size === 'md' ? '0.15rem 0.45rem' : '0.05rem 0.35rem',
      background: `${template.color}1a`,
      color: template.color,
      border: `1px solid ${template.color}40`,
      borderRadius: 999,
      fontSize: size === 'md' ? '0.68rem' : '0.6rem',
      fontWeight: 600,
      whiteSpace: 'nowrap',
      lineHeight: 1.4,
    }}>
      {template.label}
    </span>
  )
}
