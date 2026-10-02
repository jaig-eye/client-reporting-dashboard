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

  return <CategoryEditor categories={(data ?? []) as CampaignCategory[]} />
}
