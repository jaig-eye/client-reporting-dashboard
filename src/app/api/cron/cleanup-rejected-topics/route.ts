// GET /api/cron/cleanup-rejected-topics
// Weekly cron: deletes content_topics with status='rejected' older than 7 days.

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeCompare } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret') ?? new URL(request.url).searchParams.get('secret')
  if (!timingSafeCompare(secret, process.env.CRON_SECRET)) {
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
