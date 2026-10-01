// One integration, the same everywhere — agency Integrations and a client's Integrations tab:
// the service's logo, its name and status, one line on what it does (or what it's connected to),
// and the actions on the right. Nested rows (Google's four services, BigCommerce's analytics
// connection) sit underneath, indented. Server-safe: actions arrive as elements.

import type { ReactNode } from 'react'
import BrandLogo from '@/components/ui/BrandLogo'
import StatusBadge, { type StatusTone } from '@/components/ui/StatusBadge'

export interface IntegrationStatus { tone: StatusTone; label: string; title?: string; live?: boolean }

export default function IntegrationRow({
  brand, logo, name, status, description, meta, actions, children, sub = false, warning, id,
}: {
  /** Connector type / service key for BrandLogo. */
  brand?: string
  /** Or a custom logo element. */
  logo?: ReactNode
  name: string
  status?: IntegrationStatus | null
  description?: ReactNode
  /** What it's connected to: account name, last sync. */
  meta?: ReactNode
  actions?: ReactNode
  /** Rows nested under this one. */
  children?: ReactNode
  /** A nested row: smaller logo, no description emphasis. */
  sub?: boolean
  /** Something that needs fixing, shown under the description. */
  warning?: ReactNode
  id?: string
}) {
  return (
    <div className={`int-row${sub ? ' int-row--sub' : ''}`} id={id}>
      <div className="int-row-main">
        {logo ?? (brand ? <BrandLogo type={brand} size={sub ? 16 : 22} tile tileSize={sub ? 'sm' : 'lg'} /> : null)}
        <div className="int-row-text">
          <div className="int-row-title">
            <span>{name}</span>
            {status && <StatusBadge tone={status.tone} title={status.title} live={status.live}>{status.label}</StatusBadge>}
          </div>
          {description && <p className="int-row-desc">{description}</p>}
          {meta && <p className="int-row-meta">{meta}</p>}
          {warning && <p className="int-row-warn">{warning}</p>}
        </div>
        {actions && <div className="int-row-actions">{actions}</div>}
      </div>
      {children && <div className="int-row-children">{children}</div>}
    </div>
  )
}

/** A titled group of integrations in one card. */
export function IntegrationGroup({ title, description, children, id }: { title: string; description?: string; children: ReactNode; id?: string }) {
  return (
    <section className="int-group" aria-labelledby={id ? `${id}-title` : undefined}>
      <header className="int-group-head">
        <h2 className="int-group-title" id={id ? `${id}-title` : undefined}>{title}</h2>
        {description && <p className="int-group-desc">{description}</p>}
      </header>
      <div className="card int-group-card">{children}</div>
    </section>
  )
}

/** Status for a connector row from its stored status. */
export function connectorStatus(status: string | null | undefined): IntegrationStatus {
  switch (status) {
    case 'active':  return { tone: 'success', label: 'Connected' }
    case 'error':   return { tone: 'danger',  label: 'Needs attention', title: 'The last check or sync failed. Open it to see why.' }
    case 'pending': return { tone: 'warning', label: 'Pending' }
    case 'paused':  return { tone: 'warning', label: 'Paused' }
    default:        return { tone: 'neutral', label: 'Not connected' }
  }
}
