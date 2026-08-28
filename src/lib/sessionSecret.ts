// ─────────────────────────────────────────────────────────────────────────────
// Runtime-neutral resolution of the admin-session HMAC secret.
//
// Imported by BOTH lib/session.ts (Node) and lib/session-edge.ts (Edge/middleware),
// so it MUST stay free of node:crypto or any Node-only import — the Edge bundle
// includes it. One definition is the whole point: when the two verifiers resolved
// the secret independently, a change to one (a new env var, a changed production
// rule) would silently make middleware and the route handlers disagree about who
// is logged in, with no compile-time signal.
//
// NO ADMIN_PASSWORD FALLBACK IN PRODUCTION. Until signed sessions shipped,
// `admin_session` literally WAS ADMIN_PASSWORD and rode on every admin request, so
// that value may sit in Vercel/WAF logs, HAR exports and support screenshots.
// Using it as the HMAC key would let anyone holding an old cookie forge
// `{ isSuperAdmin: true }`, bypassing both the password and the OTP. Unset in
// production this returns '', so both verifiers reject everything and signing
// throws: nobody can log in until SESSION_SECRET is set. That is intentional.
// ─────────────────────────────────────────────────────────────────────────────

export function resolveSessionSecret(): string {
  const explicit = process.env.SESSION_SECRET
  if (explicit) return explicit

  if (process.env.NODE_ENV === 'production') return ''

  // Local/preview convenience only.
  return process.env.ADMIN_PASSWORD || ''
}
