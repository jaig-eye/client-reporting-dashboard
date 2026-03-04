import { createAdminClient } from '@/lib/supabase/server'
import type { MetricConfig } from '@/lib/types'
import MetricMappingEditor from './MetricMappingEditor'

export const dynamic = 'force-dynamic'

interface ClientRow {
  id: string
  name: string
  metric_config: MetricConfig | null
}

export default async function MetricMappingPage() {
  const db = createAdminClient()

  const [settingsResult, metaAccountsResult, clientsResult] = await Promise.all([
    db.from('agency_settings').select('metric_config').single(),
    db.from('ad_accounts')
      .select('available_meta_actions')
      .eq('platform', 'meta')
      .not('available_meta_actions', 'is', null),
    db.from('clients').select('id, name, metric_config').order('name'),
  ])

  const globalConfig: MetricConfig = (settingsResult.data?.metric_config as MetricConfig) ?? {}

  // Aggregate all discovered Meta action types across all accounts
  const discoveredMetaActions = Array.from(new Set(
    (metaAccountsResult.data ?? []).flatMap(a =>
      Array.isArray(a.available_meta_actions) ? a.available_meta_actions as string[] : []
    )
  )).sort()

  const clients = (clientsResult.data ?? []) as ClientRow[]

  return (
    <div className="max-w-2xl">
      <h1 className="text-lg font-semibold text-white mb-1">Metric Mapping</h1>
      <p className="text-sm text-slate-500 mb-6">
        Define how Meta and Google data maps to the metrics shown on client dashboards.
        Standard metrics (Spend, Clicks, Impressions, CTR, CPC, CPM) are automatically
        unified across platforms. Configure the conversion metric below.
      </p>

      <MetricMappingEditor
        globalConfig={globalConfig}
        discoveredMetaActions={discoveredMetaActions}
        clients={clients}
      />
    </div>
  )
}
