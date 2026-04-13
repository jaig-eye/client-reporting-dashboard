'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  clientId: string
  showBenchmarks: boolean
  globalDefaults: {
    benchmark_roas: number
    benchmark_ctr: number
    benchmark_cpc: number
    benchmark_conv_rate: number
    benchmark_cpm: number
  }
  current: {
    benchmark_roas?: number | null
    benchmark_ctr?: number | null
    benchmark_cpc?: number | null
    benchmark_conv_rate?: number | null
    benchmark_cpm?: number | null
  }
}

export default function ClientBenchmarks({ clientId, showBenchmarks, globalDefaults, current }: Props) {
  const router = useRouter()

  const [enabled, setEnabled] = useState(showBenchmarks)

  // CTR and conv_rate stored as decimals (0.03 = 3%), displayed as percentages
  const [roas,     setRoas]     = useState(current.benchmark_roas     != null ? String(current.benchmark_roas)                                       : '')
  const [ctr,      setCtr]      = useState(current.benchmark_ctr      != null ? String(parseFloat((current.benchmark_ctr      * 100).toFixed(4)))    : '')
  const [cpc,      setCpc]      = useState(current.benchmark_cpc      != null ? String(current.benchmark_cpc)                                       : '')
  const [convRate, setConvRate] = useState(current.benchmark_conv_rate != null ? String(parseFloat((current.benchmark_conv_rate * 100).toFixed(4))) : '')
  const [cpm,      setCpm]      = useState(current.benchmark_cpm      != null ? String(current.benchmark_cpm)                                       : '')

  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState('')

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/admin/clients/${clientId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.json()
  }

  async function toggleEnabled(next: boolean) {
    setEnabled(next)
    await patch({ show_benchmarks: next })
    router.refresh()
  }

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    setError('')
    const toNum = (v: string) => v.trim() === '' ? null : parseFloat(v)
    const data = await patch({
      benchmark_roas:      toNum(roas),
      benchmark_ctr:       ctr.trim()      === '' ? null : parseFloat(ctr)      / 100,
      benchmark_cpc:       toNum(cpc),
      benchmark_conv_rate: convRate.trim() === '' ? null : parseFloat(convRate) / 100,
      benchmark_cpm:       toNum(cpm),
    })
    setSaving(false)
    if (data.error) { setError(data.error) }
    else { setSaved(true); router.refresh() }
  }

  async function handleReset() {
    setSaving(true)
    setSaved(false)
    setError('')
    const data = await patch({
      benchmark_roas: null, benchmark_ctr: null, benchmark_cpc: null,
      benchmark_conv_rate: null, benchmark_cpm: null,
    })
    setSaving(false)
    if (data.error) { setError(data.error) }
    else {
      setRoas(''); setCtr(''); setCpc(''); setConvRate(''); setCpm('')
      setSaved(true)
      router.refresh()
    }
  }

  return (
    <div className="space-y-4">
      {/* Show/hide toggle — controls client dashboard visibility only */}
      <label className="flex items-center gap-3 cursor-pointer">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => toggleEnabled(!enabled)}
          className="relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none"
          style={{ background: enabled ? 'var(--blue)' : 'var(--bg-muted)' }}
        >
          <span
            className="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform"
            style={{ transform: enabled ? 'translateX(1rem)' : 'translateX(0)' }}
          />
        </button>
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {enabled ? 'Visible on client dashboard' : 'Hidden from client dashboard'}
        </span>
      </label>

      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Leave blank to use the global default. These values are used in the admin health cards regardless of visibility.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
            Target ROAS <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>— global: {globalDefaults.benchmark_roas}</span>
          </label>
          <input type="number" step="0.1" min="0" className="input"
            value={roas}
            onChange={e => { setRoas(e.target.value); setSaved(false) }}
            placeholder={String(globalDefaults.benchmark_roas)}
          />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
            Target CPC ($) <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>— global: ${globalDefaults.benchmark_cpc}</span>
          </label>
          <input type="number" step="0.01" min="0" className="input"
            value={cpc}
            onChange={e => { setCpc(e.target.value); setSaved(false) }}
            placeholder={String(globalDefaults.benchmark_cpc)}
          />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
            Target CTR (%) <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>— global: {parseFloat((globalDefaults.benchmark_ctr * 100).toFixed(2))}%</span>
          </label>
          <input type="number" step="0.1" min="0" max="100" className="input"
            value={ctr}
            onChange={e => { setCtr(e.target.value); setSaved(false) }}
            placeholder={String(parseFloat((globalDefaults.benchmark_ctr * 100).toFixed(2)))}
          />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
            Target Conv. Rate (%) <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>— global: {parseFloat((globalDefaults.benchmark_conv_rate * 100).toFixed(2))}%</span>
          </label>
          <input type="number" step="0.1" min="0" max="100" className="input"
            value={convRate}
            onChange={e => { setConvRate(e.target.value); setSaved(false) }}
            placeholder={String(parseFloat((globalDefaults.benchmark_conv_rate * 100).toFixed(2)))}
          />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
            Target CPM ($) <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>— global: ${globalDefaults.benchmark_cpm}</span>
          </label>
          <input type="number" step="0.01" min="0" className="input"
            value={cpm}
            onChange={e => { setCpm(e.target.value); setSaved(false) }}
            placeholder={String(globalDefaults.benchmark_cpm)}
          />
        </div>
      </div>

      {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}

      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={saving} className="btn btn-primary">
          {saving ? 'Saving…' : 'Save Benchmarks'}
        </button>
        <button onClick={handleReset} disabled={saving} className="btn btn-secondary">
          Reset to Global
        </button>
        {saved && <span className="text-xs" style={{ color: 'var(--green)' }}>Saved ✓</span>}
      </div>
    </div>
  )
}
