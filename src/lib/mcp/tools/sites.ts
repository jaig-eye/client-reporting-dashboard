import type { SupabaseClient } from '@supabase/supabase-js'
import type { Tool, ToolResult } from '../types'
import { ok, fail, fmt } from '../types'

export const tools: Tool[] = [
  {
    name: 'list_sites',
    description: 'List monitored sites. Returns id, client_id, url, name, is_up (last known status), and check_interval.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Filter by client UUID' },
      },
    },
  },
  {
    name: 'get_site',
    description: 'Get full details for a site including recent uptime check history (last 10 checks).',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'UUID of the site' },
      },
      required: ['site_id'],
    },
  },
  {
    name: 'list_incidents',
    description: 'List site downtime incidents, optionally filtered by site or open-only (no ended_at).',
    inputSchema: {
      type: 'object',
      properties: {
        site_id:   { type: 'string', description: 'Filter by site UUID' },
        open_only: { type: 'boolean', description: 'Only return open incidents (no ended_at)' },
        limit:     { type: 'number', description: 'Max rows to return (default 50)' },
      },
    },
  },
]

export async function handle(name: string, args: Record<string, unknown>, db: SupabaseClient): Promise<ToolResult> {
  try {
    switch (name) {
      case 'list_sites': {
        let q = db
          .from('sites')
          .select('id, client_id, url, name, is_monitored, check_interval, created_at')
          .order('url')
        if (args.client_id) q = q.eq('client_id', String(args.client_id))
        const { data, error } = await q
        if (error) throw error
        return ok(fmt(data))
      }

      case 'get_site': {
        const { data: site, error } = await db
          .from('sites')
          .select('*')
          .eq('id', String(args.site_id))
          .maybeSingle()
        if (error) throw error
        if (!site) return fail('Site not found')
        const { data: checks } = await db
          .from('site_checks')
          .select('checked_at, is_up, response_time_ms, status_code')
          .eq('site_id', String(args.site_id))
          .order('checked_at', { ascending: false })
          .limit(10)
        const { data: openIncident } = await db
          .from('site_incidents')
          .select('id, started_at, cause')
          .eq('site_id', String(args.site_id))
          .is('ended_at', null)
          .maybeSingle()
        return ok(fmt({ ...site as Record<string, unknown>, recent_checks: checks ?? [], open_incident: openIncident ?? null }))
      }

      case 'list_incidents': {
        const limit = Math.min(Number(args.limit ?? 50), 200)
        let q = db
          .from('site_incidents')
          .select('id, site_id, started_at, ended_at, cause')
          .order('started_at', { ascending: false })
          .limit(limit)
        if (args.site_id)   q = q.eq('site_id', String(args.site_id))
        if (args.open_only) q = q.is('ended_at', null)
        const { data, error } = await q
        if (error) throw error
        return ok(fmt(data))
      }

      default:
        return fail(`Unknown tool: ${name}`)
    }
  } catch (e) {
    return fail(`Error: ${e instanceof Error ? e.message : String(e)}`)
  }
}
