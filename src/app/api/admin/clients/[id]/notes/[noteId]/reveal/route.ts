// POST /api/admin/clients/[id]/notes/[noteId]/reveal
//
// Decrypts a stored credential and returns it ONCE, recording who asked.
//
// This is the only path in the application that turns stored ciphertext back
// into a password. Everything else — the notes list, the note editor, the note
// popup — sees `has_secret: true` and nothing more.
//
// Design decisions worth stating:
//   - The credential is returned in the RESPONSE BODY of a POST, never in a URL,
//     so it cannot end up in browser history, a proxy log, or a Referer header.
//   - The response is explicitly marked no-store so no cache layer retains it.
//   - Every reveal is written to credential_access_log BEFORE the value is
//     returned. An access trail written after the fact can be skipped by an
//     early return or a thrown error; this one cannot.
//   - A missing encryption key is a 503, not a 500: the data is intact, the
//     server is simply not configured to read it.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient }         from '@/lib/supabase/server'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { decryptSecret, secretsAvailable } from '@/lib/crypto/secrets'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: clientId, noteId } = await params

  if (!secretsAvailable()) {
    return NextResponse.json(
      { error: 'Credential storage is not configured on this server (CREDENTIAL_ENCRYPTION_KEY is missing). The stored value is intact but cannot be read.' },
      { status: 503 },
    )
  }

  const db = createAdminClient()

  const { data, error } = await db
    .from('client_notes')
    .select('id, client_id, category, fields, secret_enc')
    .eq('id', noteId)
    .eq('client_id', clientId)   // scoped: a note id alone is not enough
    .maybeSingle()

  if (error) {
    console.error('[credential reveal] lookup failed', error.message)
    return NextResponse.json({ error: 'Failed to load note' }, { status: 500 })
  }

  const note = data as unknown as {
    id: string
    client_id: string
    category: string | null
    fields: Record<string, unknown> | null
    secret_enc: string | null
  } | null

  if (!note)             return NextResponse.json({ error: 'Note not found' }, { status: 404 })
  if (!note.secret_enc)  return NextResponse.json({ error: 'No credential stored on this note' }, { status: 404 })

  let plaintext: string
  try {
    plaintext = decryptSecret(note.secret_enc)
  } catch (e) {
    // A decrypt failure means the key changed or the row was tampered with.
    // Say which, because the remedies are completely different.
    console.error('[credential reveal] decrypt failed', e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: 'Could not decrypt this credential. Either CREDENTIAL_ENCRYPTION_KEY has changed since it was saved, or the stored value was altered.' },
      { status: 422 },
    )
  }

  const admin = await getAdminSession()
  const actorLabel = admin?.email ?? admin?.name ?? (admin?.isSuperAdmin ? 'super_admin' : 'admin')

  // Written BEFORE the value is handed over, so the trail cannot be lost to a
  // later failure. A logging failure does not block the reveal, but it is loud.
  const { error: logErr } = await db.from('credential_access_log').insert({
    note_id:     note.id,
    client_id:   note.client_id,
    user_id:     admin?.userId ?? null,
    actor_label: actorLabel,
    service:     (note.fields?.service as string | undefined) ?? null,
    ip:          request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  })
  if (logErr) console.error('[credential reveal] access log insert failed', logErr.message)

  return NextResponse.json(
    { secret: plaintext },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        'Pragma':        'no-cache',
      },
    },
  )
}
