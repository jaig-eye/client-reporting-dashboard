'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const CHUNK_DAYS = 30

function buildChunks(days: number): { dateStart: string; dateEnd: string }[] {
  const fmt = (d: Date) => d.toISOString().split('T')[0]
  const toDate = new Date()
  toDate.setDate(toDate.getDate() - 1) // yesterday

  const fromDate = new Date(toDate)
  fromDate.setDate(fromDate.getDate() - (days - 1))

  const chunks: { dateStart: string; dateEnd: string }[] = []
  const cursor = new Date(fromDate)

  while (cursor <= toDate) {
    const chunkEnd = new Date(cursor)
    chunkEnd.setDate(chunkEnd.getDate() + CHUNK_DAYS - 1)
    if (chunkEnd > toDate) chunkEnd.setTime(toDate.getTime())
    chunks.push({ dateStart: fmt(cursor), dateEnd: fmt(chunkEnd) })
    cursor.setDate(cursor.getDate() + CHUNK_DAYS)
  }

  return chunks
}

export default function SyncButtons({ clientId }: { clientId: string }) {
  const router = useRouter()
  const [syncing, setSyncing]   = useState(false)
  const [progress, setProgress] = useState('')
  const [result, setResult]     = useState('')
  const [error, setError]       = useState('')

  async function handleSync(days: number) {
    setSyncing(true)
    setResult('')
    setError('')
    setProgress('')

    const chunks = buildChunks(days)
    let totalRecords = 0

    try {
      for (let i = 0; i < chunks.length; i++) {
        setProgress(chunks.length > 1 ? `Batch ${i + 1} / ${chunks.length}` : 'Syncing…')
        const res = await fetch('/api/sync/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, ...chunks[i] }),
        })
        const data = await res.json()
        if (data.error) throw new Error(data.error)
        totalRecords += data.records || 0
      }
      setResult(`Done — ${totalRecords} rows synced`)
      router.refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setSyncing(false)
      setProgress('')
    }
  }

  const btnCls = 'text-sm border border-[#1e2a40] text-slate-400 hover:text-slate-200 hover:border-[#2a3a54] font-medium px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors'

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => handleSync(30)}  disabled={syncing} className={btnCls}>
          {syncing ? '…' : 'Last 30 Days'}
        </button>
        <button onClick={() => handleSync(90)}  disabled={syncing} className={btnCls}>
          {syncing ? '…' : 'Last 90 Days'}
        </button>
        <button onClick={() => handleSync(365)} disabled={syncing} className={btnCls}>
          {syncing ? '…' : 'Last 365 Days'}
        </button>
      </div>
      {progress && <p className="text-xs text-slate-400">{progress}</p>}
      {result   && <p className="text-xs text-emerald-400">{result}</p>}
      {error    && <p className="text-xs text-red-400">{error}</p>}
      <p className="text-xs text-slate-600">
        Large ranges are split into 30-day batches to avoid timeouts.
      </p>
    </div>
  )
}
