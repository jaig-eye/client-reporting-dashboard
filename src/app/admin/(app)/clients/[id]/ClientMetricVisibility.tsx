'use client'

import { useState } from 'react'

const METRICS: { id: string; label: string; desc: string }[] = [
  { id: 'spend',       label: 'Spend',              desc: 'Total ad spend card (Ad Fuel Spend if applicable)' },
  { id: 'leads',       label: 'Leads / Revenue',    desc: 'Lead count (lead gen) or Revenue (ecommerce)' },
  { id: 'cpl',         label: 'CPL / ROAS',         desc: 'Cost Per Lead (lead gen) or ROAS (ecommerce)' },
  { id: 'ctr',         label: 'CTR',                desc: 'Click-through rate metric card' },
  { id: 'conv_rate',   label: 'Conversion Rate',    desc: 'Conversion rate metric card' },
  { id: 'cpm',         label: 'CPM',                desc: 'Cost per thousand impressions card' },
  { id: 'daily_chart', label: 'Daily Performance',  desc: 'Daily spend & conversions trend chart' },
  { id: 'campaigns',   label: 'Campaign Breakdown', desc: 'Campaign performance table' },
]

export default function ClientMetricVisibility({
  clientId,
  initialHidden,
}: {
  clientId: string
  initialHidden: string[]
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set(initialHidden))
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)

  async function save(next: Set<string>) {
    setSaving(true)
    setSaved(false)
    await fetch(`/api/admin/clients/${clientId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ hidden_metrics: Array.from(next) }),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function toggle(id: string) {
    const next = new Set(hidden)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setHidden(next)
    save(next)
  }

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {METRICS.map(m => {
          const isVisible = !hidden.has(m.id)
          return (
            <button
              key={m.id}
              onClick={() => toggle(m.id)}
              disabled={saving}
              style={{
                display:    'flex',
                alignItems: 'center',
                gap:        '0.625rem',
                padding:    '0.625rem 0.875rem',
                borderRadius: '0.5rem',
                border:     '1px solid var(--border)',
                background: isVisible ? 'var(--bg-surface)' : 'var(--bg-subtle)',
                textAlign:  'left',
                cursor:     saving ? 'not-allowed' : 'pointer',
                opacity:    saving ? 0.6 : 1,
                transition: 'all 0.15s',
              }}
            >
              {/* Toggle pill */}
              <div style={{ width: 32, height: 18, borderRadius: 9999, background: isVisible ? 'var(--blue)' : 'var(--border)', position: 'relative', flexShrink: 0, transition: 'background 0.15s' }}>
                <div style={{ position: 'absolute', top: 2, left: isVisible ? 16 : 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)', marginBottom: 1 }}>{m.label}</p>
                <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{m.desc}</p>
              </div>
              <span className="text-xs font-medium" style={{ color: isVisible ? 'var(--green)' : 'var(--text-muted)', flexShrink: 0 }}>
                {isVisible ? 'Visible' : 'Hidden'}
              </span>
            </button>
          )
        })}
      </div>
      {saved && <p className="text-xs mt-3" style={{ color: 'var(--green)' }}>Saved</p>}
    </div>
  )
}
