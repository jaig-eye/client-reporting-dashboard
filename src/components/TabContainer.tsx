'use client'

import { useState } from 'react'

interface Tab {
  label: string
  count?: number
}

export default function TabContainer({
  tabs,
  panels,
  defaultTab = 0,
}: {
  tabs: Tab[]
  panels: React.ReactNode[]
  defaultTab?: number
}) {
  const [active, setActive] = useState(defaultTab)

  return (
    <div>
      <div
        role="tablist"
        className="flex items-center gap-1 mb-4"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        {tabs.map((tab, i) => (
          <button
            key={i}
            role="tab"
            aria-selected={i === active}
            aria-controls={`tab-panel-${i}`}
            id={`tab-${i}`}
            onClick={() => setActive(i)}
            className="focus-ring"
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: i === active ? 'var(--blue)' : 'var(--text-muted)',
              borderBottom: i === active ? '2px solid var(--blue)' : '2px solid transparent',
              background: 'none',
              border: 'none',
              borderBottomStyle: 'solid',
              cursor: 'pointer',
              transition: 'color 0.15s, border-color 0.15s',
              marginBottom: '-1px',
            }}
          >
            {tab.label}
            {tab.count != null && (
              <span
                style={{
                  marginLeft: 6,
                  fontSize: '0.6875rem',
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: i === active ? 'var(--blue-subtle)' : 'var(--bg-subtle)',
                  color: i === active ? 'var(--blue)' : 'var(--text-faint)',
                }}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>
      {panels.map((panel, i) => (
        <div
          key={i}
          id={`tab-panel-${i}`}
          role="tabpanel"
          aria-labelledby={`tab-${i}`}
          style={{ display: i === active ? 'block' : 'none' }}
        >
          {panel}
        </div>
      ))}
    </div>
  )
}
