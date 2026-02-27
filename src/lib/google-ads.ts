const API_VERSION = 'v16'
const BASE_URL = `https://googleads.googleapis.com/${API_VERSION}`

export async function refreshGoogleToken(refreshToken: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Google token refresh failed: ${data.error}`)
  return data.access_token as string
}

export async function exchangeGoogleCode(
  code: string
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google/callback`,
      grant_type: 'authorization_code',
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Google code exchange failed: ${data.error}`)
  return data
}

export async function getAccessibleCustomers(accessToken: string): Promise<string[]> {
  const res = await fetch(`${BASE_URL}/customers:listAccessibleCustomers`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': process.env.GOOGLE_DEVELOPER_TOKEN!,
    },
  })
  if (!res.ok) throw new Error(`listAccessibleCustomers failed: ${res.status}`)
  const data = await res.json()
  return ((data.resourceNames || []) as string[]).map((r: string) =>
    r.replace('customers/', '')
  )
}

export async function googleAdsQuery(
  customerId: string,
  query: string,
  accessToken: string
): Promise<Record<string, unknown>[]> {
  const id = customerId.replace(/-/g, '')
  const mccId = (process.env.GOOGLE_MCC_CUSTOMER_ID || id).replace(/-/g, '')
  const res = await fetch(`${BASE_URL}/customers/${id}/googleAds:search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': process.env.GOOGLE_DEVELOPER_TOKEN!,
      'login-customer-id': mccId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google Ads query failed ${res.status}: ${text}`)
  }
  const data = await res.json()
  return (data.results || []) as Record<string, unknown>[]
}

export async function fetchGoogleCampaignMetrics(
  customerId: string,
  accessToken: string,
  dateStart: string,
  dateEnd: string
) {
  const rows = await googleAdsQuery(
    customerId,
    `SELECT
      campaign.id,
      campaign.name,
      segments.date,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.conversions_value,
      metrics.ctr
    FROM campaign
    WHERE campaign.status = 'ENABLED'
      AND segments.date BETWEEN '${dateStart}' AND '${dateEnd}'
    ORDER BY segments.date DESC`,
    accessToken
  )

  return rows.map(row => {
    const campaign = row.campaign as Record<string, unknown>
    const metrics = row.metrics as Record<string, unknown>
    const segments = row.segments as Record<string, unknown>
    const spend = (Number(metrics?.costMicros) || 0) / 1_000_000
    const convValue = Number(metrics?.conversionsValue) || 0
    const conversions = Number(metrics?.conversions) || 0
    const clicks = Number(metrics?.clicks) || 0
    const impressions = Number(metrics?.impressions) || 0
    return {
      campaign_id: String(campaign?.id || ''),
      campaign_name: String(campaign?.name || ''),
      date: String(segments?.date || ''),
      spend,
      impressions,
      clicks,
      conversions,
      conversion_value: convValue,
      roas: spend > 0 ? convValue / spend : 0,
      ctr: Number(metrics?.ctr) || 0,
      cpc: clicks > 0 ? spend / clicks : 0,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    }
  })
}
