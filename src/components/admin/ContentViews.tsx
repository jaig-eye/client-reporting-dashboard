'use client'

// The Content page's header and view switcher. The views are URL pill tabs (RouteTabs): they
// navigate in place, so a view seen in the last 30 seconds comes back at once (next.config
// staleTimes), and a fresh one shows its own skeleton straight away instead of the old view
// sitting there until the server answers.

import Link from 'next/link'
import type { ReactNode } from 'react'
import { GearSix } from '@phosphor-icons/react'
import PageHeader from '@/components/ui/PageHeader'
import { RouteTabs } from '@/components/ui/PillTabs'
import { Sk } from '@/components/ui/Skeleton'

export type ContentView = 'overview' | 'review' | 'calendar' | 'silos'

const VIEWS: { id: ContentView; label: string }[] = [
  { id: 'overview', label: 'Clients' },
  { id: 'review',   label: 'Review' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'silos',    label: 'Priority topics' },
]

/** The page's header: title, Settings, and the views as URL pill tabs. */
export function ContentHeader() {
  return (
    <PageHeader
      title="Content"
      description="Review what’s due, see what’s scheduled, and choose what gets written next."
      actions={<Link href="/admin/content/settings" className="btn btn-secondary"><GearSix size={15} aria-hidden />Settings</Link>}
    />
  )
}

export default function ContentViews({ active, children }: { active: ContentView; children: ReactNode }) {
  return (
    <>
      <ContentHeader />
      <RouteTabs
        items={VIEWS.map(v => ({ id: v.id, label: v.label, href: `/admin/content?view=${v.id}` }))}
        activeId={active}
        label="Content views"
        pending={{
          overview: <ContentViewSkeleton view="overview" />,
          review:   <ContentViewSkeleton view="review" />,
          calendar: <ContentViewSkeleton view="calendar" />,
          silos:    <ContentViewSkeleton view="silos" />,
        }}
      >
        {children}
      </RouteTabs>
    </>
  )
}

const Bar = ({ w, h = 12, style }: { w: number | string; h?: number; style?: React.CSSProperties }) => (
  <span className="skeleton" style={{ display: 'block', width: w, height: h, borderRadius: 4, ...style }} />
)

/** A stand-in shaped like each view, shown while it loads. */
export function ContentViewSkeleton({ view }: { view: ContentView }) {
  return (
    <div className="cv-skel" aria-busy="true" aria-label="Loading">
      {view === 'overview' && (
        <>
          <Bar w="55%" style={{ marginBottom: 14 }} />
          <div className="cv-skel-bar"><Bar w={260} /><Bar w={180} /></div>
          <div className="card cv-skel-card">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="cv-skel-row">
                <span className="skeleton" style={{ width: 24, height: 24, borderRadius: 6, flexShrink: 0 }} />
                <Bar w={120} />
                <Bar w={90} h={18} style={{ borderRadius: 999 }} />
                <Bar w={64} h={18} style={{ borderRadius: 999 }} />
                <Bar w={130} />
                <Bar w={90} />
                <Bar w={40} style={{ marginLeft: 'auto' }} />
              </div>
            ))}
          </div>
        </>
      )}

      {view === 'review' && (
        <div className="mr">
          <div className="mr-bar"><Sk w={190} h={22} /><Sk h={8} r={999} style={{ flex: '1 1 160px' }} /><Sk w={210} h={12} /></div>
          {[3, 2].map((n, g) => (
            <div key={g} className="mr-client">
              <div className="mr-client-head"><Sk w={180} h={16} /><Sk w={90} h={11} style={{ marginLeft: 'auto' }} /></div>
              <div className="mr-posts">
                {Array.from({ length: n }, (_, i) => (
                  <div key={i} className="mr-card">
                    <Sk w={52} h={38} r={4} />
                    <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}><Sk w={`${72 - i * 14}%`} h={13} /><Sk w="34%" h={10} /></span>
                    <Sk w={32} h={32} r={6} /><Sk w={68} h={32} r={6} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'calendar' && (
        <div>
          <div className="cal-bar"><Sk w={250} h={32} r={8} /><Sk w={170} h={38} r={8} /><Sk w={360} h={38} r={999} /><span className="cal-spacer" /><Sk w={110} h={38} r={8} /></div>
          <Sk w={300} h={12} style={{ marginBottom: 22 }} />
          {[3, 2].map((n, g) => (
            <div key={g} style={{ marginBottom: 26 }}>
              <div className="cal-month-head" style={{ cursor: 'default' }}><Sk w={150} h={18} /><span className="cal-month-rule" /><Sk w={50} h={11} /></div>
              <Sk w={140} h={12} style={{ marginBottom: 10 }} />
              <div className="cal-grid">
                {Array.from({ length: n }, (_, i) => (
                  <div key={i} className="cal-card"><span style={{ display: 'flex', gap: 6 }}><Sk w={46} h={20} r={4} /><Sk w={80} h={20} r={999} /></span><Sk w="88%" h={13} /><Sk w="60%" h={13} /></div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'silos' && (
        <>
          <Bar w="50%" style={{ marginBottom: 16 }} />
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="card cv-skel-set">
              <div className="cv-skel-bar" style={{ marginBottom: 12 }}><Bar w={160} h={16} /><Bar w={90} h={20} style={{ borderRadius: 999 }} /></div>
              <Bar w="100%" h={8} style={{ borderRadius: 999, marginBottom: 12 }} />
              <Bar w="60%" />
            </div>
          ))}
        </>
      )}
    </div>
  )
}
