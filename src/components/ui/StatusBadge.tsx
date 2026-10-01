// One status pill for the whole admin: connected, needs attention, failed, not set up. It replaces
// the four badge components the connections pages each drew their own way.

import type { ReactNode } from 'react'

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

export default function StatusBadge({ tone = 'neutral', children, dot = true, live = false, title }: {
  tone?: StatusTone
  children: ReactNode
  /** A leading dot in the tone's colour. */
  dot?: boolean
  /** A soft pulse on the dot, for something happening right now (syncing, publishing). */
  live?: boolean
  title?: string
}) {
  return (
    <span className={`ui-status ui-status--${tone}${live ? ' ui-status--live' : ''}`} title={title}>
      {dot && <span className="ui-status-dot" aria-hidden />}
      {children}
    </span>
  )
}
