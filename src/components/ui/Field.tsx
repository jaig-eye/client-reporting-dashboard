// A form field: label, the control, then a hint (or an error) underneath. Pass `id` and give the
// control the same id, so clicking the label focuses it and the hint is read with it.

import type { ReactNode } from 'react'

export default function Field({ label, id, hint, error, children }: {
  label: ReactNode
  id?: string
  hint?: ReactNode
  error?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="ui-field">
      {id ? <label className="ui-field-label" htmlFor={id}>{label}</label> : <span className="ui-field-label">{label}</span>}
      {children}
      {error ? <p className="ui-field-error" id={id ? `${id}-hint` : undefined} role="alert">{error}</p>
        : hint ? <p className="ui-field-hint" id={id ? `${id}-hint` : undefined}>{hint}</p> : null}
    </div>
  )
}
