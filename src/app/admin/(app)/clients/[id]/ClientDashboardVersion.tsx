'use client'

// Per-client switch for the rebuilt client dashboard.
//
// The rebuilt structure gives each channel its own page — Overview, Paid Ads, SEO, Analytics, CRM —
// instead of one Summary page carrying all of them. It is being trialled on local SEO clients first,
// so it is opt-in per client: everyone else keeps exactly what they have today.

import { useState } from 'react'
import SaveStatus, { useSaveStatus, requestJson } from '@/components/ui/SaveStatus'

export default function ClientDashboardVersion({
  clientId, initialEnabled,
}: { clientId: string; initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const save = useSaveStatus()

  const toggle = async (next: boolean) => {
    const previous = enabled
    setEnabled(next)
    const ok = await save.run(() => requestJson(`/api/admin/clients/${clientId}`, {
      method: 'PATCH',
      json:   { dashboard_v2: next },
    }))
    if (!ok) setEnabled(previous)   // put it back if the save failed
  }

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="section-title">Which dashboard this client sees</h2>
        <SaveStatus state={save.state} error={save.error} retry={save.retry} />
      </div>
      <p className="section-desc mb-3">
        Which dashboard this client sees when they open their link.
      </p>

      <label className="client-dashv2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={e => void toggle(e.target.checked)}
          aria-describedby="client-dashv2-hint"
        />
        <span>
          <span className="client-dashv2__title">
            New layout <span className="badge badge-blue">BETA</span>
          </span>
          <span id="client-dashv2-hint" className="client-dashv2__hint">
            One page per channel — Overview, Paid Ads, SEO, Analytics and CRM — each carrying its
            full report. Built for local SEO clients first. Leave off to keep the current Summary
            page with its sub-pages.
          </span>
        </span>
      </label>
    </div>
  )
}
