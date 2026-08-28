import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed, getVerifiedUserId } from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase/server'
import {
  isNoteCategory,
  sanitizeNoteFields,
  categoryStampsContact,
} from '@/lib/note-templates'
import { redactSecret, encodeSecret } from '@/lib/notes/noteSecrets'

const NOTE_SELECT =
  'id, title, content, category, fields, pinned, created_at, updated_at, updated_by, user_id, secret_enc, ' +
  'users:users!user_id(name, avatar_url), editor:users!updated_by(name, avatar_url)'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: clientId } = await params
  const db = createAdminClient()

  // Optional server-side category filter; the free-text filter stays client-side
  // because the list is capped at 200 rows anyway.
  const category = request.nextUrl.searchParams.get('category')

  let q = db
    .from('client_notes')
    .select(NOTE_SELECT)
    .eq('client_id', clientId)

  if (category && isNoteCategory(category)) q = q.eq('category', category)

  const { data, error } = await q
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    console.error('[client notes GET]', error)
    return NextResponse.json({ error: 'Failed to load notes' }, { status: 500 })
  }

  return NextResponse.json({
    notes: ((data ?? []) as unknown as Record<string, unknown>[]).map(redactSecret),
  })
}

interface NoteBody {
  content?:  string
  title?:    string
  pinned?:   boolean
  category?: string
  fields?:   Record<string, unknown>
  /** Plaintext credential. Encrypted here and never stored or logged as-is. */
  secret?:   string
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: clientId } = await params
  // From the SIGNED session, never the admin_user_id cookie: that cookie is
  // client-editable, so any authenticated admin could attribute a write to a
  // colleague just by changing it. Returns null for the super admin, who has no
  // user row — same as before.
  const userId = getVerifiedUserId(session)

  let body: NoteBody
  try {
    body = await request.json() as NoteBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const category = isNoteCategory(body.category) ? body.category : 'general'
  const fields   = sanitizeNoteFields(category, body.fields)
  const content  = body.content?.trim() ?? ''

  // A structured note (DNS record, login pointer) is meaningful with no prose,
  // so only require a body when the template has no fields to carry the meaning.
  if (!content && Object.keys(fields).length === 0) {
    return NextResponse.json(
      { error: 'Add a note body or fill in at least one field' },
      { status: 400 },
    )
  }

  const secret = encodeSecret(body.secret, category)
  if (secret.error) return NextResponse.json({ error: secret.error }, { status: 400 })

  const db = createAdminClient()

  const { data, error } = await db
    .from('client_notes')
    .insert({
      client_id: clientId,
      user_id:   userId,
      content,
      title:     body.title?.trim() || null,
      pinned:    body.pinned ?? false,
      category,
      fields,
      ...(secret.value ? { secret_enc: secret.value } : {}),
    })
    .select(NOTE_SELECT)
    .single()

  if (error || !data) {
    console.error('[client notes POST]', error)
    return NextResponse.json({ error: 'Failed to save note' }, { status: 500 })
  }

  // The generated DB types predate the category/fields columns, so PostgREST's
  // select-string inference falls back to an error union here.
  const note = data as unknown as Record<string, unknown> & { id: string }

  // A contact-log note doubles as the "we spoke to them" stamp so the common
  // path needs no second action. Never move the date backwards: back-filling an
  // old call must not make a client look staler than it is.
  let contactStampedAt: string | null = null
  if (categoryStampsContact(category)) {
    const occurred = fields.occurred_on
      ? new Date(`${fields.occurred_on}T12:00:00Z`)
      : new Date()
    const now = new Date()
    // Clamp forward as well as backward. A future date is a plausible typo
    // (2027 for 2026) and it is silently permanent: the cron computes a NEGATIVE
    // days-since, so `days >= threshold` is false and the client drops out of the
    // staleness digest entirely until that date arrives — no alert, and nothing
    // that would ever surface the mistake.
    const stamp = isNaN(occurred.getTime()) || occurred > now ? now : occurred

    const { data: current } = await db
      .from('clients')
      .select('last_contacted_at')
      .eq('id', clientId)
      .maybeSingle()

    const prev = current?.last_contacted_at ? new Date(current.last_contacted_at as string) : null
    if (!prev || stamp > prev) {
      const iso = stamp.toISOString()
      const { error: stampErr } = await db
        .from('clients')
        .update({
          last_contacted_at:     iso,
          last_contact_note_id:  note.id,
          last_contact_alert_at: null, // re-arm the staleness alert
        })
        .eq('id', clientId)
      if (stampErr) console.error('[client notes POST] contact stamp failed', stampErr)
      else contactStampedAt = iso
    }
  }

  // editor is always null on a fresh insert (updated_by is unset)
  return NextResponse.json(
    { note: { ...redactSecret(note), editor: null }, contactStampedAt },
    { status: 201 },
  )
}
