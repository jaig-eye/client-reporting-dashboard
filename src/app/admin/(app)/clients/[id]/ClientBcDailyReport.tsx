'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import SaveStatus, { useSaveStatus, requestJson } from '@/components/ui/SaveStatus'

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
  const status = useSaveStatus()
  const saving = status.saving

  function toggle(next: boolean) {
    const prev = value
    void status.run(async () => {
      setValue(next)
      try {
        await requestJson(`/api/admin/clients/${clientId}`, { method: 'PATCH', json: { bc_daily_report: next } })
      } catch (err) {
        setValue(prev)
        throw err
      }
      router.refresh()
    })
  }

  if (!hasDiscord) {
    return (
      <p className="text-xs" style={{ color: 'var(--text-faint)', marginTop: 8 }}>
        Set up a Discord channel to enable daily sales reports.
      </p>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 12px', marginTop: 10 }}>
      <label
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}
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
      <SaveStatus state={status.state} error={status.error} retry={status.retry} />
    </div>
  )
}
