'use client'

// Tabbed panels (keywords, ads, search terms, negatives on the ad group page), on the app's one tab
// strip. The old hand-rolled row couldn't scroll, so on a phone the last tabs ran off the screen;
// ScrollTabs scrolls and shows an arrow on the side that has more.
//
// Panels stay mounted and are only hidden, so switching tabs keeps each table's sort order.

import { useState, type ReactNode } from 'react'
import ScrollTabs from '@/components/ui/ScrollTabs'

interface Tab {
  label: string
  count?: number
}

export default function TabContainer({
  tabs,
  panels,
  defaultTab = 0,
  label = 'Sections',
}: {
  tabs: Tab[]
  panels: ReactNode[]
  defaultTab?: number
  /** Accessible name for the tab strip. */
  label?: string
}) {
  const [active, setActive] = useState(defaultTab)

  return (
    <div>
      <ScrollTabs
        className="mb-4"
        label={label}
        items={tabs.map((t, i) => ({ id: String(i), label: t.label, count: t.count }))}
        activeId={String(active)}
        onSelect={id => setActive(Number(id))}
      />
      {panels.map((panel, i) => (
        <div
          key={i}
          role="tabpanel"
          aria-label={tabs[i]?.label}
          hidden={i !== active}
        >
          {panel}
        </div>
      ))}
    </div>
  )
}
