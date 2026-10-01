// Loading placeholders for the admin. One look everywhere: the .skeleton shimmer (globals.css),
// whose light sweep reads as "on its way" rather than "broken". Shapes follow the page they stand
// in for, so the swap to real content doesn't jump. No 'use client': these render from loading.tsx
// files on the server too.

import type { CSSProperties, ReactNode } from 'react'

/** One shimmering block. Width/height take numbers (px) or any CSS length. */
export function Sk({ w = '100%', h = 12, r, className, style }: {
  w?: number | string; h?: number | string; r?: number | string; className?: string; style?: CSSProperties
}) {
  return (
    <span
      aria-hidden
      className={`skeleton ui-sk${className ? ` ${className}` : ''}`}
      style={{ width: w, height: h, ...(r !== undefined ? { borderRadius: r } : {}), ...style }}
    />
  )
}

/** Lines of text, the last one shorter. */
export function SkText({ lines = 2, gap = 8, last = '60%' }: { lines?: number; gap?: number; last?: string }) {
  return (
    <span aria-hidden style={{ display: 'flex', flexDirection: 'column', gap }}>
      {Array.from({ length: lines }, (_, i) => <Sk key={i} w={i === lines - 1 && lines > 1 ? last : '100%'} />)}
    </span>
  )
}

/** The page header: a title, a line of description, and room for actions. */
export function SkHeader({ actions = 1, desc = true, tile = false }: { actions?: number; desc?: boolean; tile?: boolean }) {
  return (
    <div className="ui-ph" aria-hidden>
      <div className="ui-ph-main">
        {tile && <Sk w={48} h={48} r={14} />}
        <div className="ui-ph-text" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Sk w={220} h={22} r={6} />
          {desc && <Sk w="min(420px, 80%)" h={12} />}
        </div>
      </div>
      {actions > 0 && (
        <div className="ui-ph-actions">
          {Array.from({ length: actions }, (_, i) => <Sk key={i} w={i === actions - 1 ? 112 : 96} h={36} r={8} />)}
        </div>
      )}
    </div>
  )
}

/** A strip of pill tabs. */
export function SkTabs({ count = 4 }: { count?: number }) {
  return (
    <div aria-hidden style={{ marginBottom: 20 }}>
      <span style={{ display: 'inline-flex', gap: 4, padding: 3, borderRadius: 999, background: 'var(--bg-subtle)', maxWidth: '100%', overflow: 'hidden' }}>
        {Array.from({ length: count }, (_, i) => <Sk key={i} w={[84, 104, 76, 92, 70, 88][i % 6]} h={30} r={999} />)}
      </span>
    </div>
  )
}

/** A row of stat cards. */
export function SkStats({ count = 4 }: { count?: number }) {
  return (
    <div className="ui-sk-stats" style={{ ['--sk-cols' as string]: count }} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card ui-sk-stat">
          <Sk w={90} h={11} />
          <Sk w={120} h={24} r={6} style={{ marginTop: 12 }} />
          <Sk w="60%" h={10} style={{ marginTop: 10 }} />
        </div>
      ))}
    </div>
  )
}

/** List rows in the shared row shape: tile, two lines, a trailing control. */
export function SkRows({ rows = 6, tile = true, trailing = true }: { rows?: number; tile?: boolean; trailing?: boolean }) {
  return (
    <div className="ui-sk-rows" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="ui-row">
          {tile && <Sk w={32} h={32} r={8} />}
          <span className="ui-row-text" style={{ gap: 7 }}>
            <Sk w={`${[46, 58, 38, 52, 44, 62][i % 6]}%`} h={12} />
            <Sk w={`${[30, 24, 36, 28, 33, 21][i % 6]}%`} h={10} />
          </span>
          {trailing && <Sk w={72} h={26} r={999} />}
        </div>
      ))}
    </div>
  )
}

/** A table: header row and body rows of cells. */
export function SkTable({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  const widths = ['34%', '14%', '12%', '12%', '10%', '10%', '8%']
  return (
    <div aria-hidden>
      <div style={{ display: 'flex', gap: 16, padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        {Array.from({ length: cols }, (_, c) => <Sk key={c} w={widths[c % widths.length]} h={10} />)}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 16px', borderBottom: r === rows - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
          {Array.from({ length: cols }, (_, c) => (
            c === 0
              ? <span key={c} style={{ width: widths[0], display: 'flex', alignItems: 'center', gap: 10 }}><Sk w={26} h={26} r={6} /><Sk w="60%" h={12} /></span>
              : <Sk key={c} w={widths[c % widths.length]} h={12} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** A card with a title line and body. */
export function SkCard({ children, title = true, pad = 20 }: { children?: ReactNode; title?: boolean; pad?: number }) {
  return (
    <div className="card" style={{ padding: pad }} aria-hidden>
      {title && <Sk w={160} h={14} style={{ marginBottom: 16 }} />}
      {children ?? <SkText lines={3} />}
    </div>
  )
}

/** Wraps a skeleton so assistive tech hears one "Loading" instead of nothing. */
export function SkPage({ label = 'Loading', children }: { label?: string; children: ReactNode }) {
  return <div aria-busy="true" aria-label={label}>{children}</div>
}
