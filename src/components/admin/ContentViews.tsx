'use client'

// The Content page's view switcher. Switching used to be a plain link, so every click reloaded the
// whole app and skipped the router cache (30s, next.config staleTimes). Now it navigates in place:
// a view seen in the last 30 seconds comes back at once, and a fresh one shows its own skeleton
// straight away instead of the old view sitting there until the server answers.

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition, type MouseEvent, type ReactNode } from 'react'

export type ContentView = 'overview' | 'review' | 'calendar' | 'silos'

const VIEWS: { id: ContentView; label: string }[] = [
  { id: 'overview', label: 'Clients' },
  { id: 'review',   label: 'Review' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'silos',    label: 'Priority topics' },
]

export default function ContentViews({ active, children }: { active: ContentView; children: ReactNode }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [target, setTarget] = useState<ContentView | null>(null)
  const loading = pending && target !== null && target !== active
  const shown: ContentView = loading && target ? target : active

  function go(e: MouseEvent<HTMLAnchorElement>, id: ContentView) {
    // New tab, new window and the like keep the browser's own behaviour.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    if (id === active && !pending) return
    setTarget(id)
    startTransition(() => router.push(`/admin/content?view=${id}`))
  }

  return (
    <>
      <div className="page-header cv-header">
        <h1 className="page-title" style={{ margin: 0 }}>Content</h1>
        <Link href="/admin/content/settings" title="Content settings" className="cv-settings">⚙ Settings</Link>
        <div style={{ flex: 1 }} />
        {/* Labels stay on one line; on a phone the row scrolls rather than wraps. */}
        <nav className="cv-switch" aria-label="Content views">
          {VIEWS.map(v => (
            <Link
              key={v.id}
              href={`/admin/content?view=${v.id}`}
              onClick={e => go(e, v.id)}
              className={`cv-tab${shown === v.id ? ' cv-tab--on' : ''}`}
              aria-current={shown === v.id ? 'page' : undefined}
            >
              {v.label}
            </Link>
          ))}
        </nav>
      </div>

      {loading && target ? <ContentViewSkeleton view={target} /> : children}
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
        <>
          <div className="cv-skel-bar"><Bar w={200} h={20} /><Bar w={120} h={28} /></div>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="card cv-skel-post">
              <span className="skeleton" style={{ width: 96, height: 64, borderRadius: 6, flexShrink: 0 }} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Bar w={`${70 - (i % 3) * 12}%`} h={14} />
                <Bar w="40%" />
                <Bar w="85%" h={10} />
              </div>
              <Bar w={84} h={30} style={{ borderRadius: 6, alignSelf: 'center' }} />
            </div>
          ))}
        </>
      )}

      {view === 'calendar' && (
        <>
          <div className="cv-skel-bar">{[112, 112, 96, 96].map((w, i) => <Bar key={i} w={w} h={30} style={{ borderRadius: 6 }} />)}</div>
          {Array.from({ length: 3 }, (_, g) => (
            <div key={g} style={{ marginBottom: 22 }}>
              <Bar w={80} h={14} style={{ marginBottom: 10 }} />
              {Array.from({ length: 2 }, (_, i) => (
                <div key={i} className="cv-skel-row">
                  <Bar w={64} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}><Bar w="50%" h={14} /><Bar w="30%" /></div>
                  <Bar w={80} h={20} style={{ borderRadius: 999 }} />
                </div>
              ))}
            </div>
          ))}
        </>
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
