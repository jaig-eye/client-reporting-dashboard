// An empty list or page: what is missing and the one thing to do about it.

import type { ReactNode } from 'react'
import Tile from './Tile'

export default function EmptyState({ icon, title, children, actions }: {
  icon?: ReactNode
  title: string
  children?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="ui-empty">
      {icon && <Tile size="lg" tone="accent">{icon}</Tile>}
      <p className="ui-empty-title">{title}</p>
      {children && <p className="ui-empty-text">{children}</p>}
      {actions && <div className="ui-empty-actions">{actions}</div>}
    </div>
  )
}
