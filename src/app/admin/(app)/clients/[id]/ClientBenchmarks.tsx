'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle } from '@phosphor-icons/react'
import Switch from '@/components/ui/Switch'

const ALL_BENCHMARK_KEYS = ['roas', 'ctr', 'cpc', 'conv_rate', 'cpm', 'cpl'] as const
type BenchmarkKey = typeof ALL_BENCHMARK_KEYS[number]

interface Props {
  clientId: string
  showBenchmarks: boolean
  globalDefaults: {
    benchmark_roas:      number
    benchmark_ctr:       number
    benchmark_cpc:       number
    benchmark_conv_rate: number
    benchmark_cpm:       number
    benchmark_cpl:       number
  }
  current: {
    benchmark_roas?:      number | null
    benchmark_ctr?:       number | null
    benchmark_cpc?:       number | null
    benchmark_conv_rate?: number | null
    benchmark_cpm?:       number | null
    benchmark_cpl?:       number | null
    enabled_benchmarks?:  string[] | null
  }
}

export default function ClientBenchmarks({ clientId, showBenchmarks, globalDefaults, current }: Props) {
  const router = useRouter()

  const [dashVisible, setDashVisible] = useState(showBenchmarks)

  // Which benchmarks are enabled (null = all enabled / not yet configured)
  const [enabled, setEnabled] = useState<Set<BenchmarkKey>>(
    new Set(
      current.enabled_benchmarks
        ? (current.enabled_benchmarks as BenchmarkKey[])
        : [...ALL_BENCHMARK_KEYS]
    )
  )

  // Benchmark value inputs (displayed as user-friendly units)
  const [roas,     setRoas]     = useState(current.benchmark_roas      != null ? String(current.benchmark_roas)                                       : '')
  const [ctr,      setCtr]      = useState(current.benchmark_ctr       != null ? String(parseFloat((current.benchmark_ctr       * 100).toFixed(4)))   : '')
  const [cpc,      setCpc]      = useState(current.benchmark_cpc       != null ? String(current.benchmark_cpc)                                        : '')
  const [convRate, setConvRate] = useState(current.benchmark_conv_rate != null ? String(parseFloat((current.benchmark_conv_rate  * 100).toFixed(4)))  : '')
  const [cpm,      setCpm]      = useState(current.benchmark_cpm       != null ? String(current.benchmark_cpm)                                        : '')
  const [cpl,      setCpl]      = useState(current.benchmark_cpl       != null ? String(current.benchmark_cpl)                                        : '')

  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState('')

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/admin/clients/${clientId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    return res.json()
  }

  async function toggleDashVisible(next: boolean) {
    setDashVisible(next)
    await patch({ show_benchmarks: next })
    router.refresh()
  }

  function toggleBenchmark(key: BenchmarkKey) {
    const next = new Set(enabled)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setEnabled(next)
  }

  async function handleSave() {
    setSaving(true); setSaved(false); setError('')
    const toNum = (v: string) => v.trim() === '' ? null : parseFloat(v)
    const data = await patch({
      benchmark_roas:      toNum(roas),
      benchmark_ctr:       ctr.trim()      === '' ? null : parseFloat(ctr)      / 100,
      benchmark_cpc:       toNum(cpc),
      benchmark_conv_rate: convRate.trim() === '' ? null : parseFloat(convRate) / 100,
      benchmark_cpm:       toNum(cpm),
      benchmark_cpl:       toNum(cpl),
      enabled_benchmarks:  Array.from(enabled),
    })
    setSaving(false)
    if (data.error) setError(data.error)
    else { setSaved(true); router.refresh() }
  }

  async function handleReset() {
    setSaving(true); setSaved(false); setError('')
    const data = await patch({
      benchmark_roas: null, benchmark_ctr: null, benchmark_cpc: null,
      benchmark_conv_rate: null, benchmark_cpm: null, benchmark_cpl: null,
      enabled_benchmarks: null,
    })
    setSaving(false)
    if (data.error) setError(data.error)
    else {
      setRoas(''); setCtr(''); setCpc(''); setConvRate(''); setCpm(''); setCpl('')
      setEnabled(new Set([...ALL_BENCHMARK_KEYS]))
      setSaved(true)
      router.refresh()
    }
  }

  const benchmarkDefs: {
    key: BenchmarkKey
    label: string
    hint: string
    input: React.ReactNode
  }[] = [
    {
      key: 'roas', label: 'Target ROAS', hint: `global: ${globalDefaults.benchmark_roas}x`,
      input: <input type="number" step="0.1" min="0" className="input" value={roas} onChange={e => { setRoas(e.target.value); setSaved(false) }} placeholder={String(globalDefaults.benchmark_roas)} disabled={!enabled.has('roas')} />,
    },
    {
      key: 'cpl', label: 'Target CPA ($)', hint: `global: $${globalDefaults.benchmark_cpl}`,
      input: <input type="number" step="1" min="0" className="input" value={cpl} onChange={e => { setCpl(e.target.value); setSaved(false) }} placeholder={String(globalDefaults.benchmark_cpl)} disabled={!enabled.has('cpl')} />,
    },
    {
      key: 'ctr', label: 'Target CTR (%)', hint: `global: ${parseFloat((globalDefaults.benchmark_ctr * 100).toFixed(2))}%`,
      input: <input type="number" step="0.1" min="0" max="100" className="input" value={ctr} onChange={e => { setCtr(e.target.value); setSaved(false) }} placeholder={String(parseFloat((globalDefaults.benchmark_ctr * 100).toFixed(2)))} disabled={!enabled.has('ctr')} />,
    },
    {
      key: 'conv_rate', label: 'Target Conv. Rate (%)', hint: `global: ${parseFloat((globalDefaults.benchmark_conv_rate * 100).toFixed(2))}%`,
      input: <input type="number" step="0.1" min="0" max="100" className="input" value={convRate} onChange={e => { setConvRate(e.target.value); setSaved(false) }} placeholder={String(parseFloat((globalDefaults.benchmark_conv_rate * 100).toFixed(2)))} disabled={!enabled.has('conv_rate')} />,
    },
    {
      key: 'cpc', label: 'Target CPC ($)', hint: `global: $${globalDefaults.benchmark_cpc}`,
      input: <input type="number" step="0.01" min="0" className="input" value={cpc} onChange={e => { setCpc(e.target.value); setSaved(false) }} placeholder={String(globalDefaults.benchmark_cpc)} disabled={!enabled.has('cpc')} />,
    },
    {
      key: 'cpm', label: 'Target CPM ($)', hint: `global: $${globalDefaults.benchmark_cpm}`,
      input: <input type="number" step="0.01" min="0" className="input" value={cpm} onChange={e => { setCpm(e.target.value); setSaved(false) }} placeholder={String(globalDefaults.benchmark_cpm)} disabled={!enabled.has('cpm')} />,
    },
  ]

  return (
    <div className="space-y-4">
      {/* Dashboard visibility */}
      <Switch
        checked={dashVisible}
        onChange={toggleDashVisible}
        label={dashVisible ? 'Benchmarks show on the client\u2019s dashboard' : 'Benchmarks are hidden from the client\u2019s dashboard'}
      />

      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Turn a benchmark off to hide it from the benchmark panel and the admin health cards. Leave a value blank to use the agency default.
      </p>

      {/* Per-benchmark rows: toggle + label + input */}
      <div className="space-y-3">
        {benchmarkDefs.map(({ key, label, hint, input }) => {
          const isOn = enabled.has(key)
          return (
            <div key={key} className="co-bench-row" data-off={!isOn || undefined}>
              <Switch checked={isOn} onChange={() => toggleBenchmark(key)} label={`Use the ${label} benchmark`} hideLabel />
              <p className="co-bench-label">{label} <span>{hint}</span></p>
              <div className="co-bench-input">{input}</div>
            </div>
          )
        })}
      </div>

      {error && <p className="ui-savefail" role="alert">{error}</p>}

      <div className="ui-saverow">
        <button onClick={handleSave} disabled={saving} className="btn btn-primary">
          {saving ? 'Saving…' : 'Save benchmarks'}
        </button>
        <button onClick={handleReset} disabled={saving} className="btn btn-secondary">
          Use the agency defaults
        </button>
        {saved && <span className="ui-saved" role="status"><CheckCircle size={14} weight="fill" aria-hidden />Saved</span>}
      </div>
    </div>
  )
}
