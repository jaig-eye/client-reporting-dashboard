'use client'

import { useState } from 'react'
import { fmt$, fmtNum } from '@/lib/metrics'

interface RawGoogleRow {
  campaign_id: string
  campaign_name: string
  campaign_type: string | null
  date: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  conversions_value: number
  view_through_conversions: number
  roas: number
  ctr: number
  cpc: number
  cpm: number
}

interface RawMetaRow {
  campaign_id: string
  campaign_name: string
  objective: string | null
  date: string
  spend: number
  impressions: number
  clicks: number
  reach: number
  frequency: number
  conversions: number
  conversion_value: number
  roas: number
  ctr: number
  cpc: number
  cpm: number
  actions: { action_type: string; value: string }[]
  discovered_actions: string[]
}

export default function ClientRawData({ clientId }: { clientId: string }) {
  const [source, setSource] = useState<'google_ads' | 'meta_ads'>('google_ads')
  const [rows, setRows] = useState<(RawGoogleRow | RawMetaRow)[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [limit, setLimit] = useState(100)

  async function loadData() {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/raw-data?source=${source}&limit=${limit}`)
      const data = await res.json()
      setRows(data.rows ?? [])
      setLoaded(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          {(['google_ads', 'meta_ads'] as const).map(s => (
            <button
              key={s}
              onClick={() => { setSource(s); setLoaded(false); setRows([]) }}
              className="text-xs px-3 py-1.5 font-medium"
              style={{
                background: source === s ? 'var(--blue)' : 'var(--bg-surface)',
                color:      source === s ? 'white' : 'var(--text-muted)',
                border:     'none', cursor: 'pointer',
              }}
            >
              {s === 'google_ads' ? 'Google Ads' : 'Meta Ads'}
            </button>
          ))}
        </div>

        <select
          value={limit}
          onChange={e => { setLimit(Number(e.target.value)); setLoaded(false) }}
          className="input"
          style={{ width: 'auto', fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}
        >
          {[50, 100, 500, 1000].map(n => (
            <option key={n} value={n}>Last {n} rows</option>
          ))}
        </select>

        <button
          onClick={loadData}
          disabled={loading}
          className="btn btn-primary"
          style={{ fontSize: '0.8rem', padding: '0.375rem 0.75rem' }}
        >
          {loading ? 'Loading…' : 'Load Data'}
        </button>

        {loaded && (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {rows.length} rows
          </span>
        )}
      </div>

      {loaded && rows.length === 0 && (
        <p className="text-sm py-4" style={{ color: 'var(--text-muted)' }}>No data found for this client.</p>
      )}

      {loaded && rows.length > 0 && source === 'google_ads' && (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ minWidth: 900, fontSize: '0.75rem' }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Campaign</th>
                <th>Type</th>
                <th style={{ textAlign: 'right' }}>Spend</th>
                <th style={{ textAlign: 'right' }}>Impr.</th>
                <th style={{ textAlign: 'right' }}>Clicks</th>
                <th style={{ textAlign: 'right' }}>Conv.</th>
                <th style={{ textAlign: 'right' }}>Conv. Value</th>
                <th style={{ textAlign: 'right' }}>VTC</th>
                <th style={{ textAlign: 'right' }}>ROAS</th>
                <th style={{ textAlign: 'right' }}>CTR</th>
                <th style={{ textAlign: 'right' }}>CPC</th>
                <th style={{ textAlign: 'right' }}>CPM</th>
              </tr>
            </thead>
            <tbody>
              {(rows as RawGoogleRow[]).map((r, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: 'nowrap', color: 'var(--text-faint)' }}>{r.date}</td>
                  <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.campaign_name}
                  </td>
                  <td style={{ color: 'var(--text-faint)' }}>{r.campaign_type ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>{fmt$(r.spend)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtNum(r.impressions)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtNum(r.clicks)}</td>
                  <td style={{ textAlign: 'right' }}>{r.conversions > 0 ? r.conversions.toFixed(2) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{r.conversions_value > 0 ? fmt$(r.conversions_value) : '—'}</td>
                  <td style={{ textAlign: 'right', color: 'var(--text-faint)' }}>
                    {r.view_through_conversions > 0 ? r.view_through_conversions : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>{r.roas > 0 ? r.roas.toFixed(2) : '—'}</td>
                  <td style={{ textAlign: 'right', color: 'var(--text-faint)' }}>
                    {(r.ctr * 100).toFixed(2)}%
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--text-faint)' }}>
                    {r.cpc > 0 ? fmt$(r.cpc) : '—'}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--text-faint)' }}>
                    {r.cpm > 0 ? fmt$(r.cpm) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loaded && rows.length > 0 && source === 'meta_ads' && (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ minWidth: 1100, fontSize: '0.75rem' }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Campaign</th>
                <th>Objective</th>
                <th style={{ textAlign: 'right' }}>Spend</th>
                <th style={{ textAlign: 'right' }}>Reach</th>
                <th style={{ textAlign: 'right' }}>Impr.</th>
                <th style={{ textAlign: 'right' }}>Freq.</th>
                <th style={{ textAlign: 'right' }}>Clicks</th>
                <th style={{ textAlign: 'right' }}>Conv.</th>
                <th style={{ textAlign: 'right' }}>Conv. Value</th>
                <th style={{ textAlign: 'right' }}>ROAS</th>
                <th style={{ textAlign: 'right' }}>CTR</th>
                <th>Action Types</th>
              </tr>
            </thead>
            <tbody>
              {(rows as RawMetaRow[]).map((r, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: 'nowrap', color: 'var(--text-faint)' }}>{r.date}</td>
                  <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.campaign_name}
                  </td>
                  <td style={{ color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>{r.objective ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>{fmt$(r.spend)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtNum(r.reach)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtNum(r.impressions)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--text-faint)' }}>{r.frequency.toFixed(2)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtNum(r.clicks)}</td>
                  <td style={{ textAlign: 'right' }}>{r.conversions > 0 ? r.conversions.toFixed(2) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{r.conversion_value > 0 ? fmt$(r.conversion_value) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{r.roas > 0 ? r.roas.toFixed(2) : '—'}</td>
                  <td style={{ textAlign: 'right', color: 'var(--text-faint)' }}>
                    {(r.ctr * 100).toFixed(2)}%
                  </td>
                  <td style={{ maxWidth: 200 }}>
                    {r.actions?.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {r.actions.map((a, j) => (
                          <span key={j} style={{
                            fontSize: 10, padding: '1px 5px', borderRadius: 3,
                            background: 'var(--bg-subtle)', color: 'var(--text-muted)',
                            border: '1px solid var(--border-subtle)',
                          }}>
                            {a.action_type}: {a.value}
                          </span>
                        ))}
                      </div>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
