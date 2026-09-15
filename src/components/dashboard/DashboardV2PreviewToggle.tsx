'use client'

// Testing aid: switches this browser between the rebuilt dashboard and the original Summary.
//
// It sets a cookie rather than saving anything, so it never changes what the client sees — only
// what the person testing sees. Temporary: remove once the rebuilt dashboard is signed off.

import { useState } from 'react'
import { DASHBOARD_V2_PREVIEW_COOKIE } from '@/lib/dashboardVersion'

const THIRTY_DAYS = 60 * 60 * 24 * 30

export default function DashboardV2PreviewToggle({
  enabled, overridden,
}: { enabled: boolean; overridden: boolean }) {
  const [busy, setBusy] = useState(false)

  const go = (cookie: string, to: string) => {
    setBusy(true)
    document.cookie = `${DASHBOARD_V2_PREVIEW_COOKIE}=${cookie}; path=/; SameSite=Lax`
    // A full load, so the sidebar and page both re-render with the new layout.
    window.location.assign(to)
  }

  return (
    <div className="dashv2-toggle" role="group" aria-label="Dashboard layout for testing">
      <label className="dashv2-toggle__switch" title="Only changes what this browser sees">
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={busy}
          onChange={e => go(
            `${e.target.checked ? '1' : '0'}; max-age=${THIRTY_DAYS}`,
            e.target.checked ? '/dashboard/overview' : '/dashboard',
          )}
        />
        <span className="dashv2-toggle__track" aria-hidden="true">
          <span className="dashv2-toggle__thumb" />
        </span>
        <span className="dashv2-toggle__label">New layout</span>
        <span className="dashv2-toggle__tag">Test</span>
      </label>
      {overridden && (
        <button
          type="button"
          className="dashv2-toggle__reset"
          disabled={busy}
          onClick={() => go('; max-age=0', '/dashboard')}
        >
          Use client setting
        </button>
      )}
    </div>
  )
}
