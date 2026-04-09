'use client'

// Source tab bar shown on the client dashboard when a client has more than
// one data source connected (e.g. Google Ads + Meta).
// Switching tabs navigates to /?source=<type> without a page reload.

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { getConnectorDef } from '@/lib/connectors/registry'
import type { ConnectorType } from '@/lib/types'

interface Props {
  sources:      string[]
  activeSource: string
}

export default function DashboardSourceTabs({ sources, activeSource }: Props) {
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()

  function switchSource(source: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('source', source)
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div
      className="flex items-center gap-1 p-1 rounded-xl w-fit"
      style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)' }}
    >
      {sources.map(source => {
        const def    = getConnectorDef(source as ConnectorType)
        const active = source === activeSource

        return (
          <button
            key={source}
            onClick={() => switchSource(source)}
            aria-pressed={active}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium focus-ring"
            style={{
              background:  active ? 'var(--bg-surface)' : 'transparent',
              color:       active ? 'var(--text-primary)' : 'var(--text-muted)',
              boxShadow:   active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              transition: 'background 0.15s, color 0.15s, box-shadow 0.15s',
              border: 'none', cursor: 'pointer',
            }}
          >
            {/* Colored dot as source indicator */}
            <span
              className="h-2 w-2 rounded-full flex-shrink-0"
              style={{ background: active ? def.color : 'var(--text-faint)' }}
            />
            {def.label}
          </button>
        )
      })}
    </div>
  )
}
