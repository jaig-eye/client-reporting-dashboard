'use client'

// The one tab strip for the app.
//
// Tabs were hand-rolled per page as bare underlined text, and on a phone the ones that didn't fit
// simply ran off the edge — with nothing to say they were there. This strip is a rounded track with
// the active tab as a raised pill, and when it overflows it shows an arrow on the side that has more.
//
// Works for both kinds of tab the app has: links (`href`, state lives in the URL) and buttons
// (`onSelect`, state lives in the page).

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'

export interface TabItem {
  id: string
  label: ReactNode
  /** Linkable tab. Takes precedence over onSelect. */
  href?: string
  /** Small count shown after the label. */
  count?: number
}

interface Props {
  items: TabItem[]
  activeId: string
  onSelect?: (id: string) => void
  /**
   * Called when a linked tab is clicked, before the browser follows it. Lets a caller take the
   * navigation over — to start a transition and show something while it runs — while the tab stays
   * a real anchor for middle-click and "copy link".
   */
  onNavigate?: (id: string, href: string, e: React.MouseEvent<HTMLAnchorElement>) => void
  /** Accessible name for the strip, e.g. "Client sections". */
  label: string
  className?: string
}

export default function ScrollTabs({ items, activeId, onSelect, onNavigate, label, className }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft]   = useState(false)
  const [canRight, setCanRight] = useState(false)

  const measure = useCallback(() => {
    const el = trackRef.current
    if (!el) return
    setCanLeft(el.scrollLeft > 2)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }, [])

  useEffect(() => {
    measure()
    const el = trackRef.current
    if (!el) return
    el.addEventListener('scroll', measure, { passive: true })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', measure); ro.disconnect() }
  }, [measure, items.length])

  // Bring the active tab into view — on a phone it may start off-screen.
  useEffect(() => {
    const el = trackRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId])

  const nudge = (dir: -1 | 1) => {
    const el = trackRef.current
    if (!el) return
    el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.6, 120), behavior: 'smooth' })
  }

  return (
    <div className={`tabs ${className ?? ''}`} data-can-left={canLeft} data-can-right={canRight}>
      {canLeft && (
        <button type="button" className="tabs__arrow tabs__arrow--left" onClick={() => nudge(-1)} aria-label="Show earlier tabs">
          <CaretLeft size={14} weight="bold" />
        </button>
      )}

      <div ref={trackRef} className="tabs__track" role="tablist" aria-label={label}>
        {items.map(item => {
          const active = item.id === activeId
          const inner = (
            <>
              <span>{item.label}</span>
              {item.count != null && item.count > 0 && <span className="tabs__count">{item.count}</span>}
            </>
          )
          return item.href ? (
            <Link
              key={item.id}
              href={item.href}
              role="tab"
              aria-selected={active}
              data-active={active}
              className="tabs__tab"
              scroll={false}
              onClick={e => onNavigate?.(item.id, item.href as string, e)}
            >
              {inner}
            </Link>
          ) : (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-active={active}
              className="tabs__tab"
              onClick={() => onSelect?.(item.id)}
            >
              {inner}
            </button>
          )
        })}
      </div>

      {canRight && (
        <button type="button" className="tabs__arrow tabs__arrow--right" onClick={() => nudge(1)} aria-label="Show more tabs">
          <CaretRight size={14} weight="bold" />
        </button>
      )}
    </div>
  )
}
