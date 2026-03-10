'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  clientId: string
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

export default function ClientBenchmarks({ clientId, globalDefaults, current }: Props) {
  const router = useRouter()

  // CTR and conv_rate are stored as decimals (0.03 = 3%), displayed as percentages
  const [roas,     setRoas]     = useState(current.benchmark_roas     != null ? String(current.benchmark_roas)                                       : '')
  const [ctr,      setCtr]      = useState(current.benchmark_ctr      != null ? String(parseFloat((current.benchmark_ctr      * 100).toFixed(4)))    : '')
  const [cpc,      setCpc]      = useState(current.benchmark_cpc      != null ? String(current.benchmark_cpc)                                       : '')
  const [convRate, setConvRate] = useState(current.benchmark_conv_rate != null ? String(parseFloat((current.benchmark_conv_rate * 100).toFixed(4))) : '')
  const [cpm,      setCpm]      = useState(current.benchmark_cpm      != null ? String(current.benchmark_cpm)                                       : '')

  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState('')

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    setError('')

    const toNum = (v: string) => v.trim() === '' ? null : parseFloat(v)
    const body = {
      benchmark_roas:        toNum(roas),
      benchmark_ctr:         ctr.trim()      === '' ? null : parseFloat(ctr)      / 100,
      benchmark_cpc:         toNum(cpc),
      benchmark_conv_rate:   convRate.trim() === '' ? null : parseFloat(convRate) / 100,
      benchmark_cpm:         toNum(cpm),
    }

    const res = await fetch(`/api/admin/clients/${clientId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    setSaving(false)
    if (data.error) {
      setError(data.error)
    } else {
      setSaved(true)
      router.refresh()
    }
  }

  async function handleReset() {
    setSaving(true)
    setSaved(false)
    setError('')
    const res = await fetch(`/api/admin/clients/${clientId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        benchmark_roas: null, benchmark_ctr: null, benchmark_cpc: null,
        benchmark_conv_rate: null, benchmark_cpm: null,
      }),
    })
    const data = await res.json()
    setSaving(false)
    if (data.error) {
      setError(data.error)
    } else {
      setRoas(''); setCtr(''); setCpc(''); setConvRate(''); setCpm('')
      setSaved(true)
      router.refresh()
    }
  }

  const inputCls =
    'w-full bg-[#080c18] border border-[#1e2a40] text-slate-200 placeholder-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors'

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Leave blank to use the global default. Overrides apply only to this client&apos;s dashboard.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">
            Target ROAS <span className="text-slate-600 font-normal">— global: {globalDefaults.benchmark_roas}</span>
          </label>
          <input type="number" step="0.1" min="0" value={roas}
            onChange={e => { setRoas(e.target.value); setSaved(false) }}
            placeholder={String(globalDefaults.benchmark_roas)}
            className={inputCls}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">
            Target CPC ($) <span className="text-slate-600 font-normal">— global: ${globalDefaults.benchmark_cpc}</span>
          </label>
          <input type="number" step="0.01" min="0" value={cpc}
            onChange={e => { setCpc(e.target.value); setSaved(false) }}
            placeholder={String(globalDefaults.benchmark_cpc)}
            className={inputCls}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">
            Target CTR (%) <span className="text-slate-600 font-normal">— global: {parseFloat((globalDefaults.benchmark_ctr * 100).toFixed(2))}%</span>
          </label>
          <input type="number" step="0.1" min="0" max="100" value={ctr}
            onChange={e => { setCtr(e.target.value); setSaved(false) }}
            placeholder={String(parseFloat((globalDefaults.benchmark_ctr * 100).toFixed(2)))}
            className={inputCls}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">
            Target Conv. Rate (%) <span className="text-slate-600 font-normal">— global: {parseFloat((globalDefaults.benchmark_conv_rate * 100).toFixed(2))}%</span>
          </label>
          <input type="number" step="0.1" min="0" max="100" value={convRate}
            onChange={e => { setConvRate(e.target.value); setSaved(false) }}
            placeholder={String(parseFloat((globalDefaults.benchmark_conv_rate * 100).toFixed(2)))}
            className={inputCls}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">
            Target CPM ($) <span className="text-slate-600 font-normal">— global: ${globalDefaults.benchmark_cpm}</span>
          </label>
          <input type="number" step="0.01" min="0" value={cpm}
            onChange={e => { setCpm(e.target.value); setSaved(false) }}
            placeholder={String(globalDefaults.benchmark_cpm)}
            className={inputCls}
          />
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={handleReset}
          disabled={saving}
          className="border border-[#1e2a40] text-slate-400 hover:text-slate-300 hover:border-[#2a3a54] text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors"
        >
          Reset to Global
        </button>
        {saved && <span className="text-xs text-emerald-400">Saved</span>}
      </div>
    </div>
  )
}
