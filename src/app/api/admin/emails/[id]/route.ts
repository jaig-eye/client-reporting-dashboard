import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed }             from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase/server'

const SELECT = `
  id, client_id, title, subject_line, goal,
  preview_image_url, preview_url, html_content,
  sent_at, utm_campaign,
  open_rate, click_rate, conversions, revenue,
  status, reviewer_notes, reviewed_at,
  submitted_by, reviewed_by, created_at, updated_at,
  clients(name),
  submitter:users!submitted_by(name, avatar_url),
  reviewer:users!reviewed_by(name)
`

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const db = createAdminClient()

  const { data, error } = await db
    .from('email_campaigns')
    .select(SELECT)
    .eq('id', id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: 'Failed to load email' }, { status: 500 })
  if (!data)  return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ email: data })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const allowed = [
    'title', 'subject_line', 'goal',
    'preview_image_url', 'html_content', 'preview_url',
    'sent_at', 'utm_campaign',
    'open_rate', 'click_rate', 'conversions', 'revenue',
    // 'status' intentionally omitted — status changes go through /review
  ]

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  const db = createAdminClient()

  const { data, error } = await db
    .from('email_campaigns')
    .update(updates)
    .eq('id', id)
    .select(SELECT)
    .maybeSingle()

  if (error) {
    console.error('[email PATCH]', error)
    return NextResponse.json({ error: 'Failed to update email' }, { status: 500 })
  }

  return NextResponse.json({ email: data })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const db = createAdminClient()

  const { data: existing } = await db
    .from('email_campaigns')
    .select('id')
    .eq('id', id)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await db.from('email_campaigns').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })

  return new NextResponse(null, { status: 204 })
}
