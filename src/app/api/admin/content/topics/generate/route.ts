// POST /api/admin/content/topics/generate
// Generates topic ideas for a client using GSC data + AI.
// Returns immediately; generation runs in background via waitUntil.
//
// Body: { client_id, count?, target_publish_date? }

import { NextRequest, NextResponse }      from 'next/server'
import { waitUntil }                      from '@vercel/functions'
import { cookies }                        from 'next/headers'
import { createAdminClient }              from '@/lib/supabase/server'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { generateTopicsForClient }        from '@/lib/content/generateTopics'
import { logActivity }                    from '@/lib/activity'

export const maxDuration = 300

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json() as { client_id: string; count?: number; target_publish_date?: string }
  const { client_id, count = 5, target_publish_date } = body

  if (!client_id) {
    return NextResponse.json({ error: 'client_id required' }, { status: 400 })
  }

  const db           = createAdminClient()
  const adminSession = await getAdminSession()

  // Return immediately — generation runs in background
  waitUntil(
    generateTopicsForClient(db, client_id, count, target_publish_date, { suppressEmail: true })
      .then(result => {
        if (!result.error) {
          logActivity(adminSession, 'generated', 'topics', { clientId: client_id, meta: { count: result.count } })
        }
      })
  )

  return NextResponse.json({ ok: true, queued: true })
}
