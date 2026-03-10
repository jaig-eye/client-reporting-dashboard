// PATCH /api/admin/users/me — update the current logged-in user's profile.
// Uses admin_user_id cookie to identify the user.
// Super admin (no admin_user_id) cannot use this endpoint.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

export async function PATCH(req: NextRequest) {
  const session = req.cookies.get('admin_session')?.value
  const userId  = req.cookies.get('admin_user_id')?.value

  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!userId) {
    return NextResponse.json({ error: 'Super admin profile is not editable here' }, { status: 403 })
  }

  const body = await req.json()
  const { name, email, avatar_url } = body

  const update: Record<string, unknown> = {}
  if (name       !== undefined) update.name       = name
  if (email      !== undefined) update.email      = (email as string).toLowerCase().trim()
  if (avatar_url !== undefined) update.avatar_url = avatar_url

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const db = createAdminClient()
  const { data, error } = await db
    .from('users')
    .update(update)
    .eq('id', userId)
    .select('id, name, email, avatar_url, role')
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Email already in use' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}
