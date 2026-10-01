'use client'

// Sets or clears the DataForSEO monthly limit. Saving refreshes the page so the meter moves at once.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function DfsBudgetEditor({ initial }: { initial: number | null }) {
  const router = useRouter()
  const [value, setValue]   = useState(initial === null ? '' : String(initial))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg]       = useState<{ ok: boolean; text: string } | null>(null)
  const dirty = value.trim() !== (initial === null ? '' : String(initial))

  async function save(next: string) {
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/dataforseo-usage', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthly_budget: next.trim() === '' ? null : Number(next) }),
      })
      const d = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(d.error || 'Saving failed.')
      setValue(next)
      setMsg({ ok: true, text: next.trim() === '' ? 'Limit removed' : 'Limit saved' })
      router.refresh()
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Saving failed.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="us-budget" onSubmit={e => { e.preventDefault(); void save(value) }}>
      <label className="us-budget-field">
        <span>Monthly limit</span>
        <span className="us-budget-input">
          <span aria-hidden>$</span>
          <input
            className="input"
            type="number"
            min={0}
            step="1"
            inputMode="decimal"
            placeholder="No limit"
            value={value}
            onChange={e => { setValue(e.target.value); setMsg(null) }}
            aria-describedby="us-budget-msg"
          />
        </span>
      </label>
      <div className="us-budget-actions">
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save limit'}</button>
        {initial !== null && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={() => save('')}>Remove limit</button>
        )}
      </div>
      <p id="us-budget-msg" role="status" className="us-budget-msg" style={msg ? { color: msg.ok ? 'var(--green-fg)' : 'var(--red-fg)' } : undefined}>{msg?.text ?? ''}</p>
    </form>
  )
}
