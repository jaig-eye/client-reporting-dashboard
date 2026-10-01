// The tinted square an icon or a logo sits in — the leading edge of every row in the admin.

import type { ReactNode } from 'react'

export type TileTone = 'neutral' | 'accent' | 'green' | 'red' | 'amber' | 'logo'

export default function Tile({ children, size = 'md', tone = 'neutral', className, title }: {
  children: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  tone?: TileTone
  className?: string
  title?: string
}) {
  const cls = ['ui-tile', size !== 'md' && `ui-tile--${size}`, tone !== 'neutral' && `ui-tile--${tone}`, className]
    .filter(Boolean).join(' ')
  return <span className={cls} title={title} aria-hidden={title ? undefined : true}>{children}</span>
}
