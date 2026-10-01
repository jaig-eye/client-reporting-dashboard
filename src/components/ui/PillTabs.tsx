'use client'

// Pill tabs, the one tab style for the admin. Two kinds:
//   - PillTabs: in-page tabs over client state (onSelect), with tab semantics.
//   - RouteTabs: tabs that are URLs (?tab=…). They navigate in place, and the tab you clicked
//     lights up and shows its skeleton at once instead of the old tab sitting there until the
//     server answers.
// A strip too wide for its container scrolls, fades at the cut edge and grows arrow buttons.

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition, type MouseEvent, type ReactNode } from 'react'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'

export interface PillTab {
  id:     string
  label:  ReactNode
  icon?:  ReactNode
  count?: number | null
  /** Shows the count as an alert (red), for things that need someone. */
  alert?: boolean
  href?:  string
}

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

/** Fade and arrow state for a horizontally scrolling strip. */
function useOverflow() {
  const trackRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ l: false, r: false })
  const measure = useCallback(() => {
    const el = trackRef.current
    if (!el) return
    const l = el.scrollLeft > 2
    const r = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
    setEdges(e => (e.l === l && e.r === r ? e : { l, r }))
  }, [])
  useIsoLayoutEffect(() => {
    const el = trackRef.current
    if (!el) return
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    el.addEventListener('scroll', measure, { passive: true })
    return () => { ro.disconnect(); el.removeEventListener('scroll', measure) }
  }, [measure])
  const nudge = (dir: 1 | -1) => trackRef.current?.scrollBy({ left: dir * 220, behavior: 'smooth' })
  return { trackRef, edges, nudge, measure }
}

function TabInner({ tab }: { tab: PillTab }) {
  return (
    <>
      {tab.icon && <span className="ui-tab-icon" aria-hidden>{tab.icon}</span>}
      {tab.label}
      {tab.count != null && tab.count > 0 && (
        <span className={`ui-tab-count${tab.alert ? ' ui-tab-count--alert' : ''}`}>{tab.count > 99 ? '99+' : tab.count}</span>
      )}
    </>
  )
}

function Strip({ label, block, children, activeKey }: { label: string; block?: boolean; children: ReactNode; activeKey: string }) {
  const { trackRef, edges, nudge, measure } = useOverflow()
  // Keep the selected tab in view when it changes (a deep link to the last tab on a phone).
  useEffect(() => {
    const el = trackRef.current?.querySelector<HTMLElement>('[aria-selected="true"], [aria-current="page"]')
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    measure()
  }, [activeKey, trackRef, measure])
  return (
    <div className={`ui-tabs${block ? ' ui-tabs--block' : ''}`} data-fade-l={edges.l} data-fade-r={edges.r}>
      {edges.l && <button type="button" className="ui-tabs-arrow ui-tabs-arrow--l" onClick={() => nudge(-1)} aria-label={`Scroll ${label} left`} tabIndex={-1}><CaretLeft size={13} weight="bold" /></button>}
      <div ref={trackRef} className="ui-tabs-track">{children}</div>
      {edges.r && <button type="button" className="ui-tabs-arrow ui-tabs-arrow--r" onClick={() => nudge(1)} aria-label={`Scroll ${label} right`} tabIndex={-1}><CaretRight size={13} weight="bold" /></button>}
    </div>
  )
}

/** In-page tabs over client state. */
export function PillTabs({ items, activeId, onSelect, label, block, idPrefix }: {
  items: PillTab[]
  activeId: string
  onSelect: (id: string) => void
  /** What the tabs choose between, for screen readers ("Client sections"). */
  label: string
  /** Stretch to the container's width (a segmented control on phones). */
  block?: boolean
  /** Pair tabs with panels: tab ids become `${idPrefix}-tab-${id}`, panels `${idPrefix}-panel-${id}`. */
  idPrefix?: string
}) {
  function onKey(e: React.KeyboardEvent, i: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const n = items.length
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n
    onSelect(items[next].id)
    const btn = (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)
    btn?.focus()
  }
  return (
    <Strip label={label} block={block} activeKey={activeId}>
      <div role="tablist" aria-label={label} style={{ display: 'contents' }}>
        {items.map((t, i) => {
          const on = t.id === activeId
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={idPrefix ? `${idPrefix}-tab-${t.id}` : undefined}
              aria-controls={idPrefix ? `${idPrefix}-panel-${t.id}` : undefined}
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              className="ui-tab"
              onClick={() => onSelect(t.id)}
              onKeyDown={e => onKey(e, i)}
            >
              <TabInner tab={t} />
            </button>
          )
        })}
      </div>
    </Strip>
  )
}

/**
 * Tabs that are URLs. Children are the current tab's content; while another tab loads, its
 * `pending` skeleton takes their place.
 */
export function RouteTabs({ items, activeId, label, block, pending, children }: {
  items: (PillTab & { href: string })[]
  activeId: string
  label: string
  block?: boolean
  /** Each tab's skeleton while it loads, by tab id. A map rather than a function, so a server
   *  component can pass it. */
  pending?: Record<string, ReactNode>
  children?: ReactNode
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [target, setTarget] = useState<string | null>(null)
  const loading = isPending && target !== null && target !== activeId
  const shown = loading && target ? target : activeId

  function go(e: MouseEvent<HTMLAnchorElement>, t: PillTab & { href: string }) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    if (t.id === activeId && !isPending) return
    setTarget(t.id)
    startTransition(() => router.push(t.href, { scroll: false }))
  }

  return (
    <>
      <nav aria-label={label} style={{ marginBottom: 20, maxWidth: '100%' }}>
        <Strip label={label} block={block} activeKey={shown}>
          {items.map(t => (
            <Link
              key={t.id}
              href={t.href}
              scroll={false}
              className="ui-tab"
              aria-current={shown === t.id ? 'page' : undefined}
              onClick={e => go(e, t)}
            >
              <TabInner tab={t} />
            </Link>
          ))}
        </Strip>
      </nav>
      {loading && target && pending?.[target] ? <div aria-busy="true" aria-label="Loading">{pending[target]}</div> : children}
    </>
  )
}
