'use client'

// One inbox row. Collapsed it is a quiet two-to-four-line summary; tapping it opens the full body
// (and, for a collapsed run of repeats, each occurrence) in place.

import type { KeyboardEvent, ReactNode } from 'react'
import {
  RocketLaunch, ChartLineUp, NotePencil, PlugsConnected, UsersThree, Bell, X, ArrowRight, CaretDown,
} from '@phosphor-icons/react'
import AlertBody, { alertPlainText } from '@/components/admin/AlertBody'
import { displayTitle, fullTime, relativeTime, type AlertGroup } from './inbox'

const TYPE_ICON: Record<string, (size: number) => ReactNode> = {
  ad_fuel:     s => <RocketLaunch   size={s} weight="duotone" aria-hidden />,
  ad_insights: s => <ChartLineUp    size={s} weight="duotone" aria-hidden />,
  content:     s => <NotePencil     size={s} weight="duotone" aria-hidden />,
  integration: s => <PlugsConnected size={s} weight="duotone" aria-hidden />,
  crm:         s => <UsersThree     size={s} weight="duotone" aria-hidden />,
}

export const TYPE_LABEL: Record<string, string> = {
  ad_fuel: 'Ad Fuel', ad_insights: 'Ad Insights', content: 'Content', integration: 'Integration', crm: 'CRM',
}

export function typeLabel(type: string) {
  return TYPE_LABEL[type] ?? type.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
}

const SEVERITY_LABEL: Record<string, string> = { critical: 'Critical', warning: 'Warning', info: 'Info' }

interface Props {
  group:        AlertGroup
  now:          number
  expanded:     boolean
  selectMode:   boolean
  selection:    'all' | 'some' | 'none'
  busy:         boolean
  onToggle:     () => void
  onSelect:     (checked: boolean) => void
  onOpenLink:   () => void
  onDismiss:    (ids: string[]) => void
}

export default function AlertRow({
  group, now, expanded, selectMode, selection, busy, onToggle, onSelect, onOpenLink, onDismiss,
}: Props) {
  const a        = group.latest
  const n        = group.items.length
  const title    = displayTitle(a)
  const sev      = group.severity in SEVERITY_LABEL ? group.severity : 'info'
  const ids      = group.items.map(i => i.id)
  const icon     = (TYPE_ICON[a.type] ?? (s => <Bell size={s} weight="duotone" aria-hidden />))(15)
  const time     = relativeTime(a.created_at, now)
  const hasBody  = Boolean(a.body?.trim())

  const activate = () => (selectMode ? onSelect(selection !== 'all') : onToggle())
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate() }
  }

  return (
    <li
      className="inbox-row"
      data-unread={group.unread > 0}
      data-expanded={expanded}
      data-selected={selection !== 'none'}
      aria-busy={busy || undefined}
    >
      <div className="inbox-row__head">
        {selectMode && (
          <label className="inbox-row__check">
            <input
              type="checkbox"
              checked={selection === 'all'}
              ref={el => { if (el) el.indeterminate = selection === 'some' }}
              onChange={e => onSelect(e.target.checked)}
              aria-label={`Select ${title}${a.client_name ? ` for ${a.client_name}` : ''}`}
            />
          </label>
        )}

        <span className="inbox-row__lead-icon">
          <span className="inbox-row__dot" aria-hidden />
          <span className={`inbox-row__icon inbox-row__icon--${sev}`} title={`${SEVERITY_LABEL[sev]} · ${typeLabel(a.type)}`}>
            {icon}
          </span>
        </span>

        <div
          className="inbox-row__main"
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
          <div className="inbox-row__meta">
            {a.client_name && <span className="inbox-row__client">{a.client_name}</span>}
            {!a.client_name && <span className="inbox-row__client inbox-row__client--none">{typeLabel(a.type)}</span>}
            <time className="inbox-row__time inbox-row__time--inline" dateTime={a.created_at} title={fullTime(a.created_at)}>{time}</time>
          </div>
          <div className="inbox-row__titleline">
            <span className="inbox-row__title">{title}</span>
            {n > 1 && <span className="inbox-row__count" title={`${n} similar alerts`}>×{n}</span>}
            {hasBody || n > 1 ? <CaretDown size={12} weight="bold" className="inbox-row__caret" aria-hidden /> : null}
          </div>
          {!expanded && hasBody && <AlertBody body={a.body} lines={2} className="inbox-row__preview" />}
        </div>

        <div className="inbox-row__aside">
          <time className="inbox-row__time inbox-row__time--aside" dateTime={a.created_at} title={fullTime(a.created_at)}>{time}</time>
          <div className="inbox-row__actions">
            {a.link_url && (
              <a className="inbox-row__action" href={a.link_url} onClick={onOpenLink} title="View" aria-label={`View ${title}`}>
                <span className="inbox-row__action-label">View</span>
                <ArrowRight size={14} aria-hidden />
              </a>
            )}
            <button
              type="button"
              className="inbox-row__action inbox-row__action--dismiss"
              onClick={() => onDismiss(ids)}
              disabled={busy}
              title={n > 1 ? `Dismiss all ${n}` : 'Dismiss'}
              aria-label={n > 1 ? `Dismiss all ${n}: ${title}` : `Dismiss ${title}`}
            >
              <X size={14} aria-hidden />
            </button>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="inbox-row__detail">
          {hasBody && <AlertBody body={a.body} className="inbox-row__full" />}

          {n > 1 && (
            <div className="inbox-row__history">
              <p className="inbox-row__history-title">{n} occurrences</p>
              <ol>
                {group.items.map(item => (
                  <li key={item.id} className="inbox-row__occurrence" data-unread={item.read_at == null}>
                    <span className="inbox-row__dot" aria-hidden />
                    <time dateTime={item.created_at} className="inbox-row__occ-time">{fullTime(item.created_at)}</time>
                    <span className="inbox-row__occ-text">{alertPlainText(item.body) || displayTitle(item)}</span>
                    <button
                      type="button"
                      className="inbox-row__action inbox-row__action--dismiss inbox-row__occ-dismiss"
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

          <div className="inbox-row__detail-actions">
            {a.link_url && (
              <a className="btn btn-secondary inbox-btn" href={a.link_url} onClick={onOpenLink}>
                View details <ArrowRight size={13} aria-hidden />
              </a>
            )}
            <button type="button" className="btn btn-secondary inbox-btn" onClick={() => onDismiss(ids)} disabled={busy}>
              {n > 1 ? `Dismiss all ${n}` : 'Dismiss'}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}
