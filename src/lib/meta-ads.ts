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
  code: string
): Promise<{ access_token: string }> {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID!,
    client_secret: process.env.META_APP_SECRET!,
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/meta/callback`,
    code,
  })
  const res = await fetch(
    `${BASE_URL}/oauth/access_token?${params}`
  )
  const data = await res.json() as Record<string, unknown>
  if (data.error) throw new Error(`Meta code exchange failed`)

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

export async function fetchMetaCampaignMetrics(
  accountId: string,
  accessToken: string,
  dateStart: string,
  dateEnd: string
) {
  // Get campaigns
  const campData = await metaGet(`/${accountId}/campaigns`, accessToken, {
    fields: 'id,name,status',
    effective_status: '["ACTIVE","PAUSED"]',
    limit: '100',
  })
  const campaigns = (campData.data || []) as Record<string, unknown>[]
  const results = []

  for (const campaign of campaigns) {
    const campaignId = String(campaign.id)
    const campaignName = String(campaign.name || '')

    // Get daily breakdown insights
    const insightsData = await metaGet(`/${campaignId}/insights`, accessToken, {
      fields: 'spend,impressions,clicks,ctr,cpm,actions,action_values',
      time_range: JSON.stringify({ since: dateStart, until: dateEnd }),
      time_increment: '1', // daily breakdown
      limit: '90',
    })

    const insights = (insightsData.data || []) as Record<string, unknown>[]
    for (const day of insights) {
      const spend = parseFloat(String(day.spend || '0'))
      const impressions = parseInt(String(day.impressions || '0'))
      const clicks = parseInt(String(day.clicks || '0'))
      const ctr = parseFloat(String(day.ctr || '0'))
      const cpm = parseFloat(String(day.cpm || '0'))
      const actions = (day.actions || []) as Record<string, unknown>[]
      const actionValues = (day.action_values || []) as Record<string, unknown>[]

      const conversions = actions
        .filter(a => {
          const t = String(a.action_type || '')
          return t.startsWith('offsite_conversion') || t === 'lead'
        })
        .reduce((s, a) => s + parseInt(String(a.value || '0')), 0)

      const conversionValue = actionValues
        .filter(a => String(a.action_type || '').startsWith('offsite_conversion'))
        .reduce((s, a) => s + parseFloat(String(a.value || '0')), 0)

      results.push({
        campaign_id: campaignId,
        campaign_name: campaignName,
        date: String(day.date_start || ''),
        spend,
        impressions,
        clicks,
        conversions,
        conversion_value: conversionValue,
        roas: spend > 0 ? conversionValue / spend : 0,
        ctr: ctr / 100,
        cpc: clicks > 0 ? spend / clicks : 0,
        cpm,
      })
    }
  }
  return results
}
