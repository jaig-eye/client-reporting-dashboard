import type { SupabaseClient } from '@supabase/supabase-js'
import type { Tool, ToolResult } from '../types'
import { ok, fail, fmt } from '../types'

export const tools: Tool[] = [
  {
    name: 'list_clients',
    description: 'List all clients with id, name, website, status, and created_at. Optionally filter by status.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'inactive', 'trial'], description: 'Filter by client status' },
      },
    },
  },
  {
    name: 'get_client',
    description: 'Get full details for a single client including all columns.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'UUID of the client' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'search_clients',
    description: 'Search clients by name (case-insensitive partial match).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to search for in client names' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_client_content_settings',
    description: 'Get content generation settings for a client (tone, niche, keywords, restrictions, publish time, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'UUID of the client' },
      },
      required: ['client_id'],
    },
  },
]

export async function handle(name: string, args: Record<string, unknown>, db: SupabaseClient): Promise<ToolResult> {
  try {
    switch (name) {
      case 'list_clients': {
        let q = db.from('clients').select('id, name, website, status, created_at').order('name')
        if (args.status) q = q.eq('status', String(args.status))
        const { data, error } = await q
        if (error) throw error
        return ok(fmt(data))
      }

      case 'get_client': {
        const { data, error } = await db
          .from('clients')
          .select('*')
          .eq('id', String(args.client_id))
          .maybeSingle()
        if (error) throw error
        if (!data) return fail('Client not found')
        return ok(fmt(data))
      }

      case 'search_clients': {
        const { data, error } = await db
          .from('clients')
          .select('id, name, website, status, created_at')
          .ilike('name', `%${String(args.query)}%`)
          .order('name')
        if (error) throw error
        return ok(fmt(data))
      }

      case 'get_client_content_settings': {
        const { data, error } = await db
          .from('client_content_settings')
          .select('*')
          .eq('client_id', String(args.client_id))
          .maybeSingle()
        if (error) throw error
        return ok(data ? fmt(data) : 'No content settings configured for this client.')
      }

      default:
        return fail(`Unknown tool: ${name}`)
    }
  } catch (e) {
    return fail(`Error: ${e instanceof Error ? e.message : String(e)}`)
  }
}
