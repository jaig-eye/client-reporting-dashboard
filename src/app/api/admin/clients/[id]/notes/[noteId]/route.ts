import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed }             from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase/server'
import { isNoteCategory, sanitizeNoteFields } from '@/lib/note-templates'
import { encryptSecret, secretsAvailable } from '@/lib/crypto/secrets'

const NOTE_SELECT = 'id, title, content, category, fields, secret_enc, pinned, created_at, updated_at, updated_by, user_id, users:users!user_id(name, avatar_url), editor:users!updated_by(name, avatar_url)'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: clientId, noteId } = await params
  const db = createAdminClient()

  const { error } = await db
    .from('client_notes')
    .delete()
    .eq('id', noteId)
    .eq('client_id', clientId)

  if (error) {
    console.error('[client note DELETE]', error)
    return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 })
  }

  return new NextResponse(null, { status: 204 })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: clientId, noteId } = await params
  const userId = request.cookies.get('admin_user_id')?.value ?? null

  let body: {
    pinned?:   boolean
    content?:  string
    title?:    string | null
    category?: string
    fields?:   Record<string, unknown>
    /** Plaintext credential; '' clears it. Absent = leave unchanged. */
    secret?:   string
  }
  try {
    body = await request.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const db = createAdminClient()

  // Build the update patch depending on what was sent
  const patch: Record<string, unknown> = {}

  if ('pinned' in body) {
    patch.pinned = body.pinned
  }

  // Resolve the category the fields belong to. The editor always sends it, but
  // fall back to the stored value so a fields-only PATCH still sanitises correctly.
  let effectiveCategory: string | null = null
  if ('fields' in body || 'category' in body) {
    if (isNoteCategory(body.category)) {
      effectiveCategory = body.category
    } else {
      const { data: existing } = await db
        .from('client_notes')
        .select('category')
        .eq('id', noteId)
        .eq('client_id', clientId)
        .maybeSingle()
      effectiveCategory = (existing?.category as string | undefined) ?? 'general'
    }
  }

  if (effectiveCategory && 'category' in body && isNoteCategory(body.category)) {
    patch.category = body.category
  }

  // Credential updates. An absent `secret` key leaves the stored value alone —
  // only an explicit empty string clears it — so editing a login note's other
  // fields can never wipe the password by omission.
  if ('secret' in body) {
    const raw = (body.secret ?? '').trim()
    if (raw === '') {
      patch.secret_enc = null
    } else if (!secretsAvailable()) {
      return NextResponse.json(
        { error: 'Credential storage is not configured. Set CREDENTIAL_ENCRYPTION_KEY in the environment (openssl rand -base64 32), then try again.' },
        { status: 400 },
      )
    } else {
      try {
        patch.secret_enc = encryptSecret(raw)
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : 'Could not encrypt the credential' },
          { status: 400 },
        )
      }
    }
    patch.updated_at = new Date().toISOString()
    patch.updated_by = userId
  }

  // Re-sanitise against the effective category, so switching category drops the
  // answers that template no longer declares rather than leaving them orphaned.
  if ('fields' in body && effectiveCategory) {
    patch.fields     = sanitizeNoteFields(effectiveCategory, body.fields)
    patch.updated_at = new Date().toISOString()
    patch.updated_by = userId
  }

  if ('content' in body) {
    const content = (body.content ?? '').trim()
    const patchedFields = (patch.fields ?? null) as Record<string, string> | null
    // Mirrors POST: a structured note is valid with no prose, so only demand a
    // body when there are no field answers to carry the meaning.
    const hasFields = patchedFields
      ? Object.keys(patchedFields).length > 0
      : Object.keys(sanitizeNoteFields(effectiveCategory ?? 'general', body.fields)).length > 0
    if (!content && !hasFields) {
      return NextResponse.json(
        { error: 'Add a note body or fill in at least one field' },
        { status: 400 },
      )
    }
    patch.content    = content
    patch.title      = body.title?.trim() || null
    patch.updated_at = new Date().toISOString()
    patch.updated_by = userId
  } else if ('title' in body && !('pinned' in body) && !('fields' in body)) {
    // title-only update
    patch.title      = body.title?.trim() || null
    patch.updated_at = new Date().toISOString()
    patch.updated_by = userId
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { data, error } = await db
    .from('client_notes')
    .update(patch)
    .eq('id', noteId)
    .eq('client_id', clientId)
    .select(NOTE_SELECT)
    .maybeSingle()

  if (error) {
    console.error('[client note PATCH]', error)
    return NextResponse.json({ error: 'Failed to update note' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Note not found' }, { status: 404 })

  // Never let ciphertext onto the wire. The client only needs to know whether a
  // credential is stored; reading it goes through the audited reveal endpoint.
  const { secret_enc, ...safe } = data as unknown as Record<string, unknown>
  return NextResponse.json({
    note: { ...safe, has_secret: typeof secret_enc === 'string' && secret_enc.length > 0 },
  })
}
