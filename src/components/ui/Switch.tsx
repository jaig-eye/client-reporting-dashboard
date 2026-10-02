// The admin's one switch: a real checkbox with role=switch, so it takes the keyboard focus, reads
// as on/off to a screen reader, and can't submit a form it sits in (a bare <button> can, and did).
// SwitchRow is the common case: a setting's name and one line on the left, the switch on the right.

import { useId, type ReactNode } from 'react'

export default function Switch({ checked, onChange, disabled, label, hideLabel, describedBy }: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  /** What it turns on. Always given, so the switch has a name even when it isn't shown. */
  label: ReactNode
  /** Keep the label for screen readers only (a table cell, a row that names it already). */
  hideLabel?: boolean
  describedBy?: string
}) {
  return (
    <label className="ui-switch">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={e => onChange(e.target.checked)}
      />
      <span className="ui-switch-track" aria-hidden />
      <span className={hideLabel ? 'sr-only' : undefined}>{label}</span>
    </label>
  )
}

/** A setting row whose control is a switch. Children appear under the row, for controls that only
 *  matter while it's on. */
export function SwitchRow({ title, description, checked, onChange, disabled, children }: {
  title: string
  description?: ReactNode
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  children?: ReactNode
}) {
  const descId = useId()
  return (
    <div className="ui-setting">
      <div className="ui-setting-text">
        <p className="ui-setting-title" aria-hidden>{title}</p>
        {description && <p className="ui-setting-desc" id={descId}>{description}</p>}
      </div>
      <div className="ui-setting-control">
        <Switch checked={checked} onChange={onChange} disabled={disabled} label={title} hideLabel describedBy={description ? descId : undefined} />
      </div>
      {children && <div className="ui-setting-more">{children}</div>}
    </div>
  )
}
