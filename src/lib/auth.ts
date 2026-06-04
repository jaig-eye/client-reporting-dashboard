// ─────────────────────────────────────────────────────────────────────────────
// Admin session utilities
//
// Two admin types:
//   Super admin — logs in with ADMIN_PASSWORD env var (no email).
//     Cookies: admin_session = ADMIN_PASSWORD, admin_user_id absent.
//     Can create/delete/edit all users. Details not editable in UI.
//
//   Regular admin — logs in with email + password stored in users table.
//     Cookies: admin_session = ADMIN_PASSWORD, admin_user_id = user.id.
//     Has all permissions except managing other user accounts.
//
// All existing route guards (session === ADMIN_PASSWORD) still work unchanged.
// Role-specific logic reads admin_user_id to determine the caller type.
// ─────────────────────────────────────────────────────────────────────────────

import { cookies } from 'next/headers'
import { createAdminClient } from './supabase/server'
import { createHash, timingSafeEqual } from 'crypto'

/**
 * Timing-safe string comparison for secrets and tokens.
 * Prevents timing-attack enumeration of CRON_SECRET, ADMIN_PASSWORD, etc.
 * Returns false (not throws) when lengths differ or either value is missing.
 */
export function timingSafeCompare(
  provided: string | null | undefined,
  expected: string | undefined,
): boolean {
  if (!provided || !expected) return false
  try {
    const a = Buffer.from(provided)
    const b = Buffer.from(expected)
    return a.length === b.length && timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export interface AdminSession {
  isSuperAdmin: boolean
  userId?: string
  name?: string
  email?: string
  role?: string
  avatarUrl?: string
}

/** Reads cookies and returns the current admin session, or null if unauthenticated. */
export async function getAdminSession(): Promise<AdminSession | null> {
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')?.value
  if (!timingSafeCompare(session, process.env.ADMIN_PASSWORD)) return null

  const userId = cookieStore.get('admin_user_id')?.value
  if (!userId) {
    // Super admin — authenticated via env var password only
    return { isSuperAdmin: true }
  }

  // Regular admin user — look up their record
  const db = createAdminClient()
  const { data } = await db
    .from('users')
    .select('id, name, email, role, avatar_url')
    .eq('id', userId)
    .eq('is_active', true)
    .single()

  if (!data) return null

  return {
    isSuperAdmin: false,
    userId: data.id,
    name: data.name,
    email: data.email,
    role: data.role,
    avatarUrl: data.avatar_url,
  }
}

/** Quick synchronous check — use in API routes that just need auth (not role). */
export function isAdminAuthed(session: string | undefined): boolean {
  return timingSafeCompare(session, process.env.ADMIN_PASSWORD)
}

/** SHA-256 password hash — consistent with existing password routes. */
export function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex')
}
