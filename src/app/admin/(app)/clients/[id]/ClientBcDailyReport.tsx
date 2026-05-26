'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function ClientBcDailyReport({
  clientId,
  enabled,
  hasDiscord,
}: {
  clientId:   string
  enabled:    boolean
  hasDiscord: boolean
}) {
  const router   = useRouter()
  const [value,  setValue]  = useState(enabled)
  const [saving, setSaving] = useState(false)

  async function toggle(next: boolean) {
    setValue(next)
    setSaving(true)
    try {
      await fetch(`/api/admin/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bc_daily_report: next }),
      })
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  if (!hasDiscord) {
    return (
      <p className="text-xs" style={{ color: 'var(--text-faint)', marginTop: 8 }}>
        Set up a Discord channel to enable daily sales reports.
      </p>
    )
  }

  return (
    <label
      style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}
    >
      <input
        type="checkbox"
        checked={value}
        disabled={saving}
        onChange={e => toggle(e.target.checked)}
        style={{ width: 14, height: 14 }}
      />
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Send daily sales report to Discord (9 AM UTC)
      </span>
    </label>
  )
}
