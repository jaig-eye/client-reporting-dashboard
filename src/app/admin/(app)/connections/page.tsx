// Integrations — /admin/connections
// Every service the agency connects once, grouped by what it's for. Clients then get accounts
// assigned from these on their own Integrations tab.
//
// AI (the writing model and the featured-image key) is here too: it's a connection like the rest,
// and used to be a tab of Agency settings.
//
// Google is one sign-in for four services (Ads, Analytics, Search Console, Business Profile), so it
// shows as one row with the four underneath. Google and Meta sign in through a popup that
// refreshes this page when it finishes; the key-based services connect in a dialog.

import { createAdminClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { GOOGLE_CONNECTOR_TYPES, getConnectorDef } from '@/lib/connectors/registry'
import type { Connector } from '@/lib/types'
import StripeAgencyCard     from '@/components/admin/StripeAgencyCard'
import AhrefsAgencyCard     from '@/components/admin/AhrefsAgencyCard'
import DataForSeoAgencyCard from '@/components/admin/DataForSeoAgencyCard'
import SearchApiAgencyCard  from '@/components/admin/SearchApiAgencyCard'
import AiAgencyCards        from '@/components/admin/AiAgencyCards'
import { resolveDfsCreds }  from '@/lib/connectors/dataforseo'
import type { SeoDevice }   from '@/lib/connectors/dataforseo'
import DiscordAgencyCard    from '@/components/admin/DiscordAgencyCard'
import { SECRET_MASK }      from '@/lib/secretMask'
import GoogleRefreshButton  from '@/components/admin/GoogleRefreshButton'
import PageHeader           from '@/components/ui/PageHeader'
import IntegrationRow, { IntegrationGroup, connectorStatus } from '@/components/admin/integrations/IntegrationRow'
import OAuthConnectButton   from '@/components/admin/integrations/OAuthConnectButton'
import { ChartLineUp, Warning } from '@phosphor-icons/react/dist/ssr'

export const dynamic = 'force-dynamic'

const NOTICES: Record<string, { tone: 'success' | 'danger'; text: string }> = {
  'connected:google':        { tone: 'success', text: 'Google connected. Ads, Analytics, Search Console and Business Profile are active.' },
  'connected:meta':          { tone: 'success', text: 'Meta Ads connected. Its token is good for 60 days.' },
  'error:google_auth_failed': { tone: 'danger', text: 'Google sign-in was cancelled or denied. Try again, and check the Google account can see the data you need.' },
  'error:google_failed':      { tone: 'danger', text: 'Google connection failed. Try again in a minute; if it keeps failing, the function logs for /api/auth/google/callback say why.' },
  'error:google_save_failed': { tone: 'danger', text: 'Google signed in, but the connection couldn’t be saved. Try again.' },
  'error:meta_auth_failed':   { tone: 'danger', text: 'Meta sign-in was cancelled or denied. Try connecting again.' },
  'error:meta_save_failed':   { tone: 'danger', text: 'Meta signed in, but the connection couldn’t be saved. Try again.' },
  'error:meta_failed':        { tone: 'danger', text: 'Meta connection failed. Try again in a minute.' },
}

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>
}) {
  const sp = await searchParams
  const db = createAdminClient()
  const [connectorsRes, agencyRes, aiRes] = await Promise.all([
    db.from('connectors').select('*').order('created_at'),
    db.from('agency_settings')
      .select('stripe_api_key, stripe_webhook_secret, serp_api_key, serp_api_provider, discord_bot_token, discord_ops_channel_id')
      .single(),
    // Its own read, and every column: image_model only exists once migration 227 has run, and naming
    // it in the select above would fail the whole query on a database without it.
    db.from('agency_settings').select('*').maybeSingle(),
  ])
  const ai = aiRes.data as {
    ai_provider?: string | null; ai_model?: string | null; ai_api_key?: string | null
    openai_api_key?: string | null; image_model?: string | null
  } | null
  const existing = (connectorsRes.data ?? []) as Connector[]
  const agencySettings = agencyRes.data as {
    stripe_api_key?: string; stripe_webhook_secret?: string
    serp_api_key?: string; serp_api_provider?: string
    discord_bot_token?: string; discord_ops_channel_id?: string
  } | null

  // Ahrefs connector (if any). Only ever expose WHETHER a key is set, never the key:
  // AhrefsAgencyCard is a client component, so its props are serialized into the RSC
  // flight payload embedded in this page's HTML. The agency_settings secrets a few
  // lines below are masked for exactly this reason.
  const ahrefsConnector = existing.find(c => c.type === 'ahrefs')
  const ahrefsHasKey    = !!String((ahrefsConnector?.auth as Record<string, unknown> | undefined)?.api_key ?? '')

  // DataForSEO connector (if any)
  const dfsConnector = existing.find(c => c.type === 'dataforseo')
  const dfsAuth      = (dfsConnector?.auth as Record<string, unknown> | undefined) ?? {}
  const dfsConfig    = (dfsConnector?.config as Record<string, unknown> | undefined) ?? {}
  // Must match resolveDfsCreds exactly (login AND password, or a decodable api_key; env fills
  // gaps). A login-only save is NOT usable.
  const dfsHasCreds  = resolveDfsCreds(dfsAuth) !== null
  const dfsDevices   = Array.isArray(dfsConfig.devices) ? (dfsConfig.devices as SeoDevice[]) : undefined
  const dfsDepth     = typeof dfsConfig.rank_depth === 'number' ? dfsConfig.rank_depth : undefined

  const byType = new Map(existing.map(c => [c.type, c]))

  const googleConns = GOOGLE_CONNECTOR_TYPES.map(t => byType.get(t)).filter(Boolean) as Connector[]
  const googleActive = googleConns.filter(c => c.status === 'active').length
  const googleStatus =
    googleConns.length === 0 ? { tone: 'neutral' as const, label: 'Not connected' }
    : googleActive === GOOGLE_CONNECTOR_TYPES.length ? { tone: 'success' as const, label: 'Connected' }
    : { tone: 'warning' as const, label: `${googleActive} of ${GOOGLE_CONNECTOR_TYPES.length} working` }

  const meta = byType.get('meta_ads')
  const metaExpires = (meta?.auth as Record<string, unknown> | undefined)?.token_expires_at as string | undefined
  const metaDaysLeft = metaExpires ? Math.round((new Date(metaExpires).getTime() - Date.now()) / 86_400_000) : null

  const notice = NOTICES[sp.connected ? `connected:${sp.connected}` : `error:${sp.error}`]

  return (
    <div>
      <PageHeader
        title="Integrations"
        description="Connect each service once for the agency. Then assign accounts to each client on the client's Integrations tab."
      />

      {notice && <div className={`ui-notice ui-notice--${notice.tone}`} role={notice.tone === 'danger' ? 'alert' : 'status'}>{notice.text}</div>}

      <IntegrationGroup id="int-ads" title="Ads and analytics" description="Where spend, results and traffic come from.">
        <IntegrationRow
          brand="google"
          name="Google"
          status={googleStatus}
          description="One sign-in covers Ads, Analytics, Search Console and Business Profile."
          actions={googleConns.length === 0
            ? <Link href="/admin/connections/new?type=google" className="btn btn-primary btn-sm">Connect Google</Link>
            : <>
                <GoogleRefreshButton />
                <OAuthConnectButton href="/api/auth/google/start" label="Reconnect" variant="secondary" size="sm" provider="Google" />
              </>}
        >
          {googleConns.length > 0 && GOOGLE_CONNECTOR_TYPES.map(type => {
            const connector = byType.get(type)
            const def = getConnectorDef(type)
            const missingDevToken = type === 'google_ads' && connector && !((connector.auth as Record<string, unknown>)?.developer_token)
            return (
              <IntegrationRow
                key={type}
                sub
                brand={type}
                name={def.label}
                status={connectorStatus(connector?.status)}
                warning={missingDevToken ? <><Warning size={13} weight="fill" aria-hidden />No developer token, so Google Ads data won’t sync. Add one in Manage.</> : undefined}
                actions={connector ? <Link href={`/admin/connections/${connector.id}`} className="btn btn-ghost btn-sm">Manage</Link> : undefined}
              />
            )
          })}
        </IntegrationRow>

        <IntegrationRow
          brand="meta_ads"
          name="Meta Ads"
          status={meta ? connectorStatus(meta.status) : null}
          description="Facebook and Instagram campaigns, through a system user token or a Meta sign-in."
          meta={meta && metaDaysLeft !== null
            ? (metaDaysLeft > 0 ? `Token good for ${metaDaysLeft} more days` : 'Token expired')
            : undefined}
          warning={metaDaysLeft !== null && metaDaysLeft <= 10 ? <><Warning size={13} weight="fill" aria-hidden />{metaDaysLeft > 0 ? 'The token expires soon. Reconnect to renew it.' : 'The token has expired, so Meta data isn’t syncing. Reconnect.'}</> : undefined}
          actions={meta
            ? <>
                <OAuthConnectButton href="/api/auth/meta/start" label="Reconnect" variant="secondary" size="sm" provider="Meta" />
                <Link href={`/admin/connections/${meta.id}`} className="btn btn-ghost btn-sm">Manage</Link>
              </>
            : <Link href="/admin/connections/new?type=meta_ads" className="btn btn-primary btn-sm">Connect Meta</Link>}
        />
      </IntegrationGroup>

      <IntegrationGroup id="int-ai" title="AI" description="The models that write posts and draw their featured images.">
        <AiAgencyCards
          initialProvider={ai?.ai_provider ?? 'anthropic'}
          initialModel={ai?.ai_model ?? ''}
          initialAiKey={ai?.ai_api_key ? SECRET_MASK : ''}
          initialImageKey={ai?.openai_api_key ? SECRET_MASK : ''}
          initialImageModel={ai?.image_model ?? null}
        />
        <IntegrationRow
          sub
          logo={<span className="ui-tile ui-tile--sm ui-tile--accent" aria-hidden><ChartLineUp size={15} /></span>}
          name="AI spend"
          description="What writing and images cost, by client, task and model."
          actions={<Link href="/admin/usage" className="btn btn-ghost btn-sm">Open Usage</Link>}
        />
      </IntegrationGroup>

      <IntegrationGroup id="int-seo" title="SEO data" description="Rankings, keyword research and competitor pages for the content tool.">
        <AhrefsAgencyCard initialApiKey={ahrefsHasKey ? SECRET_MASK : ''} connectorId={ahrefsConnector?.id} />
        <DataForSeoAgencyCard
          connectorId={dfsConnector?.id}
          connected={dfsConnector?.status === 'active'}
          hasCreds={dfsHasCreds}
          initialDepth={dfsDepth}
          initialDevices={dfsDevices}
        />
        {dfsHasCreds && (
          <IntegrationRow
            sub
            logo={<span className="ui-tile ui-tile--sm ui-tile--accent" aria-hidden><ChartLineUp size={15} /></span>}
            name="DataForSEO spend and monthly limit"
            description="On the Usage page, with AI spend."
            actions={<Link href="/admin/usage" className="btn btn-ghost btn-sm">Open Usage</Link>}
          />
        )}
        <SearchApiAgencyCard
          initialApiKey={agencySettings?.serp_api_key ? SECRET_MASK : ''}
          initialProvider={agencySettings?.serp_api_provider ?? 'serpapi'}
        />
      </IntegrationGroup>

      <IntegrationGroup id="int-ops" title="Notifications and billing" description="Where the agency hears about problems, and where invoices come from.">
        <DiscordAgencyCard
          initialBotToken={agencySettings?.discord_bot_token ? SECRET_MASK : ''}
          initialOpsChannelId={agencySettings?.discord_ops_channel_id ?? ''}
        />
        <StripeAgencyCard
          initialApiKey={agencySettings?.stripe_api_key ? SECRET_MASK : ''}
          initialWebhookSecret={agencySettings?.stripe_webhook_secret ? SECRET_MASK : ''}
        />
      </IntegrationGroup>
    </div>
  )
}
