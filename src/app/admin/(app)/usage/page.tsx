// Usage — what the agency's paid services cost: DataForSEO (keyword research and rank checks) and
// AI (writing, topics, images). Both panels read their own ledgers (dataforseo_usage, ai_usage).

import PageHeader from '@/components/ui/PageHeader'
import DataForSeoUsagePanel from '@/components/admin/DataForSeoUsagePanel'
import AiUsagePanel from '@/components/admin/AiUsagePanel'

export const dynamic = 'force-dynamic'

export default function UsagePage() {
  return (
    <div>
      <PageHeader
        title="Usage"
        description="What keyword research, rank checks and AI writing cost, and what is left of this month's budget."
      />
      <div className="ui-stack">
        <DataForSeoUsagePanel />
        <AiUsagePanel />
      </div>
    </div>
  )
}
