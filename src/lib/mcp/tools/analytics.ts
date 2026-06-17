import type { SupabaseClient } from '@supabase/supabase-js'
import type { Tool, ToolResult } from '../types'
import { ok, fail, fmt } from '../types'

export const tools: Tool[] = [
  {
    name: 'get_ad_fuel_balance',
    description: 'Get the current Ad Fuel balance and recent ledger entries for a client.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'UUID of the client' },
        limit:     { type: 'number', description: 'Number of recent ledger entries to include (default 20)' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'get_billing_summary',
    description: 'Get Stripe billing summary for a client: customer ID, recent invoices, subscription status.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'UUID of the client' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'list_reports',
    description: 'List monthly reports for a client (or all clients). Returns report id, client, period, and top-level metric snapshot.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Filter by client UUID' },
        limit:     { type: 'number', description: 'Max rows to return (default 12)' },
      },
    },
  },
]

export async function handle(name: string, args: Record<string, unknown>, db: SupabaseClient): Promise<ToolResult> {
  try {
    switch (name) {
      case 'get_ad_fuel_balance': {
        const limit = Math.min(Number(args.limit ?? 20), 100)
        const { data: client, error: cErr } = await db
          .from('clients')
          .select('id, name, stripe_customer_id')
          .eq('id', String(args.client_id))
          .maybeSingle()
        if (cErr) throw cErr
        if (!client) return fail('Client not found')

        const { data: ledger, error: lErr } = await db
          .from('ad_fuel_ledger')
          .select('id, amount, type, description, created_at')
          .eq('client_id', String(args.client_id))
          .order('created_at', { ascending: false })
          .limit(limit)
        if (lErr) throw lErr

        const entries = (ledger ?? []) as { amount: number; type: string }[]
        const balance = entries.reduce((sum, e) => sum + (e.type === 'credit' ? e.amount : -e.amount), 0)

        return ok(fmt({ client, balance_cents: balance, recent_entries: ledger ?? [] }))
      }

      case 'get_billing_summary': {
        const { data: client, error: cErr } = await db
          .from('clients')
          .select('id, name, stripe_customer_id')
          .eq('id', String(args.client_id))
          .maybeSingle()
        if (cErr) throw cErr
        if (!client) return fail('Client not found')
        const c = client as { stripe_customer_id?: string | null }
        if (!c.stripe_customer_id) return ok(fmt({ client, message: 'No Stripe customer ID on record' }))

        const stripeKey = process.env.STRIPE_SECRET_KEY
        if (!stripeKey) return fail('STRIPE_SECRET_KEY not configured on server')

        const res = await fetch(`https://api.stripe.com/v1/invoices?customer=${c.stripe_customer_id}&limit=10`, {
          headers: { Authorization: `Bearer ${stripeKey}` },
        })
        if (!res.ok) return fail(`Stripe API error: ${res.status}`)
        const stripeData = await res.json() as { data: unknown[] }
        return ok(fmt({ client, stripe_customer_id: c.stripe_customer_id, invoices: stripeData.data }))
      }

      case 'list_reports': {
        const limit = Math.min(Number(args.limit ?? 12), 50)
        let q = db
          .from('reports')
          .select('id, client_id, period_start, period_end, created_at')
          .order('period_start', { ascending: false })
          .limit(limit)
        if (args.client_id) q = q.eq('client_id', String(args.client_id))
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
