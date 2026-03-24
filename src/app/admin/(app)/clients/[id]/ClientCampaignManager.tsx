'use client'

import { useEffect, useState, useCallback } from 'react'

interface CampaignRow {
  id: string
  source: string
  campaign_id: string
  campaign_name: string
  display_mode: string
  conversion_label: string | null
  hidden: boolean
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export default function ClientCampaignManager({ clientId }: { clientId: string }) {
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({})

  useEffect(() => {
    fetch(`/api/admin/clients/${clientId}/campaigns`)
      .then(r => r.json())
      .then(d => { setCampaigns(d.campaigns ?? []); setLoading(false) })
      .catch(() => { setError('Failed to load campaigns'); setLoading(false) })
  }, [clientId])

  const update = useCallback(async (
    source: string,
    campaign_id: string,
    patch: Partial<Pick<CampaignRow, 'display_mode' | 'hidden'>>
  ) => {
    const key = `${source}:${campaign_id}`
    setSaveState(s => ({ ...s, [key]: 'saving' }))

    // Optimistic update
    setCampaigns(prev => prev.map(c =>
      c.source === source && c.campaign_id === campaign_id ? { ...c, ...patch } : c
    ))

    try {
      const res = await fetch(`/api/admin/clients/${clientId}/campaigns`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, campaign_id, ...patch }),
      })
      if (!res.ok) throw new Error('Save failed')
      setSaveState(s => ({ ...s, [key]: 'saved' }))
      setTimeout(() => setSaveState(s => ({ ...s, [key]: 'idle' })), 1500)
    } catch {
      setSaveState(s => ({ ...s, [key]: 'error' }))
      // Revert optimistic update on error
      setCampaigns(prev => prev.map(c =>
        c.source === source && c.campaign_id === campaign_id ? { ...c, ...Object.fromEntries(Object.entries(patch).map(([k]) => [k, c[k as keyof CampaignRow]])) } : c
      ))
    }
  }, [clientId])

  if (loading) return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading campaigns…</p>
  if (error)   return <p className="text-sm" style={{ color: 'var(--red)' }}>{error}</p>
  if (campaigns.length === 0) return (
    <p className="text-xs py-3 px-4 rounded" style={{
      background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)', color: 'var(--text-faint)',
    }}>
      No campaigns discovered yet — run a sync to populate this list.
    </p>
  )

  const googleCampaigns = campaigns.filter(c => c.source === 'google_ads')
  const metaCampaigns   = campaigns.filter(c => c.source === 'meta_ads')

  return (
    <div className="space-y-5">
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Set the display mode and visibility for each campaign. Ecom campaigns show ROAS and revenue; Lead Gen campaigns show CPL and conversions. Hidden campaigns are excluded from the client dashboard.
      </p>

      {[
        { label: 'Google Ads', rows: googleCampaigns, color: '#4285F4' },
        { label: 'Meta Ads',   rows: metaCampaigns,   color: '#0081FB' },
      ].map(group => group.rows.length > 0 && (
        <div key={group.label}>
          <p className="text-xs font-semibold mb-2" style={{ color: group.color }}>{group.label}</p>
          <div className="overflow-x-auto">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '0.375rem 0.5rem', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Campaign</th>
                  <th style={{ textAlign: 'center', padding: '0.375rem 0.5rem', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', width: 180 }}>Display Mode</th>
                  <th style={{ textAlign: 'center', padding: '0.375rem 0.5rem', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', width: 80 }}>Visible</th>
                  <th style={{ width: 32 }} />
                </tr>
              </thead>
              <tbody>
                {group.rows.map(c => {
                  const key   = `${c.source}:${c.campaign_id}`
                  const state = saveState[key] ?? 'idle'
                  return (
                    <tr key={key} style={{ borderBottom: '1px solid var(--border-subtle)', opacity: c.hidden ? 0.5 : 1 }}>
                      <td style={{ padding: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)', maxWidth: 300 }}>
                        <span title={c.campaign_name} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.campaign_name}
                        </span>
                      </td>
                      <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                        <ModeToggle
                          value={c.display_mode}
                          onChange={mode => update(c.source, c.campaign_id, { display_mode: mode })}
                        />
                      </td>
                      <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                        <VisibilityToggle
                          visible={!c.hidden}
                          onChange={v => update(c.source, c.campaign_id, { hidden: !v })}
                        />
                      </td>
                      <td style={{ padding: '0.5rem', width: 32, textAlign: 'center' }}>
                        {state === 'saving' && <span style={{ fontSize: '0.65rem', color: 'var(--text-faint)' }}>…</span>}
                        {state === 'saved'  && <span style={{ fontSize: '0.75rem', color: 'var(--green)' }}>✓</span>}
                        {state === 'error'  && <span style={{ fontSize: '0.75rem', color: 'var(--red)' }}>✗</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

function ModeToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'inline-flex', borderRadius: 6, border: '1px solid var(--border)', overflow: 'hidden', fontSize: '0.75rem' }}>
      {(['lead_gen', 'ecommerce'] as const).map(mode => {
        const active = value === mode
        return (
          <button
            key={mode}
            onClick={() => onChange(mode)}
            style={{
              padding: '0.2rem 0.6rem',
              border: 'none',
              cursor: 'pointer',
              fontWeight: active ? 600 : 400,
              background:  active ? (mode === 'ecommerce' ? 'var(--blue)' : '#16a34a') : 'transparent',
              color:       active ? '#fff' : 'var(--text-muted)',
              transition:  'all 0.12s',
            }}
          >
            {mode === 'lead_gen' ? 'Lead Gen' : 'Ecom'}
          </button>
        )
      })}
    </div>
  )
}

function VisibilityToggle({ visible, onChange }: { visible: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!visible)}
      title={visible ? 'Click to hide from dashboard' : 'Click to show in dashboard'}
      style={{
        width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
        background: visible ? 'var(--blue)' : 'var(--border)',
        position: 'relative', transition: 'background 0.15s',
        flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: visible ? 18 : 2,
        width: 16, height: 16, borderRadius: 8,
        background: '#fff', transition: 'left 0.15s',
        boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
      }} />
    </button>
  )
}
