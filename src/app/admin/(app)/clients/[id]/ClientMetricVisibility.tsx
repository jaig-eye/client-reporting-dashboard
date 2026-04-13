'use client'

import { useState } from 'react'

interface MetricDef { id: string; label: string; desc: string }

const METRIC_GROUPS: { heading: string; metrics: MetricDef[] }[] = [
  {
    heading: 'Paid Ads — Default visible',
    metrics: [
      { id: 'spend',       label: 'Spend',              desc: 'Total ad spend card (Ad Fuel Spend if applicable)' },
      { id: 'leads',       label: 'Leads / Revenue',    desc: 'Lead count (lead gen) or Revenue (ecommerce)' },
      { id: 'cpl',         label: 'CPL',                desc: 'Cost Per Lead metric card (lead gen clients)' },
      { id: 'roas',        label: 'ROAS',               desc: 'Return on Ad Spend card (ecommerce clients)' },
      { id: 'ctr',         label: 'CTR',                desc: 'Click-through rate metric card' },
      { id: 'conv_rate',   label: 'Conversion Rate',    desc: 'Conversion rate metric card' },
      { id: 'cpm',         label: 'CPM',                desc: 'Cost per thousand impressions card' },
      { id: 'daily_chart', label: 'Daily Performance',  desc: 'Daily spend & conversions trend chart' },
      { id: 'campaigns',   label: 'Campaign Breakdown', desc: 'Campaign performance table' },
    ],
  },
  {
    heading: 'Paid Ads — Additional',
    metrics: [
      { id: 'conversions',       label: 'Conversions',         desc: 'Total conversion count card' },
      { id: 'conversion_value',  label: 'Conversion Value',    desc: 'Total conversion revenue (ecommerce clients)' },
      { id: 'impressions',       label: 'Impressions',         desc: 'Total impressions card' },
      { id: 'cpc',               label: 'Avg. CPC',            desc: 'Average cost per click card' },
      { id: 'reach',             label: 'Reach',               desc: 'Unique reach — Meta Ads only' },
      { id: 'frequency',         label: 'Frequency',           desc: 'Avg. impressions per user — Meta Ads only' },
      { id: 'view_through_conv', label: 'View-through Conv.',  desc: 'View-through conversions — Google Ads only' },
    ],
  },
  {
    heading: 'Analytics (GA4)',
    metrics: [
      { id: 'ga4_sessions',    label: 'Sessions',          desc: 'Total GA4 sessions card' },
      { id: 'ga4_users',       label: 'Users',             desc: 'Total GA4 users card' },
      { id: 'ga4_bounce_rate', label: 'Bounce Rate',       desc: 'Average bounce rate from GA4' },
    ],
  },
  {
    heading: 'SEO — Search Console',
    metrics: [
      { id: 'gsc_clicks',       label: 'Organic Clicks',    desc: 'Total GSC clicks card' },
      { id: 'gsc_impressions',  label: 'Impressions',       desc: 'Total GSC impressions card' },
      { id: 'gsc_avg_position', label: 'Avg. Position',     desc: 'Average search ranking position' },
    ],
  },
  {
    heading: 'Google Business Profile',
    metrics: [
      { id: 'gbp_views',          label: 'Profile Views',     desc: 'Total GBP views (Search + Maps)' },
      { id: 'gbp_calls',          label: 'Calls',             desc: 'Call clicks from GBP' },
      { id: 'gbp_website_clicks', label: 'Website Clicks',    desc: 'Website clicks from GBP' },
      { id: 'gbp_reviews_rating', label: 'Avg. Rating',       desc: 'Google review average star rating' },
    ],
  },
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
    <div className="space-y-5">
      {METRIC_GROUPS.map(group => (
        <div key={group.heading}>
          <p
            className="text-xs font-semibold mb-2"
            style={{ color: 'var(--text-faint)', letterSpacing: '0.06em', textTransform: 'uppercase' }}
          >
            {group.heading}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {group.metrics.map(m => {
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
                    transition: 'background 0.15s, color 0.15s, opacity 0.15s, border-color 0.15s',
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
        </div>
      ))}
      {saved && <p className="text-xs mt-2" style={{ color: 'var(--green)' }}>Saved</p>}
    </div>
  )
}
