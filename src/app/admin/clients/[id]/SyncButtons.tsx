'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function SyncButtons({ clientId }: { clientId: string }) {
  const router = useRouter()
  const [syncing, setSyncing] = useState(false)
  const [result, setResult]   = useState('')
  const [error,  setError]    = useState('')

  async function handleSync(days: number) {
    setSyncing(true)
    setResult('')
    setError('')
    try {
      const res = await fetch('/api/sync/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, days }),
      })
      const data = await res.json()
      if (data.error) {
        setError(data.error)
      } else {
        setResult(`Done — ${data.records} rows synced`)
        router.refresh()
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setSyncing(false)
    }
  }

  const btnCls = 'text-sm border border-[#1e2a40] text-slate-400 hover:text-slate-200 hover:border-[#2a3a54] font-medium px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors'

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => handleSync(30)}  disabled={syncing} className={btnCls}>
          {syncing ? 'Syncing…' : 'Last 30 Days'}
        </button>
        <button onClick={() => handleSync(90)}  disabled={syncing} className={btnCls}>
          {syncing ? 'Syncing…' : 'Last 90 Days'}
        </button>
        <button onClick={() => handleSync(365)} disabled={syncing} className={btnCls}>
          {syncing ? 'Syncing…' : 'Last 365 Days'}
        </button>
      </div>
      {result && <p className="text-xs text-emerald-400">{result}</p>}
      {error  && <p className="text-xs text-red-400">{error}</p>}
      <p className="text-xs text-slate-600">
        Longer ranges may time out on Vercel — run 90-day first, then 365-day if needed.
      </p>
    </div>
  )
}
