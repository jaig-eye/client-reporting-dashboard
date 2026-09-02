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

  // Any deployment on Vercel — production AND preview — gets NO fallback.
  //
  // The previous test was NODE_ENV === 'production', which Vercel also sets on
  // PREVIEW builds, so the "local/preview convenience" fallback below was already
  // unreachable there: a preview without its own SESSION_SECRET returned '', which
  // 503s login and puts middleware into a redirect loop. Widening the fallback to
  // cover preview would be the wrong repair, because previews point at the SAME
  // Supabase project as production — signing with ADMIN_PASSWORD, a value that rode
  // on every admin request before signed sessions shipped and may sit in Vercel/WAF
  // logs and HAR exports, would let anyone holding an old cookie mint
  // { isSuperAdmin: true } against live data.
  //
  // So: set SESSION_SECRET in Vercel for ALL environments (Production, Preview and
  // Development). VERCEL is set on every Vercel runtime and unset locally, which is
  // exactly the line we want the fallback to stop at.
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') return ''

  // Local `npm run dev` only.
  return process.env.ADMIN_PASSWORD || ''
}
