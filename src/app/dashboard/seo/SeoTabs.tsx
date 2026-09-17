'use client'

// The SEO tabs, with something to look at while the next one loads.
//
// Each tab is a search param on the same route, which means Next's loading.tsx never fires for it:
// the browser sits on the old tab, apparently doing nothing, until the server has finished. Short
// or long, that reads as lag.
//
// So the navigation is driven here instead. The click starts a transition, the strip moves to the
// tab you asked for straight away, and a skeleton stands in until the real section arrives. The
// wait is the same; nobody spends it wondering whether the click registered.
//
// The tabs stay real links. Only a plain left-click is intercepted, so middle-click, ⌘-click and
// "copy link address" behave the way they look like they should.

import { useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import ScrollTabs, { type TabItem } from '@/components/ui/ScrollTabs'

function TabSkeleton() {
  return (
    <div className="seo-section seo-skel" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <section className="card seo-panel">
        <div className="seo-panel__head">
          <span className="dash-bone" style={{ width: '11rem', height: '0.9rem' }} />
          <span className="dash-bone" style={{ width: '19rem', height: '0.7rem', marginTop: '0.5rem' }} />
        </div>
        <div className="seo-panel__body">
          <div className="seo-skel-rows">
            {[0, 1, 2, 3, 4, 5].map(i => (
              <span key={i} className="dash-bone" style={{ height: '1.75rem' }} />
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

export default function SeoTabs({
  items, activeId, children,
}: {
  items: TabItem[]
  activeId: string
  children: ReactNode
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [pendingId, setPendingId] = useState<string | null>(null)

  return (
    <>
      <ScrollTabs
        label="SEO sections"
        className="seo-tabs"
        // Move the strip the moment it is clicked, not when the server answers.
        activeId={isPending && pendingId ? pendingId : activeId}
        items={items}
        onNavigate={(id, href, e) => {
          // Anything but a plain left-click is the browser's business, not ours.
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
          e.preventDefault()
          setPendingId(id)
          startTransition(() => router.push(href, { scroll: false }))
        }}
      />
      {isPending ? <TabSkeleton /> : children}
    </>
  )
}
