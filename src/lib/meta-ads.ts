const API_VERSION = 'v18.0'
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`

async function metaGet(
  path: string,
  accessToken: string,
  params: Record<string, string> = {}
): Promise<Record<string, unknown>> {
  const url = new URL(`${BASE_URL}${path}`)
  url.searchParams.set('access_token', accessToken)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString())
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Meta API error ${res.status}: ${text}`)
  }
  return res.json() as Promise<Record<string, unknown>>
}

export async function exchangeMetaCode(
  code: string,
  redirectUri: string
): Promise<{ access_token: string }> {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID!,
    client_secret: process.env.META_APP_SECRET!,
    redirect_uri: redirectUri,
    code,
  })
  const res = await fetch(
    `${BASE_URL}/oauth/access_token?${params}`
  )
  const data = await res.json() as Record<string, unknown>
  if (data.error) throw new Error(`Meta code exchange failed: ${JSON.stringify(data.error)}`)

  // Exchange for long-lived token (60-day)
  const llParams = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: process.env.META_APP_ID!,
    client_secret: process.env.META_APP_SECRET!,
    fb_exchange_token: String(data.access_token),
  })
  const llRes = await fetch(`${BASE_URL}/oauth/access_token?${llParams}`)
  const llData = await llRes.json() as Record<string, unknown>
  return { access_token: String(llData.access_token || data.access_token) }
}

export async function getMetaAdAccounts(
  accessToken: string
): Promise<{ id: string; name: string }[]> {
  const data = await metaGet('/me/adaccounts', accessToken, {
    fields: 'id,name,account_status',
  })
  return ((data.data || []) as Record<string, unknown>[]).map(a => ({
    id: String(a.id),
    name: String(a.name || ''),
  }))
}

/**
 * Fetch all ad accounts accessible to a System User token.
 * A Meta System User covers all accounts assigned in Business Manager —
 * one token for the whole agency, no OAuth per client needed.
 */
export async function fetchAllBMAdAccounts(
  systemUserToken: string
): Promise<{ id: string; name: string }[]> {
  const data = await metaGet('/me/adaccounts', systemUserToken, {
    fields: 'id,name,account_status',
    limit: '200',
  })
  return ((data.data || []) as Record<string, unknown>[]).map(a => ({
    id: String(a.id),
    name: String(a.name || ''),
  }))
}

/**
 * Fetch campaign-level daily metrics from Meta.
 *
 * @param conversionAction - Which action_type to count as conversions.
 *   'results' (default) uses Meta's campaign-primary "Results" field.
 *   Any other value (e.g. 'lead', 'offsite_conversion.fb_pixel_purchase')
 *   filters the `actions` array to that specific type only.
 *
 * Always requests `actions` for discovery — all unique action_types seen
 * are returned so the admin UI can show them as dropdown options.
 */
export async function fetchMetaCampaignMetrics(
  accountId: string,
  accessToken: string,
  dateStart: string,
  dateEnd: string,
  conversionAction = 'results'
): Promise<{ rows: MetaMetricRow[]; discoveredActions: string[] }> {
  const rows_out: MetaMetricRow[] = []
  const discoveredActionTypes = new Set<string>()

  const base = new URL(`${BASE_URL}/${accountId}/insights`)
  base.searchParams.set('access_token', accessToken)
  base.searchParams.set('level', 'campaign')
  // Always fetch `actions` for discovery + specific action filtering.
  // `results` is also fetched as the default when conversionAction === 'results'.
  base.searchParams.set('fields', 'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpm,results,actions,action_values')
  base.searchParams.set('time_range', JSON.stringify({ since: dateStart, until: dateEnd }))
  base.searchParams.set('time_increment', '1')
  base.searchParams.set('limit', '500')

  let nextUrl: string | null = base.toString()

  while (nextUrl) {
    const res = await fetch(nextUrl)
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Meta API error ${res.status}: ${text}`)
    }
    const data = await res.json() as Record<string, unknown>
    const rows = (data.data || []) as Record<string, unknown>[]

    for (const day of rows) {
      const actions      = (day.actions       || []) as Record<string, unknown>[]
      const actionValues = (day.action_values || []) as Record<string, unknown>[]

      // Build a revenue map from action_values (monetary value per action_type)
      const revenueByType = new Map<string, number>()
      for (const av of actionValues) {
        const t = String(av.action_type || '')
        if (t) revenueByType.set(t, parseFloat(String(av.value || '0')))
      }

      // Accumulate all seen action types for discovery
      for (const a of actions) {
        const t = String(a.action_type || '')
        if (t) discoveredActionTypes.add(t)
      }

      const spend       = parseFloat(String(day.spend       || '0'))
      const impressions = parseInt(  String(day.impressions || '0'))
      const clicks      = parseInt(  String(day.clicks      || '0'))
      const ctr         = parseFloat(String(day.ctr         || '0'))
      const cpm         = parseFloat(String(day.cpm         || '0'))

      let resultCount = 0
      let conversionRevenue = 0

      if (conversionAction === 'results') {
        // Use Meta's campaign-primary "Results" field (objective-specific)
        const rawResults = day.results
        if (Array.isArray(rawResults)) {
          resultCount = (rawResults as Record<string, unknown>[])
            .reduce((s, r) => s + parseFloat(String(r.value || '0')), 0)
        } else if (rawResults !== undefined && rawResults !== null) {
          resultCount = parseFloat(String(rawResults))
        }
        // Revenue not available via results field
      } else {
        // Filter actions to the admin-configured action_type
        resultCount = actions
          .filter(a => String(a.action_type) === conversionAction)
          .reduce((s, a) => s + parseFloat(String(a.value || '0')), 0)
        // Revenue for this action (e.g. purchase value for ROAS)
        conversionRevenue = revenueByType.get(conversionAction) || 0
      }

      rows_out.push({
        campaign_id:      String(day.campaign_id   || ''),
        campaign_name:    String(day.campaign_name || ''),
        date:             String(day.date_start    || ''),
        spend,
        impressions,
        clicks,
        conversions:      resultCount,
        conversion_value: conversionRevenue,
        roas:             spend > 0 && conversionRevenue > 0 ? conversionRevenue / spend : 0,
        ctr:              ctr / 100,
        cpc:              clicks > 0 ? spend / clicks : 0,
        cpm,
        // Raw actions stored so the admin can remap without re-syncing.
        // Each entry includes count (value) and revenue (from action_values).
        rawActions: actions.map(a => ({
          action_type: String(a.action_type || ''),
          value:       String(a.value       || '0'),
          revenue:     String(revenueByType.get(String(a.action_type || '')) || '0'),
        })),
      })
    }

    const paging = data.paging as Record<string, unknown> | undefined
    nextUrl = (paging?.next as string) || null
  }

  return { rows: rows_out, discoveredActions: Array.from(discoveredActionTypes) }
}

interface MetaMetricRow {
  campaign_id: string
  campaign_name: string
  date: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  conversion_value: number
  roas: number
  ctr: number
  cpc: number
  cpm: number
  rawActions: { action_type: string; value: string; revenue: string }[]
}
