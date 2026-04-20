// Campaign Categories — /admin/categories
// Agency-level campaign taxonomy management.
// Categories define how campaigns are grouped and how metrics are displayed
// (lead gen → show CPL, ecommerce → show ROAS, awareness → show impressions).

import { createAdminClient } from '@/lib/supabase/server'
import type { CampaignCategory } from '@/lib/types'
import CategoryEditor from './CategoryEditor'

export const dynamic = 'force-dynamic'

export default async function CategoriesPage() {
  const db = createAdminClient()
  const { data } = await db
    .from('campaign_categories')
    .select('*')
    .order('sort_order')
    .order('created_at')

  const categories = (data ?? []) as CampaignCategory[]

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Campaign Categories</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Define how campaigns are classified across all clients. Categories control
            which metrics are highlighted in the dashboard.
          </p>
        </div>
      </div>

      {/* Display mode guide */}
      <div
        className="card p-5 mb-6"
        style={{ background: 'var(--blue-subtle)', border: '1px solid var(--blue-border)' }}
      >
        <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--blue)' }}>
          Display Modes
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {DISPLAY_MODE_GUIDE.map(m => (
            <div key={m.mode}>
              <p className="text-xs font-semibold mb-0.5" style={{ color: 'var(--text-primary)' }}>
                {m.label}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{m.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Category list + editor */}
      <CategoryEditor categories={categories} />
    </div>
  )
}

const DISPLAY_MODE_GUIDE = [
  { mode: 'lead_gen',   label: 'Lead Gen',   desc: 'Shows CPA, conversion count. No ROAS.' },
  { mode: 'ecommerce',  label: 'Ecommerce',  desc: 'Shows ROAS, revenue, purchase count.' },
  { mode: 'awareness',  label: 'Awareness',  desc: 'Shows impressions, CPM, reach, frequency.' },
  { mode: 'engagement', label: 'Engagement', desc: 'Shows clicks, CTR, engagement rate.' },
]
