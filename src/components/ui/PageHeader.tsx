// The top of every admin page: optional back link, a title (with an optional logo or icon tile),
// one line saying what the page is for, and the page's actions — which wrap under the title on a
// phone rather than squeezing it.

import Link from 'next/link'
import type { ReactNode } from 'react'
import { CaretLeft } from '@phosphor-icons/react/dist/ssr'

export default function PageHeader({ title, description, actions, back, leading, children }: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  back?: { href: string; label: string }
  /** A logo or tile before the title. */
  leading?: ReactNode
  /** Extra content under the description (chips, meta). */
  children?: ReactNode
}) {
  return (
    <header className="ui-ph">
      <div className="ui-ph-main">
        {leading}
        <div className="ui-ph-text">
          {back && (
            <Link href={back.href} className="ui-ph-back"><CaretLeft size={13} weight="bold" aria-hidden />{back.label}</Link>
          )}
          <h1 className="ui-ph-title">{title}</h1>
          {description && <p className="ui-ph-desc">{description}</p>}
          {children}
        </div>
      </div>
      {actions && <div className="ui-ph-actions">{actions}</div>}
    </header>
  )
}
