'use client'

import { useState } from 'react'

export default function ClientAdFuelCut({
  clientId,
  currentCut,
  globalCut,
}: {
  clientId: string
  currentCut?: number | null
  globalCut: number
}) {
  // null = use global; display as empty string in input
  const [value,   setValue]   = useState<string>(currentCut != null ? String(Math.round(currentCut * 10000) / 100) : '')
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState('')

  async function save(overrideVal: number | null) {
    setSaving(true)
    setError('')
    setSaved(false)
    const res = await fetch(`/api/admin/clients/${clientId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ad_fuel_cut: overrideVal }),
    })
    const data = await res.json()
    if (data.error) setError(data.error)
    else { setSaved(true); setTimeout(() => setSaved(false), 2000) }
    setSaving(false)
  }

  function handleSave() {
    if (value === '') {
      save(null)       // reset to global
    } else {
      const pct = parseFloat(value)
      if (isNaN(pct) || pct < 0 || pct >= 100) { setError('Enter a value from 0 to 99'); return }
      save(pct / 100)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="number"
          step="0.1"
          min="0"
          max="99"
          placeholder={`Global: ${Math.round(globalCut * 100)}%`}
          className="input"
          style={{ width: '7rem' }}
          value={value}
          onChange={e => { setValue(e.target.value); setSaved(false) }}
        />
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>%</span>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
          disabled={saving}
          onClick={handleSave}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {value !== '' && (
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
            disabled={saving}
            onClick={() => { setValue(''); save(null) }}
          >
            Reset to global
          </button>
        )}
      </div>
      {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
      {saved && <p className="text-xs" style={{ color: 'var(--green)' }}>Saved ✓</p>}
      <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
        Leave blank to use the global setting ({Math.round(globalCut * 100)}%).
        Set to 0 for full pass-through (no agency cut).
      </p>
    </div>
  )
}
