'use client'

import { useState } from 'react'

interface AccountStatus {
  id: string
  client_id: string
  client_name: string
  platform: string
  account_id: string
  account_name: string | null
  row_count: number
}

// Pull 730 days of history, split into 30-day batches so no single
// request exceeds Vercel's function timeout.
const BACKFILL_DAYS = 730
const CHUNK_DAYS = 30

function buildChunks(days: number): { dateStart: string; dateEnd: string }[] {
  const fmt = (d: Date) => d.toISOString().split('T')[0]
  const toDate = new Date()
  toDate.setDate(toDate.getDate() - 1)

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

export default function AgencyBackfill() {
  const [accounts, setAccounts] = useState<AccountStatus[] | null>(null)
  const [loading, setLoading]   = useState(false)
  const [running, setRunning]   = useState(false)
  const [progress, setProgress] = useState('')
  const [done, setDone]         = useState('')
  const [error, setError]       = useState('')

  async function loadStatus() {
    setLoading(true)
    setError('')
    setDone('')
    try {
      const res = await fetch('/api/admin/backfill/status')
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setAccounts(data.accounts)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  async function runBackfill() {
    if (!accounts) return
    const toSync = accounts.filter(a => a.row_count === 0)
    if (!toSync.length) {
      setDone('All accounts already have data — nothing to backfill.')
      return
    }

    setRunning(true)
    setDone('')
    setError('')

    let totalRecords = 0

    try {
      for (let ai = 0; ai < toSync.length; ai++) {
        const account = toSync[ai]
        const chunks = buildChunks(BACKFILL_DAYS)
        const label = `${account.account_name || account.account_id} (${account.platform} · ${account.client_name})`

        for (let ci = 0; ci < chunks.length; ci++) {
          setProgress(
            `Account ${ai + 1}/${toSync.length} · ${label} — Batch ${ci + 1}/${chunks.length}`
          )

          const res = await fetch('/api/sync/trigger', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              clientId:  account.client_id,
              accountId: account.id,
              ...chunks[ci],
            }),
          })
          const data = await res.json()
          if (data.error) throw new Error(`${label}: ${data.error}`)
          totalRecords += data.records || 0
        }
      }

      const n = toSync.length
      setDone(
        `Backfill complete — ${totalRecords.toLocaleString()} rows synced across ${n} account${n !== 1 ? 's' : ''}.`
      )
      // Mark synced accounts as having data so the status reflects reality
      setAccounts(prev =>
        prev
          ? prev.map(a => (toSync.find(t => t.id === a.id) ? { ...a, row_count: 1 } : a))
          : prev
      )
    } catch (e) {
      setError(String(e))
    } finally {
      setRunning(false)
      setProgress('')
    }
  }

  const unsynced = accounts?.filter(a => a.row_count === 0) ?? []
  const synced   = accounts?.filter(a => a.row_count > 0)  ?? []

  const btnOutline =
    'text-sm border border-[#1e2a40] text-slate-400 hover:text-slate-200 hover:border-[#2a3a54] font-medium px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors'

  return (
    <div className="space-y-4">
      {/* Status check */}
      {!accounts && (
        <button onClick={loadStatus} disabled={loading} className={btnOutline}>
          {loading ? 'Checking…' : 'Check Backfill Status'}
        </button>
      )}

      {accounts && (
        <div className="space-y-3">
          <div className="text-xs space-y-1">
            <p>
              <span className="text-emerald-400 font-medium">{synced.length}</span>
              <span className="text-slate-500"> account{synced.length !== 1 ? 's' : ''} already have data — will be skipped.</span>
            </p>
            <p>
              <span className={`font-medium ${unsynced.length ? 'text-amber-400' : 'text-slate-500'}`}>
                {unsynced.length}
              </span>
              <span className="text-slate-500"> account{unsynced.length !== 1 ? 's' : ''} have no historical data — ready to backfill.</span>
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {unsynced.length > 0 && (
              <button
                onClick={runBackfill}
                disabled={running}
                className="text-sm bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {running
                  ? 'Running…'
                  : `Backfill ${unsynced.length} Account${unsynced.length !== 1 ? 's' : ''} (${BACKFILL_DAYS} days)`}
              </button>
            )}
            <button onClick={loadStatus} disabled={loading || running} className={btnOutline}>
              {loading ? 'Refreshing…' : 'Refresh Status'}
            </button>
          </div>

          {progress && <p className="text-xs text-slate-400 font-mono">{progress}</p>}
          {done  && <p className="text-xs text-emerald-400">{done}</p>}
          {error && <p className="text-xs text-red-400">{error}</p>}

          {/* Account list */}
          {accounts.length > 0 && (
            <div className="mt-2 space-y-1">
              {accounts.map(a => (
                <div key={a.id} className="flex items-center gap-2 text-xs">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${a.row_count > 0 ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  <span className="text-slate-400">{a.client_name}</span>
                  <span className="text-slate-600">·</span>
                  <span className="text-slate-500">{a.platform}</span>
                  <span className="text-slate-600">·</span>
                  <span className="text-slate-400 truncate">{a.account_name || a.account_id}</span>
                  <span className={`ml-auto flex-shrink-0 ${a.row_count > 0 ? 'text-emerald-500' : 'text-amber-500'}`}>
                    {a.row_count > 0 ? 'synced' : 'pending'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && !accounts && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
