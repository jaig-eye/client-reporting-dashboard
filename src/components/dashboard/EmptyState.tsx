// The one empty state for client dashboard pages.
//
// There used to be three designs and two different sentences for the same condition, and the copy
// spoke our language rather than the client's ("wait for the next sync" describes our plumbing).
// Say what will appear here and what makes it appear.

import type { ReactNode } from 'react'

interface Props {
  title: string
  description: string
  /** A Phosphor icon, sized ~22. Falls back to a neutral mark. */
  icon?: ReactNode
  /** Something the reader can do about it, when there is something. */
  action?: ReactNode
}

export default function EmptyState({ title, description, icon, action }: Props) {
  return (
    <div className="card dash-empty">
      <div className="dash-empty__icon" aria-hidden>{icon ?? '—'}</div>
      <p className="dash-empty__title">{title}</p>
      <p className="dash-empty__desc">{description}</p>
      {action && <div className="dash-empty__action">{action}</div>}
    </div>
  )
}
