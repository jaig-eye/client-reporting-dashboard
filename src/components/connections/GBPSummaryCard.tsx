// GBP Summary Card — shown on the dashboard cockpit when google_business_profile is connected.
// Displays business views, calls, direction requests, and website clicks.

import { createAdminClient } from '@/lib/supabase/server'
import ConnectionSummaryCard from './ConnectionSummaryCard'
import { MapPin } from '@phosphor-icons/react/dist/ssr'

function fmtNum(n: number) { return n.toLocaleString() }

interface Props {
  clientId: string
  connectionId: string
  dateFrom: string
  dateTo: string
}

export default async function GBPSummaryCard({ clientId, connectionId, dateFrom, dateTo }: Props) {
  const db = createAdminClient()

  const { data: rows } = await db
    .from('gbp_metrics')
    .select('views, calls, direction_requests, website_clicks')
    .eq('client_id', clientId)
    .eq('connection_id', connectionId)
    .gte('date', dateFrom)
    .lte('date', dateTo)

  const data = rows ?? []
  const hasData = data.length > 0

  const totViews      = data.reduce((s, r) => s + (r.views ?? 0), 0)
  const totCalls      = data.reduce((s, r) => s + (r.calls ?? 0), 0)
  const totDirections = data.reduce((s, r) => s + (r.direction_requests ?? 0), 0)
  const totWebClicks  = data.reduce((s, r) => s + (r.website_clicks ?? 0), 0)

  const metrics = [
    { label: 'Profile Views',       value: fmtNum(totViews)      },
    { label: 'Calls',               value: fmtNum(totCalls)      },
    { label: 'Direction Requests',  value: fmtNum(totDirections) },
    { label: 'Website Clicks',      value: fmtNum(totWebClicks)  },
  ]

  return (
    <ConnectionSummaryCard
      title="Business Profile"
      icon={<MapPin size={18} />}
      accentColor="#4285f4"
      href="/dashboard/seo/gbp"
      hasData={hasData}
    >
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '1rem',
      }}>
        {metrics.map(m => (
          <div key={m.label}>
            <p className="metric-label mb-1">{m.label}</p>
            <p style={{
              fontSize: '1.25rem', fontWeight: 700,
              color: 'var(--text-primary)',
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-0.01em',
            }}>
              {m.value}
            </p>
          </div>
        ))}
      </div>
    </ConnectionSummaryCard>
  )
}
