// Dashboard MCP Server — Streamable HTTP transport
// Exposes 23 tools covering clients, content, silos, sites, analytics, and agency settings.
// Auth: Bearer token via DASHBOARD_MCP_SECRET env var.
// Add this server to .mcp.json — it is already committed to the repo for team sharing.

export const runtime  = 'nodejs'
export const dynamic  = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { allTools, dispatch }        from '@/lib/mcp/registry'

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

function isAuthed(req: NextRequest): boolean {
  const secret = process.env.DASHBOARD_MCP_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
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
  if (!isAuthed(request)) {
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
