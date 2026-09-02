import type { SupabaseClient } from '@supabase/supabase-js'
import type { Tool, ToolResult } from '../types'
import { ok, fail, fmt } from '../types'
import { maskSecrets } from '@/lib/secretMask'

export const tools: Tool[] = [
  {
    name: 'get_agency_settings',
    description: 'Get agency-level configuration: AI provider, models, feature flags, and integration settings (tokens are redacted).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'list_cron_logs',
    description: 'List recent cron job execution logs with status, duration, and error details.',
    inputSchema: {
      type: 'object',
      properties: {
        job_name: { type: 'string', description: 'Filter by job name' },
        limit:    { type: 'number', description: 'Max rows (default 20)' },
      },
    },
  },
  {
    name: 'get_system_stats',
    description: 'Get dashboard-wide counts: clients, topics by status, posts by status, sites, active silos, open incidents.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
]

// Hand-maintained name lists drift away from the schema. This one had: only TWO of
// its nine entries were real columns of agency_settings ('stripe_secret_key' is not
// one — the column is stripe_api_key), so select('*') returned ai_api_key,
// stripe_api_key, stripe_webhook_secret, serp_api_key and both Meta tokens in
// cleartext through an MCP token, which is precisely the leak the settings REST
// route was fixed to close. Drive it off the SHARED SECRET_FIELDS constant instead,
// so a credential column added to the masking list is covered here automatically.
const LEGACY_REDACTED_KEYS = new Set([
  'anthropic_api_key', 'stripe_secret_key', 'google_client_secret',
  'meta_app_secret', 'wp_app_password', 'app_password', 'cron_secret',
])

// Never leaves the server under any circumstances. super_admin_otp_hash is an
// UNSALTED SHA-256 of six digits — trivially reversed offline — so exposing it lets
// the holder of any MCP token complete super-admin 2FA without the emailed code.
// It is dropped rather than masked because no caller has a reason to see it exists.
const NEVER_EXPOSE = new Set(['super_admin_otp_hash', 'super_admin_otp_expires_at'])

function redact(obj: Record<string, unknown>): Record<string, unknown> {
  const masked = maskSecrets(obj)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(masked)) {
    if (NEVER_EXPOSE.has(k)) continue
    out[k] = LEGACY_REDACTED_KEYS.has(k) ? '[redacted]' : v
  }
  return out
}

export async function handle(name: string, args: Record<string, unknown>, db: SupabaseClient): Promise<ToolResult> {
  try {
    switch (name) {
      case 'get_agency_settings': {
        const { data, error } = await db.from('agency_settings').select('*').maybeSingle()
        if (error) throw error
        if (!data) return ok('No agency settings found')
        return ok(fmt(redact(data as Record<string, unknown>)))
      }

      case 'list_cron_logs': {
        const limit = Math.min(Number(args.limit ?? 20), 100)
        let q = db
          .from('cron_logs')
          .select('id, job_name, started_at, finished_at, status, error, meta')
          .order('started_at', { ascending: false })
          .limit(limit)
        if (args.job_name) q = q.eq('job_name', String(args.job_name))
        const { data, error } = await q
        if (error) throw error
        return ok(fmt(data))
      }

      case 'get_system_stats': {
        // Use count:exact + head:false to get per-status breakdowns without fetching all rows.
        // sites and incidents only need a count so head:true is sufficient there.
        const [clientsRes, topicsRes, postsRes, silosRes, sitesRes, monitoredRes, incidentsRes] = await Promise.all([
          db.from('clients').select('status', { count: 'exact' }).neq('status', 'deleted'),
          db.from('content_topics').select('status', { count: 'exact' }),
          db.from('content_posts').select('status', { count: 'exact' }),
          // content_silos requires migration 149 — silently returns 0 if table absent
          db.from('content_silos').select('*', { count: 'exact', head: true }).neq('status', 'archived').then(r => r.error ? { count: 0, data: null, error: null } : r),
          db.from('sites').select('*', { count: 'exact', head: true }),
          db.from('sites').select('*', { count: 'exact', head: true }).eq('is_monitored', true),
          db.from('site_incidents').select('*', { count: 'exact', head: true }).is('ended_at', null),
        ])

        const countBy = (rows: { [k: string]: unknown }[], key: string) => {
          const counts: Record<string, number> = {}
          for (const r of rows) {
            const v = String(r[key] ?? 'unknown')
            counts[v] = (counts[v] ?? 0) + 1
          }
          return counts
        }

        return ok(fmt({
          clients:        { total: clientsRes.count ?? 0, by_status: countBy((clientsRes.data ?? []) as { status: string }[], 'status') },
          content_topics: { total: topicsRes.count ?? 0,  by_status: countBy((topicsRes.data ?? []) as { status: string }[], 'status') },
          content_posts:  { total: postsRes.count ?? 0,   by_status: countBy((postsRes.data ?? []) as { status: string }[], 'status') },
          silos:          { active: silosRes.count ?? 0 },
          sites:          { total: sitesRes.count ?? 0, monitored: monitoredRes.count ?? 0 },
          open_incidents: incidentsRes.count ?? 0,
        }))
      }

      default:
        return fail(`Unknown tool: ${name}`)
    }
  } catch (e) {
    return fail(`Error: ${e instanceof Error ? e.message : String(e)}`)
  }
}
