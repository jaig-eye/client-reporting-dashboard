// ─────────────────────────────────────────────────────────────────────────────
// Admin session utilities
//
// Two admin types:
//   Super admin — logs in with ADMIN_PASSWORD env var (+ email OTP). No user row.
//     Session token claim: { isSuperAdmin: true }. Can manage user accounts.
//
//   Regular admin — logs in with email/username + password stored in users table.
//     Session token claim: { isSuperAdmin: false, userId, role }.
//
// The `admin_session` cookie holds an HMAC-SIGNED token (see lib/session.ts), NOT
// the raw password and NOT a client-editable id. Authorization reads the signed
// claims, so a client can no longer escalate by deleting/editing a cookie.
// `isAdminAuthed(session)` stays synchronous (Node) so its 100+ call sites are
// unchanged; role-specific checks use isSuperAdminAuthed()/getVerifiedUserId().
// ─────────────────────────────────────────────────────────────────────────────

import { cookies } from 'next/headers'
import { createAdminClient } from './supabase/server'
import { createHash, timingSafeEqual } from 'crypto'
import bcrypt from 'bcryptjs'
import { verifyAdminSessionNode } from './session'

/**
 * Timing-safe string comparison for secrets and tokens.
 * Prevents timing-attack enumeration of CRON_SECRET, INGEST_SECRET, ADFUEL_API_KEY, etc.
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

/**
 * Verify a cron/webhook `Authorization: Bearer <CRON_SECRET>` header.
 *
 * Call sites previously did `timingSafeCompare(header, \`Bearer ${process.env.CRON_SECRET}\`)`.
 * When CRON_SECRET is UNSET that template evaluates to the literal string "Bearer undefined",
 * which is truthy — so timingSafeCompare's `!expected` guard never fires and anyone sending
 * `Authorization: Bearer undefined` authenticates as the cron. This helper fails closed on a
 * missing secret instead, and logs loudly so a misconfigured env is visible.
 */
export function verifyCronAuth(authHeader: string | null | undefined): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[auth] CRON_SECRET is not set — refusing all cron requests')
    return false
  }
  return timingSafeCompare(authHeader, `Bearer ${secret}`)
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
  const token = verifyAdminSessionNode(cookieStore.get('admin_session')?.value)
  if (!token) return null

  // Same rule as isSuperAdminAuthed — a missing userId is NOT a promotion. A
  // token with neither claim is malformed rather than privileged, so it resolves
  // to no session at all.
  if (token.isSuperAdmin === true) {
    // Super admin — authenticated via env-var password (+ OTP), no user row.
    return { isSuperAdmin: true }
  }
  if (!token.userId) return null

  // Regular admin user — look up their record from the SIGNED userId claim.
  const db = createAdminClient()
  const { data } = await db
    .from('users')
    .select('id, name, email, role, avatar_url')
    .eq('id', token.userId)
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

/** Quick synchronous check — valid admin session of any kind. Use in API routes that just need auth. */
export function isAdminAuthed(session: string | undefined): boolean {
  return verifyAdminSessionNode(session) !== null
}

/** Synchronous super-admin check from the signed token. Use to gate user-management routes. */
export function isSuperAdminAuthed(session: string | undefined): boolean {
  const token = verifyAdminSessionNode(session)
  // The claim itself, not "has no userId". The looser form meant a token saying
  // { isSuperAdmin: false } with userId omitted — which signAdminSession happily
  // produces, since userId is optional and dropped when falsy — was treated as
  // SUPER ADMIN here while getVerifiedUserId returned null for the same token.
  // Two helpers reading one token must not disagree about who it belongs to.
  return !!token && token.isSuperAdmin === true
}

/** The authenticated regular-admin's user id from the SIGNED token (never the raw cookie).
 *  Returns null for super admins (no user row) or invalid sessions. Use for ownership checks. */
export function getVerifiedUserId(session: string | undefined): string | null {
  const token = verifyAdminSessionNode(session)
  if (!token || token.isSuperAdmin) return null
  return token.userId ?? null
}

// ── Password hashing ──────────────────────────────────────────────────────────
// New hashes use bcrypt. Legacy rows are unsalted SHA-256 (64-hex); verifyPassword
// accepts both and callers upgrade the stored hash to bcrypt on successful login.

const BCRYPT_ROUNDS = 12

// A valid bcrypt hash of a throwaway string, compared against when no user is found so the
// response time doesn't reveal whether the account exists.
//
// Computed LAZILY on first use, never at module load: lib/auth.ts is imported by ~152 files
// (including the client dashboard and /access, purely for the synchronous isAdminAuthed
// check), and a cost-12 hashSync is ~0.5-1.5s of blocking CPU. At module scope that lands on
// the cold start of nearly every serverless function — including the /dashboard render right
// after a client clicks their magic link.
let _dummyHash: string | null = null
function dummyBcryptHash(): string {
  if (_dummyHash === null) _dummyHash = bcrypt.hashSync('dummy-password-for-timing-equalization', BCRYPT_ROUNDS)
  return _dummyHash
}

/** SHA-256 hash — LEGACY only. Kept for verifying pre-existing rows; do not use for new hashes. */
export function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex')
}

/**
 * Longest password bcrypt actually reads.
 *
 * bcrypt silently truncates at 72 BYTES — verified with the installed bcryptjs:
 * a 90-character password authenticates against a hash of the first 72, and
 * because '🔐' is 4 bytes, 18 emoji already reach the cap. SHA-256 had no such
 * limit, so moving to bcrypt introduces this. Rejecting at the boundary is
 * better than truncating silently: a user who typed a 100-character passphrase
 * should be told it was shortened, not have the tail quietly ignored.
 */
export const MAX_PASSWORD_BYTES = 72

/** True when the password exceeds what bcrypt will actually hash. */
export function passwordTooLong(password: string): boolean {
  return Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES
}

/** Hash a password for storage (bcrypt, salted). */
export function hashPasswordSecure(password: string): string {
  if (passwordTooLong(password)) {
    throw new Error(`Password must be ${MAX_PASSWORD_BYTES} bytes or fewer.`)
  }
  return bcrypt.hashSync(password, BCRYPT_ROUNDS)
}

/** Verify a password against a stored hash, supporting bcrypt and legacy SHA-256.
 *  `needsUpgrade` is true when the stored hash is legacy and should be re-hashed. */
export function verifyPassword(
  input: unknown,
  storedHash: string | null | undefined,
): { ok: boolean; needsUpgrade: boolean } {
  // bcryptjs THROWS on a non-string ("Illegal arguments: number, string"), and
  // the login handler has no try/catch — so `{"password": 123}` produced a 500
  // before the failed attempt was ever recorded, making the guess free and
  // invisible to both the rate limiter and the audit log. Treat it as a failure.
  if (typeof input !== 'string') {
    bcrypt.compareSync('', dummyBcryptHash())
    return { ok: false, needsUpgrade: false }
  }
  if (!storedHash) {
    // Spend comparable time to avoid user-enumeration via timing.
    bcrypt.compareSync(input, dummyBcryptHash())
    return { ok: false, needsUpgrade: false }
  }
  if (storedHash.startsWith('$2')) {
    // A corrupted or unsupported bcrypt hash also throws ("Illegal number of
    // rounds"), which would 500 the same way.
    try {
      return { ok: bcrypt.compareSync(input, storedHash), needsUpgrade: false }
    } catch {
      return { ok: false, needsUpgrade: false }
    }
  }
  // Legacy SHA-256 (64-hex) — constant-time compare.
  const a = Buffer.from(hashPassword(input), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  const ok = a.length === b.length && timingSafeEqual(a, b)
  // Burn comparable time on the legacy path too. Without this, a ~5ms response (vs ~1s for
  // bcrypt/no-user) is a precise oracle marking exactly which accounts still hold an
  // unsalted SHA-256 hash — i.e. the ones worth attacking offline.
  bcrypt.compareSync(input, dummyBcryptHash())
  return { ok, needsUpgrade: ok }
}
