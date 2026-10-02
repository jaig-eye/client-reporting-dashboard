// An empty list or page: what is missing and the one thing to do about it.

import type { ReactNode } from 'react'
import Tile, { type TileTone } from './Tile'

export default function EmptyState({ icon, tone = 'accent', title, children, actions }: {
  icon?: ReactNode
  /** The icon tile's colour: red for something that failed. */
  tone?: TileTone
  title: string
  children?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="ui-empty">
      {icon && <Tile size="lg" tone={tone}>{icon}</Tile>}
      <p className="ui-empty-title">{title}</p>
      {children && <p className="ui-empty-text">{children}</p>}
      {actions && <div className="ui-empty-actions">{actions}</div>}
    </div>
  )
}
