// POST /api/admin/content/silos/[siloId]/internal-links/recommend
// Scans published silo pages and creates recommended link records.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'
import { recommendInternalLinks } from '@/lib/content/siloEngine'

export async function POST(
  request: NextRequest,
  { params }: { params: { siloId: string } }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { siloId } = params
  const db = createAdminClient()

  // Verify silo exists
  const { data: silo } = await db
    .from('content_silos')
    .select('id, client_id')
    .eq('id', siloId)
    .maybeSingle()

  if (!silo) return NextResponse.json({ error: 'Silo not found' }, { status: 404 })

  try {
    const created = await recommendInternalLinks({ siloId, clientId: silo.client_id })
    return NextResponse.json({ ok: true, created })
  } catch (err) {
    console.error('[internal-links/recommend] Failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
