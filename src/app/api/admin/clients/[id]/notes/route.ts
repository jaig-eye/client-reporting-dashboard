import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed }             from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase/server'
import {
  isNoteCategory,
  sanitizeNoteFields,
  categoryStampsContact,
} from '@/lib/note-templates'
import { encryptSecret, secretsAvailable } from '@/lib/crypto/secrets'

const NOTE_SELECT =
  'id, title, content, category, fields, pinned, created_at, updated_at, updated_by, user_id, secret_enc, ' +
  'users:users!user_id(name, avatar_url), editor:users!updated_by(name, avatar_url)'

/**
 * Strip the ciphertext before anything leaves the server.
 *
 * The browser only ever needs to know THAT a secret is stored, so it can render
 * the locked state. The value itself is available exclusively through the
 * audited reveal endpoint. Sending encrypted bytes to the client would not be a
 * disaster, but there is no reason to put them on the wire at all.
 */
function redactSecret<T extends Record<string, unknown>>(row: T): Omit<T, 'secret_enc'> & { has_secret: boolean } {
  const { secret_enc, ...rest } = row
  return { ...rest, has_secret: typeof secret_enc === 'string' && secret_enc.length > 0 }
}

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

/**
 * Turn a plaintext secret into stored ciphertext.
 *
 * Returns a 400-shaped error rather than storing anything when the key is
 * missing: falling back to plaintext would silently defeat the entire point,
 * and a loud failure is the correct behaviour for a misconfigured secret store.
 */
function encodeSecret(raw: string | undefined): { value?: string; error?: string } {
  if (raw === undefined) return {}
  const s = raw.trim()
  if (s === '') return { value: undefined }   // explicit clear
  if (!secretsAvailable()) {
    return { error: 'Credential storage is not configured. Set CREDENTIAL_ENCRYPTION_KEY in the environment (openssl rand -base64 32), then try again.' }
  }
  try {
    return { value: encryptSecret(s) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not encrypt the credential' }
  }
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
  const userId = request.cookies.get('admin_user_id')?.value ?? null

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

  const secret = encodeSecret(body.secret)
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
    const stamp = isNaN(occurred.getTime()) ? new Date() : occurred

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
