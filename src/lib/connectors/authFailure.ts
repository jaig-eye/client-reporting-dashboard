// ─────────────────────────────────────────────────────────────────────────────
// Telling a dead credential apart from a bad five minutes.
//
// This lives in its own module rather than inside the cron route so it can be imported by a test.
// The rule it encodes was wrong in production and the wrongness was invisible, which is exactly
// the kind of thing that should be checkable without deploying.
//
// WHAT WAS WRONG
//
// The original test was a single regex — OAuthException, code 190, "access token", invalid_grant,
// 401, invalid_client — and against ninety days of real sync_jobs it fired far more often on
// things that were fine than on things that were broken:
//
//   GHL 401 "Command timed out"               46   a timeout that answers 401
//   GHL 401 "Location is not active"          75   the client's location is disabled, not our token
//   Meta "Service temporarily unavailable"    30   Meta tags transient errors type:OAuthException
//   Meta 403 "request limit reached"           2   rate limit, and it says is_transient:true
//   Meta 500 "unexpected error, please retry"  4   transient
//
// against two groups that genuinely needed a human: "Error validating access token: Session has
// expired", 51 syncs across the 25 July and 25 September incidents.
//
// It also could not see Google at all. Every Google auth failure reaches sync_jobs through our own
// string, `Google token refresh failed: ${data.error}`, which matches none of those patterns.
//
// THE RULE
//
// Two lists. A positive one for signatures that mean somebody has to reconnect something, and a
// transient one that vetoes it — because a message can carry both, and when it does it is a bad
// five minutes wearing the same words.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Signatures that mean a credential is finished and a human has to reconnect it.
 *
 * Each is either a provider's own wording or a string we emit ourselves. `Google token refresh
 * failed` is the latter and matters most: it is the only way a Google auth failure is ever
 * recorded, so without it the four Google connectors could not be reported at all.
 */
export const CREDENTIAL_DEAD_PATTERNS = [
  'Error validating access token',   // Meta, the real one
  'Session has expired',             // Meta
  'Google token refresh failed',     // ours: every Google auth failure passes through it
  'invalid_grant',                   // OAuth: refresh token revoked or expired
  'invalid_client',
  'unauthorized_client',
  'UNAUTHENTICATED',                 // Google gRPC
  'token has expired',
  'code\\D{0,4}190\\b',              // Meta's expired-session code (190, not 1900)
  // A 401 in our own error strings for the connectors whose keys do not refresh. Dropping the old
  // bare "401" silenced these entirely: a revoked Ahrefs key or BigCommerce token would have failed
  // every sync with nobody told. None appears in ninety days of errors, so they add no noise.
  'Ahrefs API error 401',
  'BigCommerce(?: Orders)? API(?: error)? 401',
  // GHL's 401 is the agency key or a location's access. Its two noisy 401s — "Location is not
  // active" and "Command timed out" — are vetoed by the transient list below, so what is left is a
  // real authentication failure.
  'GHL API error 401',
]

/**
 * ...unless the same message also says it was temporary.
 *
 * This veto is what the old single regex lacked, and between them these accounted for every false
 * alarm in the last ninety days.
 */
export const AUTH_TRANSIENT_PATTERNS = [
  'is_transient"?\\s*:\\s*true',
  'temporarily unavailable',
  'request limit reached',
  'rate limit',
  'timed out',
  'timeout',
  'Location is not active',          // GHL: the location is off on their side, not our credential
  'internal_failure',                // Google having a moment during a refresh
  'error 5\\d\\d',                   // any provider 5xx
  '"code"\\s*:\\s*5\\d\\d',
]

const CREDENTIAL_DEAD = new RegExp(CREDENTIAL_DEAD_PATTERNS.join('|'), 'i')
const AUTH_TRANSIENT  = new RegExp(AUTH_TRANSIENT_PATTERNS.join('|'), 'i')

/**
 * Does this sync error mean a credential needs reconnecting?
 *
 * False for anything transient, and false for an empty message — an error we recorded no reason
 * for is not evidence of a dead token.
 */
export function isDeadCredentialError(message: string | null | undefined): boolean {
  const msg = message ?? ''
  if (!msg) return false
  if (!CREDENTIAL_DEAD.test(msg)) return false
  if (AUTH_TRANSIENT.test(msg)) return false
  return true
}
