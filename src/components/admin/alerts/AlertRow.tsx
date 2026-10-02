'use client'

// One inbox row. Collapsed it is a quiet summary (client, title, two lines of the body); opening it
// shows the full body and, for a run of repeats, each occurrence with its date and time.

import type { KeyboardEvent, ReactNode } from 'react'
import Link from 'next/link'
import {
  RocketLaunch, ChartLineUp, NotePencil, PlugsConnected, UsersThree, Bell, X, ArrowRight, CaretDown,
} from '@phosphor-icons/react'
import AlertBody, { alertPlainText } from '@/components/admin/AlertBody'
import { clockTime, displayTitle, fullTime, relativeTime, type AlertGroup } from './inbox'

const TYPE_ICON: Record<string, ReactNode> = {
  ad_fuel:     <RocketLaunch   size={15} weight="duotone" aria-hidden />,
  ad_insights: <ChartLineUp    size={15} weight="duotone" aria-hidden />,
  content:     <NotePencil     size={15} weight="duotone" aria-hidden />,
  integration: <PlugsConnected size={15} weight="duotone" aria-hidden />,
  crm:         <UsersThree     size={15} weight="duotone" aria-hidden />,
}

export const TYPE_LABEL: Record<string, string> = {
  ad_fuel: 'Ad Fuel', ad_insights: 'Ad insights', content: 'Content', integration: 'Integration', crm: 'CRM',
}

export function typeLabel(type: string) {
  return TYPE_LABEL[type] ?? type.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
}

const SEVERITY_LABEL: Record<string, string> = { critical: 'Critical', warning: 'Warning', info: 'Info' }

interface Props {
  group:      AlertGroup
  now:        number
  expanded:   boolean
  selectMode: boolean
  selection:  'all' | 'some' | 'none'
  busy:       boolean
  onToggle:   () => void
  onSelect:   (checked: boolean) => void
  onOpenLink: () => void
  onDismiss:  (ids: string[]) => void
}

export default function AlertRow({
  group, now, expanded, selectMode, selection, busy, onToggle, onSelect, onOpenLink, onDismiss,
}: Props) {
  const a       = group.latest
  const n       = group.items.length
  const title   = displayTitle(a)
  const sev     = group.severity in SEVERITY_LABEL ? group.severity : 'info'
  const ids     = group.items.map(i => i.id)
  const hasBody = Boolean(a.body?.trim())
  // The day heading above gives the date; the row gives the clock time, and the full date and how
  // long ago on hover.
  const when    = <time className="al-time" dateTime={a.created_at} title={`${fullTime(a.created_at)} (${relativeTime(a.created_at, now)} ago)`}>{clockTime(a.created_at)}</time>

  const activate = () => (selectMode ? onSelect(selection !== 'all') : onToggle())
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate() }
  }

  return (
    <li
      className="al-row"
      data-unread={group.unread > 0}
      data-expanded={expanded}
      data-selected={selection !== 'none'}
      aria-busy={busy || undefined}
    >
      <div className="al-row-head">
        {selectMode && (
          <label className="al-check">
            <input
              type="checkbox"
              checked={selection === 'all'}
              ref={el => { if (el) el.indeterminate = selection === 'some' }}
              onChange={e => onSelect(e.target.checked)}
              aria-label={`Select ${title}${a.client_name ? ` for ${a.client_name}` : ''}`}
            />
          </label>
        )}

        <span className="al-lead">
          <span className="al-dot" aria-hidden />
          <span className={`al-icon al-icon--${sev}`} title={`${SEVERITY_LABEL[sev]}, ${typeLabel(a.type)}`}>
            {TYPE_ICON[a.type] ?? <Bell size={15} weight="duotone" aria-hidden />}
          </span>
        </span>

        <div
          className="al-main"
          role="button"
          tabIndex={0}
          aria-expanded={selectMode ? undefined : expanded}
          aria-pressed={selectMode ? selection === 'all' : undefined}
          onClick={activate}
          onKeyDown={onKey}
        >
          <span className="sr-only">
            {group.unread > 0 ? 'Unread. ' : ''}{SEVERITY_LABEL[sev]} {typeLabel(a.type)} alert.
          </span>
          <span className="al-meta">
            <span className="al-client">{a.client_name ?? typeLabel(a.type)}</span>
            <span className="al-meta-time">{when}</span>
          </span>
          <span className="al-titleline">
            <span className="al-title">{title}</span>
            {n > 1 && <span className="al-count" title={`${n} similar alerts`}>×{n}</span>}
            {(hasBody || n > 1) && <CaretDown size={12} weight="bold" className="al-caret" aria-hidden />}
          </span>
          {!expanded && hasBody && <AlertBody body={a.body} lines={2} className="al-preview" />}
        </div>

        <div className="al-aside">
          <span className="al-aside-time">{when}</span>
          <span className="al-actions">
            {a.link_url && (
              <Link className="al-action" href={a.link_url} onClick={onOpenLink} aria-label={`View ${title}`} title="View">
                <span className="al-action-label">View</span><ArrowRight size={14} aria-hidden />
              </Link>
            )}
            <button
              type="button"
              className="al-action al-action--dismiss"
              onClick={() => onDismiss(ids)}
              disabled={busy}
              aria-label={n > 1 ? `Dismiss all ${n}: ${title}` : `Dismiss ${title}`}
              title={n > 1 ? `Dismiss all ${n}` : 'Dismiss'}
            >
              <X size={14} aria-hidden />
            </button>
          </span>
        </div>
      </div>

      {expanded && (
        <div className="al-detail">
          {hasBody && <AlertBody body={a.body} className="al-full" />}

          {n > 1 && (
            <div className="al-history">
              <p className="al-history-title">{n} times</p>
              <ol>
                {group.items.map(item => (
                  <li key={item.id} className="al-occ" data-unread={item.read_at == null}>
                    <span className="al-dot" aria-hidden />
                    <time dateTime={item.created_at} className="al-occ-time">{fullTime(item.created_at)}</time>
                    <span className="al-occ-text">{alertPlainText(item.body) || displayTitle(item)}</span>
                    <button
                      type="button"
                      className="al-action al-action--dismiss"
                      onClick={() => onDismiss([item.id])}
                      disabled={busy}
                      aria-label={`Dismiss the alert from ${fullTime(item.created_at)}`}
                      title="Dismiss this one"
                    >
                      <X size={13} aria-hidden />
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="al-detail-actions">
            {a.link_url && (
              <Link className="btn btn-secondary btn-sm" href={a.link_url} onClick={onOpenLink}>
                View details<ArrowRight size={13} aria-hidden />
              </Link>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDismiss(ids)} disabled={busy}>
              {n > 1 ? `Dismiss all ${n}` : 'Dismiss'}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}
