'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface UnlinkedAccount {
  id: string
  account_id: string
  account_name?: string | null
  platform: string
}

interface MappedAccount {
  id: string
  account_id: string
  account_name?: string | null
  platform: string
}

interface Props {
  clientId: string
  unlinkedGoogle: UnlinkedAccount[]
  unlinkedMeta: UnlinkedAccount[]
  mappedGoogle: MappedAccount[]
  mappedMeta: MappedAccount[]
}

export default function AccountMapper({
  clientId, unlinkedGoogle, unlinkedMeta, mappedGoogle, mappedMeta,
}: Props) {
  return (
    <div className="space-y-3">
      <PlatformMapper
        label="Google Ads"
        platform="google"
        clientId={clientId}
        unlinked={unlinkedGoogle}
        mapped={mappedGoogle}
        accentCls="bg-blue-600 hover:bg-blue-500"
      />
      <PlatformMapper
        label="Meta Ads"
        platform="meta"
        clientId={clientId}
        unlinked={unlinkedMeta}
        mapped={mappedMeta}
        accentCls="bg-indigo-600 hover:bg-indigo-500"
      />
    </div>
  )
}

function PlatformMapper({
  label, platform, clientId, unlinked, mapped, accentCls,
}: {
  label: string
  platform: string
  clientId: string
  unlinked: UnlinkedAccount[]
  mapped: MappedAccount[]
  accentCls: string
}) {
  const router = useRouter()
  const [selectedId, setSelectedId] = useState('')
  const [manualId, setManualId]     = useState('')
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState('')

  async function handleMap() {
    const payload = selectedId
      ? { ad_account_id: selectedId, client_id: clientId }
      : { account_id: manualId.trim(), platform, client_id: clientId }

    if (!selectedId && !manualId.trim()) return

    setLoading(true)
    setError('')
    const res = await fetch('/api/admin/accounts/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json()
    setLoading(false)
    if (data.error) {
      setError(data.error)
    } else {
      setSelectedId('')
      setManualId('')
      if (data.backfill === 'run_mcc_script') {
        setError('Mapped. Run the MCC script with IS_BACKFILL: true to pull historical data.')
      }
      router.refresh()
    }
  }

  const isConnected = mapped.length > 0

  return (
    <div className="p-3 bg-[#080c18] border border-[#1e2a40] rounded-lg">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-200">{label}</p>
          {mapped.length > 0 ? (
            mapped.map(a => (
              <p key={a.id} className="text-xs text-emerald-400 truncate">
                {a.account_name || a.account_id}
              </p>
            ))
          ) : (
            <p className="text-xs text-slate-600">Not mapped</p>
          )}
          {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Dropdown of discovered accounts OR manual ID input */}
          {unlinked.length > 0 ? (
            <select
              value={selectedId}
              onChange={e => setSelectedId(e.target.value)}
              className="text-xs bg-[#0f1525] border border-[#1e2a40] text-slate-300 rounded px-2 py-1.5 focus:outline-none focus:border-blue-500 max-w-[180px]"
            >
              <option value="">Select account…</option>
              {unlinked.map(a => (
                <option key={a.id} value={a.id}>
                  {a.account_name || a.account_id}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={manualId}
              onChange={e => setManualId(e.target.value)}
              placeholder="Account ID"
              className="text-xs bg-[#0f1525] border border-[#1e2a40] text-slate-300 placeholder-slate-600 rounded px-2 py-1.5 w-32 focus:outline-none focus:border-blue-500"
            />
          )}

          <button
            onClick={handleMap}
            disabled={loading || (!selectedId && !manualId.trim())}
            className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 ${
              isConnected
                ? 'border border-[#1e2a40] text-slate-400 hover:border-[#2a3a54] hover:text-slate-300'
                : `${accentCls} text-white`
            }`}
          >
            {loading ? '…' : isConnected ? 'Add' : 'Map'}
          </button>
        </div>
      </div>

      {/* If unlinked accounts exist AND admin wants to type manually, show toggle */}
      {unlinked.length > 0 && !selectedId && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-slate-600">or enter manually:</span>
          <input
            value={manualId}
            onChange={e => setManualId(e.target.value)}
            placeholder="Account ID"
            className="text-xs bg-[#0f1525] border border-[#1e2a40] text-slate-300 placeholder-slate-600 rounded px-2 py-1 w-32 focus:outline-none focus:border-blue-500"
          />
        </div>
      )}
    </div>
  )
}
