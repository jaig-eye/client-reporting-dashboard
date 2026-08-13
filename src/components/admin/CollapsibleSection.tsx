'use client'

import type { ReactNode } from 'react'

// Presentational accordion section used by the two-pane ContentPostEditor.
// Matches the MonthlyReviewClientSection accordion styling (var(--border) / .card).

interface Props {
  title:    string
  open:     boolean
  onToggle: () => void
  badge?:   ReactNode
  children: ReactNode
}

export default function CollapsibleSection({ title, open, onToggle, badge, children }: Props) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12, overflow: 'hidden', background: 'var(--bg-surface)' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer',
          fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--text-muted)', transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'none' }}>▸</span>
        <span style={{ flex: 1 }}>{title}</span>
        {badge}
      </button>
      {open && (
        <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--border)' }}>
          <div style={{ paddingTop: 14 }}>{children}</div>
        </div>
      )}
    </div>
  )
}
