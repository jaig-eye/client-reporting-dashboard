// GET /api/admin/content/dfs-locations?q=los+angeles
//
// Google geo targets matching `q` — cities, counties, states — for the research-location picker.
// Free: DataForSEO does not bill its locations list, and the list is held in-process for a day
// after the first fetch. Agency-level credentials are used because the list is the same for every
// client; no client connection is needed and nothing here can spend.

import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveDfsCreds, dfsSearchLocations } from '@/lib/connectors/dataforseo'

export const dynamic = 'force-dynamic'
// The first call on a fresh instance downloads the whole list (~100k rows) before it can answer.
export const maxDuration = 60

export async function GET(request: NextRequest) {
  if (!isAdminAuthed(request.cookies.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim()
  if (q.length < 2) return NextResponse.json({ locations: [] })

  let auth: Record<string, unknown> | null = null
  try {
    const { data } = await createAdminClient()
      .from('connectors')
      .select('auth')
      .eq('type', 'dataforseo')
      .limit(1)
      .maybeSingle()
    auth = (data as { auth?: Record<string, unknown> } | null)?.auth ?? null
  } catch { /* env credentials below, if any */ }

  const creds = resolveDfsCreds(auth)
  if (!creds) {
    return NextResponse.json({ locations: [], error: 'Connect DataForSEO under Integrations to look up locations.' })
  }

  const locations = await dfsSearchLocations(q, creds, { limit: 12 })
  return NextResponse.json({ locations: locations.map(l => ({ code: l.code, name: l.name, type: l.type })) })
}
