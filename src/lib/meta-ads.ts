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

export async function fetchMetaCampaignMetrics(
  accountId: string,
  accessToken: string,
  dateStart: string,
  dateEnd: string
) {
  // Single account-level insights call with level=campaign — one request for all
  // campaigns' daily data instead of N+1 per-campaign calls. Pages if needed.
  //
  // Uses the `results` field — Meta's campaign-objective primary metric (what Ads
  // Manager shows as the "Results" column). This avoids summing all
  // offsite_conversion.* subtypes (view content, add to cart, checkout, etc.)
  // which inflated conversion counts 10-100x.
  // CPL (cost per result) is derived dynamically from spend/results in summarizeMetrics.
  const rows_out = []

  const base = new URL(`${BASE_URL}/${accountId}/insights`)
  base.searchParams.set('access_token', accessToken)
  base.searchParams.set('level', 'campaign')
  base.searchParams.set('fields', 'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpm,results')
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
      const spend       = parseFloat(String(day.spend       || '0'))
      const impressions = parseInt(  String(day.impressions || '0'))
      const clicks      = parseInt(  String(day.clicks      || '0'))
      const ctr         = parseFloat(String(day.ctr         || '0'))
      const cpm         = parseFloat(String(day.cpm         || '0'))

      // Meta returns `results` as [{action_type, value}] or as a plain number.
      const rawResults = day.results
      let resultCount = 0
      if (Array.isArray(rawResults)) {
        resultCount = (rawResults as Record<string, unknown>[])
          .reduce((s, r) => s + parseFloat(String(r.value || '0')), 0)
      } else if (rawResults !== undefined && rawResults !== null) {
        resultCount = parseFloat(String(rawResults))
      }

      rows_out.push({
        campaign_id:      String(day.campaign_id   || ''),
        campaign_name:    String(day.campaign_name || ''),
        date:             String(day.date_start    || ''),
        spend,
        impressions,
        clicks,
        conversions:      resultCount,
        conversion_value: 0,  // no revenue tracking; CPL = spend/results via summarizeMetrics
        roas:             0,  // not applicable for lead-gen Meta campaigns
        ctr:              ctr / 100,
        cpc:              clicks > 0 ? spend / clicks : 0,
        cpm,
      })
    }

    const paging = data.paging as Record<string, unknown> | undefined
    nextUrl = (paging?.next as string) || null
  }

  return rows_out
}
