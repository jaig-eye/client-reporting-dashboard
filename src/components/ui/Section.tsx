// A settings-style section: a card with a title, one line on what it controls, optional actions on
// the right, and the controls below. Replaces the hand-built "card p-5 + section-title" blocks so
// every section in the admin has the same rhythm.

import type { ReactNode } from 'react'

export default function Section({ title, description, actions, children, id, flush }: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  id?: string
  /** Content runs edge to edge (tables, row lists) instead of sitting in the padding. */
  flush?: boolean
}) {
  return (
    <section className={`card ui-section${flush ? ' ui-section--flush' : ''}`} id={id} aria-labelledby={id ? `${id}-title` : undefined}>
      <header className="ui-section-head">
        <div className="ui-section-text">
          <h2 className="ui-section-title" id={id ? `${id}-title` : undefined}>{title}</h2>
          {description && <p className="ui-section-desc">{description}</p>}
        </div>
        {actions && <div className="ui-section-actions">{actions}</div>}
      </header>
      {children && <div className="ui-section-body">{children}</div>}
    </section>
  )
}
