// /api/admin/users/me
// Update the current user's profile (name, email, avatar_url).
// Password change is handled separately at /api/admin/users/me/password.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

function requireAdmin(req: NextRequest): boolean {
  const session = req.cookies.get('admin_session')?.value
  return !!session && session === process.env.ADMIN_PASSWORD
}

// PATCH — update name, email, avatar_url
export async function PATCH(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { name, email, avatar_url } = body

  // Build update object with only provided fields
  const update: Record<string, unknown> = {}
  if (name       !== undefined) update.name       = name
  if (email      !== undefined) update.email      = email
  if (avatar_url !== undefined) update.avatar_url = avatar_url

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const db = createAdminClient()
  // Update the first admin user (single-user mode) — extend for multi-user by adding session.user_id
  const { data, error } = await db
    .from('users')
    .update(update)
    .eq('role', 'admin')
    .eq('is_active', true)
    .select('id, name, email, avatar_url, role')
    .limit(1)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
