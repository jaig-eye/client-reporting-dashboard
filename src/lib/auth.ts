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
import { createHash, createHmac, timingSafeEqual } from 'crypto'

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

// ─────────────────────────────────────────────────────────────────────────────
// SIGNED IDENTITY
//
// `admin_session` is the same value for everybody — it is the shared
// ADMIN_PASSWORD — so it proves "somebody logged in" and nothing more. Identity
// came from `admin_user_id`, an unsigned cookie whose ABSENCE meant super admin.
// That made the identity trivially forgeable from the browser: a role='viewer'
// deletes admin_user_id and is promoted to super admin, or sets it to a
// colleague's uuid and acts (and is logged) as them.
//
// It did not matter while identity was only used to label activity rows. It
// matters now that reading a stored credential and deleting a client's live
// article are gated on role. So the subject is signed with an HMAC the browser
// cannot compute.
//
// The signing secret defaults to ADMIN_PASSWORD so no new env var is required;
// set SESSION_SIGNING_SECRET to decouple them (rotating one then does not
// invalidate the other).
// ─────────────────────────────────────────────────────────────────────────────

export const IDENTITY_COOKIE = 'admin_identity'
/** Subject used for the env-var super admin, who has no users row. */
export const SUPER_SUBJECT = '__super__'

function signingSecret(): string | undefined {
  return process.env.SESSION_SIGNING_SECRET || process.env.ADMIN_PASSWORD || undefined
}

/** `<subject>.<hmac>` for the identity cookie, or null if unconfigured. */
export function signIdentity(subject: string): string | null {
  const secret = signingSecret()
  if (!secret) return null
  const sig = createHmac('sha256', secret).update(subject).digest('base64url')
  return `${subject}.${sig}`
}

/** The subject a cookie proves, or null if it is missing, malformed, or forged. */
export function verifyIdentity(value: string | undefined): string | null {
  if (!value) return null
  const idx = value.lastIndexOf('.')
  if (idx <= 0) return null
  const expected = signIdentity(value.slice(0, idx))
  if (!expected) return null
  return timingSafeCompare(value, expected) ? value.slice(0, idx) : null
}

/** Reads cookies and returns the current admin session, or null if unauthenticated. */
export async function getAdminSession(): Promise<AdminSession | null> {
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')?.value
  if (!timingSafeCompare(session, process.env.ADMIN_PASSWORD)) return null

  // Prefer the signed subject. Fall back to the legacy unsigned cookie so
  // sessions issued before signing existed keep working for display and
  // attribution — privileged actions go through requireVerifiedAdmin(), which
  // does not accept the fallback.
  const signed = verifyIdentity(cookieStore.get(IDENTITY_COOKIE)?.value)
  const userId = signed === SUPER_SUBJECT
    ? undefined
    : (signed ?? cookieStore.get('admin_user_id')?.value)

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
    .maybeSingle()

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

export type AdminGate =
  | { ok: true;  admin: AdminSession }
  | { ok: false; status: 401 | 403; error: string }

/**
 * Gate for the actions where being wrong is expensive: revealing a stored
 * credential, deleting a client's live article, cross-tenant maintenance.
 *
 * Unlike getAdminSession() this REQUIRES a signed identity, so a caller cannot
 * become somebody else by editing a cookie. A session predating the signing
 * change has no valid cookie and is refused with a message that says what to do
 * about it, rather than being silently trusted.
 */
export async function requireVerifiedAdmin(): Promise<AdminGate> {
  const cookieStore = await cookies()
  if (!timingSafeCompare(cookieStore.get('admin_session')?.value, process.env.ADMIN_PASSWORD)) {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }

  const subject = verifyIdentity(cookieStore.get(IDENTITY_COOKIE)?.value)
  if (!subject) {
    return {
      ok: false,
      status: 403,
      error: 'This action needs a verified session. Sign out and sign back in, then try again.',
    }
  }

  if (subject === SUPER_SUBJECT) return { ok: true, admin: { isSuperAdmin: true } }

  const db = createAdminClient()
  const { data } = await db
    .from('users')
    .select('id, name, email, role, avatar_url')
    .eq('id', subject)
    .eq('is_active', true)
    .maybeSingle()

  if (!data) return { ok: false, status: 401, error: 'Unauthorized' }
  if (data.role !== 'admin') {
    return { ok: false, status: 403, error: 'This action requires an admin account.' }
  }

  return {
    ok: true,
    admin: {
      isSuperAdmin: false,
      userId: data.id,
      name: data.name,
      email: data.email,
      role: data.role,
      avatarUrl: data.avatar_url,
    },
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
