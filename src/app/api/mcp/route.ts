// Dashboard MCP Server — Streamable HTTP transport
// Exposes 23 tools covering clients, content, silos, sites, analytics, and agency settings.
// Auth: Bearer token via DASHBOARD_MCP_SECRET env var.
// Add this server to .mcp.json — it is already committed to the repo for team sharing.

export const runtime  = 'nodejs'
export const dynamic  = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createHash }                from 'crypto'
import { allTools, dispatch }        from '@/lib/mcp/registry'
import { createAdminClient }         from '@/lib/supabase/server'
import { timingSafeCompare }         from '@/lib/auth'

type JRpcReq = {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: unknown
}
type JRpcRes = {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string }
}

function rpcOk(id: string | number | null, result: unknown): JRpcRes {
  return { jsonrpc: '2.0', id, result }
}

function rpcErr(id: string | number | null, code: number, message: string): JRpcRes {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

async function isAuthed(req: NextRequest): Promise<boolean> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return false
  const token = authHeader.slice(7)
  if (!token) return false

  // Env var fallback — for super admin / local dev without a DB token
  const envSecret = process.env.DASHBOARD_MCP_SECRET
  if (timingSafeCompare(token, envSecret)) return true

  // Per-user DB token — team members generate these from /admin/users/me
  if (!token.startsWith('mcp_')) return false
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const db = createAdminClient()
  const { data } = await db
    .from('mcp_tokens')
    .select('id, user_id, created_at')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .maybeSingle()

  if (!data?.id) return false

  // revoked_at alone is not enough. Nothing anywhere sets it except the manual
  // /admin/mcp-tokens/[id] DELETE, so force-resetting or deactivating an account
  // left its bearer tokens fully live — and these are long-lived credentials that
  // reach all 23 tools through the service-role client. Apply the SAME revocation
  // rules the cookie sessions get, with the token's created_at standing in for a
  // session's iat.
  const row = data as { id: string; user_id: string | null; created_at: string | null }
  if (row.user_id) {
    const cols = 'is_active'
    let owner = await db.from('users').select(`${cols}, password_changed_at`)
      .eq('id', row.user_id).maybeSingle()
    // Deploy-order fallback: password_changed_at only exists from migration 195.
    if (owner.error && /password_changed_at/i.test(owner.error.message)) {
      owner = await db.from('users').select(cols).eq('id', row.user_id).maybeSingle()
    }
    const user = owner.data as { is_active?: boolean; password_changed_at?: string | null } | null
    if (!user || user.is_active === false) return false

    if (user.password_changed_at && row.created_at) {
      const changed = new Date(user.password_changed_at).getTime()
      const minted  = new Date(row.created_at).getTime()
      if (Number.isFinite(changed) && Number.isFinite(minted) && minted < changed) return false
    }
  }

  // AWAIT the stamp. An un-awaited supabase-js builder is a lazy thenable: it
  // issues no HTTP request at all, so `void db.from(...).update(...)` never wrote
  // last_used_at and the column has been silently null for every token. Fire it
  // without blocking the response but with a real subscription to the promise.
  void db.from('mcp_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', row.id)
    .then(({ error }) => { if (error) console.error('[mcp] last_used_at update failed:', error.message) })

  return true
}

async function handleOne(req: JRpcReq): Promise<JRpcRes | null> {
  const id = req.id ?? null

  switch (req.method) {
    case 'initialize':
      return rpcOk(id, {
        protocolVersion: '2024-11-05',
        capabilities:    { tools: {} },
        serverInfo:      { name: 'dashboard', version: '1.0.0' },
      })

    case 'ping':
      return rpcOk(id, {})

    case 'tools/list':
      return rpcOk(id, { tools: allTools })

    case 'tools/call': {
      const p = req.params as { name: string; arguments?: Record<string, unknown> }
      if (!p?.name) return rpcErr(id, -32602, 'tools/call requires params.name')
      const result = await dispatch(p.name, p.arguments ?? {})
      return rpcOk(id, result)
    }

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null  // notifications have no response

    default:
      return id !== null ? rpcErr(id, -32601, `Method not found: ${req.method}`) : null
  }
}

export async function POST(request: NextRequest) {
  if (!await isAuthed(request)) {
    return NextResponse.json(rpcErr(null, -32000, 'Unauthorized'), { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(rpcErr(null, -32700, 'Parse error: invalid JSON'), { status: 400 })
  }

  if (Array.isArray(body)) {
    const results = (await Promise.all((body as JRpcReq[]).map(handleOne))).filter(Boolean)
    return NextResponse.json(results)
  }

  const result = await handleOne(body as JRpcReq)
  if (result === null) return new NextResponse(null, { status: 204 })
  return NextResponse.json(result)
}

// Discovery endpoint — lets Claude Code inspect server info without auth
export async function GET() {
  return NextResponse.json({
    name:        'dashboard',
    version:     '1.0.0',
    description: 'Client Reporting Dashboard — admin MCP server',
    tool_count:  allTools.length,
    tools:       allTools.map(t => ({ name: t.name, description: t.description })),
  })
}
