// GET /api/cron/cleanup-rejected-topics
// Weekly cron: deletes content_topics with status='rejected' older than 7 days.

import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!verifyCronAuth(authHeader)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()
  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString()

  const { count, error } = await db
    .from('content_topics')
    .delete({ count: 'exact' })
    .eq('status', 'rejected')
    .lt('created_at', cutoff)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, deleted: count ?? 0 })
}
