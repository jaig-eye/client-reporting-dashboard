import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed }             from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const userId = request.cookies.get('admin_user_id')?.value ?? null

  let body: { action: 'approve' | 'reject'; notes?: string }
  try {
    body = await request.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!['approve', 'reject'].includes(body.action)) {
    return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 })
  }
  if (body.action === 'reject' && !body.notes?.trim()) {
    return NextResponse.json({ error: 'notes are required when rejecting' }, { status: 400 })
  }

  const db = createAdminClient()

  const { data, error } = await db
    .from('email_campaigns')
    .update({
      status:         body.action === 'approve' ? 'approved' : 'rejected',
      reviewer_notes: body.notes?.trim() || null,
      reviewed_by:    userId,
      reviewed_at:    new Date().toISOString(),
      updated_at:     new Date().toISOString(),
    })
    .eq('id', id)
    .select('id, status, reviewer_notes, reviewed_at')
    .maybeSingle()

  if (error) {
    console.error('[email review POST]', error)
    return NextResponse.json({ error: 'Failed to update review' }, { status: 500 })
  }

  return NextResponse.json({ email: data })
}
