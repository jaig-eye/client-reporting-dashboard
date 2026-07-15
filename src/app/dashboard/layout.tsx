// ─────────────────────────────────────────────────────────────────────────────
// Dashboard Layout
//
// Wraps all /dashboard/** pages with the persistent sidebar navigation.
// Reads the client session to determine which connector types are active.
// If an admin session is also present, renders AdminDashboardBar at the top.
// On IP change (vs last_known_ip), generates an OTP and redirects to /verify.
// ─────────────────────────────────────────────────────────────────────────────

import { Suspense } from 'react'
import { unstable_cache } from 'next/cache'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { getAgencySettings } from '@/lib/agency-settings'
import { isAdminAuthed } from '@/lib/auth'
import { sendEmail } from '@/lib/email'
import crypto from 'crypto'
import type { Metadata } from 'next'

export async function generateMetadata(): Promise<Metadata> {
  try {
    const settings    = await getAgencySettings() as unknown as Record<string, unknown>
    const faviconUrl  = settings?.favicon_url  as string | null | undefined
    const agencyName  = settings?.agency_name  as string | null | undefined
    return {
      title: agencyName ?? 'Dashboard',
      ...(faviconUrl ? { icons: { icon: faviconUrl } } : {}),
    }
  } catch {
    return { title: 'Dashboard' }
  }
}
import type { Client, Connector } from '@/lib/types'
import type { ConnectorType } from '@/lib/types'
import DashboardSidebar from '@/components/DashboardSidebar'
import DashboardNavigationRefresher from '@/components/DashboardNavigationRefresher'
import AdminDashboardBar from '@/components/admin/AdminDashboardBar'

const OTP_TTL_MINUTES = 10

function hashOtp(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex')
}

function generateOtp(): string {
  return String(crypto.randomInt(100000, 999999))
}

// Cache the 6 connector-data COUNT queries per client for 5 minutes.
const getConnectorDataFlags = unstable_cache(
  async (clientId: string) => {
    const db = createAdminClient()
    const [ahrefsCheck, gadsCheck, metaCheck, gbpCheck] = await Promise.all([
      db.from('ahrefs_metrics').select('id',     { count: 'exact', head: true }).eq('client_id', clientId),
      db.from('google_ads_metrics').select('id', { count: 'exact', head: true }).eq('client_id', clientId),
      db.from('meta_ads_metrics').select('id',   { count: 'exact', head: true }).eq('client_id', clientId),
      db.from('gbp_metrics').select('id',        { count: 'exact', head: true }).eq('client_id', clientId),
    ])
    return {
      ahrefs: (ahrefsCheck.count ?? 0) > 0,
      gads:   (gadsCheck.count   ?? 0) > 0,
      meta:   (metaCheck.count   ?? 0) > 0,
      gbp:    (gbpCheck.count    ?? 0) > 0,
    }
  },
  ['dashboard-connector-data-flags'],
  { revalidate: 300 }
)

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore  = await cookies()
  const headerStore  = await headers()
  const db           = createAdminClient()

  const token        = cookieStore.get('client_token')?.value
  const adminSession = cookieStore.get('admin_session')?.value
  const isAdmin      = isAdminAuthed(adminSession)

  let client:  Client | null  = null
  let activeConnectorTypes: ConnectorType[] = []
  let settings: Awaited<ReturnType<typeof getAgencySettings>> | null = null

  if (token) {
    const [clientResult, agencySettings] = await Promise.all([
      db.from('clients').select('*').eq('dashboard_token', token).single(),
      getAgencySettings(),
    ])
    client   = clientResult.data as Client | null
    settings = agencySettings

    // ── IP verification (skip for admins — they bypass the client OTP flow) ──
    if (client && !isAdmin) {
      const currentIp = headerStore.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
      const row = client as unknown as {
        last_known_ip: string | null
        client_otp_hash: string | null
        client_otp_expires_at: string | null
        email?: string | null
      }

      if (!row.last_known_ip) {
        // First visit — record IP and continue normally
        void db.from('clients').update({ last_known_ip: currentIp }).eq('id', client.id)
      } else if (currentIp !== row.last_known_ip && row.email) {
        // IP changed and client has an email — send OTP and redirect to /verify
        const otp       = generateOtp()
        const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString()

        await db.from('clients').update({
          client_otp_hash:       hashOtp(otp),
          client_otp_expires_at: expiresAt,
        }).eq('id', client.id)

        const agencyName = (settings as unknown as Record<string, unknown> | null)?.agency_name as string | null ?? 'Agency Dashboard'

        try {
          await sendEmail({
            to:      row.email,
            subject: `${agencyName} — New location sign-in code`,
            html: `
              <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:400px;margin:0 auto;padding:32px 24px;">
                <h2 style="font-size:18px;font-weight:700;color:#111827;margin:0 0 8px;">New location detected</h2>
                <p style="font-size:14px;color:#6b7280;margin:0 0 24px;">We noticed your dashboard is being accessed from a new location. Enter the code below to verify it's you. It expires in ${OTP_TTL_MINUTES} minutes.</p>
                <div style="background:#f3f4f6;border-radius:8px;padding:20px;text-align:center;letter-spacing:0.2em;font-size:32px;font-weight:700;color:#111827;font-family:monospace;">
                  ${otp}
                </div>
                <p style="font-size:12px;color:#9ca3af;margin:20px 0 0;">If you didn't request this, contact your account manager immediately.</p>
              </div>`,
          })
        } catch (e) {
          console.error('[dashboard-layout] OTP email failed:', e)
        }

        redirect('/verify')
      }
    }

    if (client) {
      const [{ data: connectionsData }, dataFlags] = await Promise.all([
        db.from('client_connections').select('connector:connectors(type)')
          .eq('client_id', client.id).eq('status', 'active'),
        getConnectorDataFlags(client.id),
      ])

      const connectedTypes = (
        (connectionsData ?? []) as unknown as { connector: { type: ConnectorType } | null }[]
      )
        .map(c => c.connector?.type)
        .filter((v): v is ConnectorType => !!v)
        .filter((v, i, arr) => arr.indexOf(v) === i)

      const typesWithData = new Set<string>([
        ...(dataFlags.ahrefs ? ['ahrefs']                  : []),
        ...(dataFlags.gads   ? ['google_ads']              : []),
        ...(dataFlags.meta   ? ['meta_ads']                : []),
        ...(dataFlags.gbp    ? ['google_business_profile'] : []),
      ])

      const metricsGatedTypes = new Set(['ahrefs', 'google_ads', 'meta_ads', 'google_business_profile'])
      activeConnectorTypes = connectedTypes.filter(
        t => !metricsGatedTypes.has(t) || typesWithData.has(t)
      )
    }
  }

  // Apply agency-level connector visibility overrides
  if (settings?.hidden_connector_types?.length) {
    const hidden = new Set(settings.hidden_connector_types)
    activeConnectorTypes = activeConnectorTypes.filter(t => !hidden.has(t))
  }

  // Load admin bar data when admin session is active
  let adminClients: { id: string; name: string; dashboard_token: string }[] = []
  if (isAdmin) {
    const { data } = await db
      .from('clients')
      .select('id, name, dashboard_token')
      .order('name')
    adminClients = (data ?? []) as typeof adminClients
  }

  const rawMode      = isAdmin && cookieStore.get('admin_raw_mode')?.value === '1'
  const brandPrimary = (settings as Record<string, unknown> | null)?.brand_primary as string | null ?? '#2563eb'

  return (
    <>
      {/* Inject agency brand color as CSS variable for client dashboard */}
      <style>{`:root { --accent: ${brandPrimary}; }`}</style>
      <DashboardNavigationRefresher />

      {/* Admin overlay bar — only visible to admins */}
      {isAdmin && client && (
        <Suspense fallback={null}>
          <AdminDashboardBar
            currentClientId={client.id}
            currentClientName={client.name}
            dashboardToken={(client as unknown as Record<string, string>).dashboard_token ?? token ?? ''}
            clients={adminClients}
            rawMode={rawMode}
          />
        </Suspense>
      )}

      <div style={{
        display: 'flex',
        minHeight: '100vh',
        background: 'var(--bg-base)',
        paddingTop: isAdmin && client ? 40 : 0,
      }}>
        {client && (
          <Suspense fallback={<div style={{ width: 220, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--bg-surface)' }} />}>
            <DashboardSidebar
              activeConnectorTypes={activeConnectorTypes}
              agencyLogoUrl={settings?.agency_logo_url}
              agencyName={settings?.agency_name}
              clientLogoUrl={client.logo_url}
              clientName={client.name}
              crmName={settings?.crm_name ?? 'CRM'}
              hasLocalDominator={!!(client as unknown as { local_dominator_url?: string | null }).local_dominator_url}
            />
          </Suspense>
        )}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>
      </div>
    </>
  )
}
