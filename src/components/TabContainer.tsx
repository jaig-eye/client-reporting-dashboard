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
      <div className="flex items-center gap-1 mb-4" style={{ borderBottom: '1px solid var(--border)' }}>
        {tabs.map((tab, i) => (
          <button
            key={i}
            onClick={() => setActive(i)}
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
              transition: 'all 0.15s',
              marginBottom: '-1px',
            }}
          >
            {tab.label}
            {tab.count != null && (
              <span
                style={{
                  marginLeft: 6,
                  fontSize: '0.7rem',
                  padding: '1px 6px',
                  borderRadius: 99,
                  background: i === active ? '#eff6ff' : 'var(--bg-subtle)',
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
        <div key={i} style={{ display: i === active ? 'block' : 'none' }}>
          {panel}
        </div>
      ))}
    </div>
  )
}
