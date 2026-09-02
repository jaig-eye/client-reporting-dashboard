// ─────────────────────────────────────────────────────────────────────────────
// One definition of how agency_settings secrets are masked before they reach the
// admin browser. Shared by the settings API (which masks its GET/PUT responses AND
// skips the mask on write so a key is never wiped) and the connections page (which
// mirrors the mask into the integration-card props). Sharing the constant is not
// cosmetic: the settings PUT skips a field ONLY when it equals SECRET_MASK exactly,
// so if the two ever used different mask strings, saving an unchanged card would
// overwrite the live key with the wrong mask.
// ─────────────────────────────────────────────────────────────────────────────

/** Eight bullets — no real API key looks like this, so a real value can never
 *  collide with the mask and be falsely treated as "unchanged". */
export const SECRET_MASK = '••••••••'

/** Every agency_settings column that holds a credential and must never leave the
 *  server in cleartext. Includes two legacy Meta columns that are effectively dead
 *  (tokens now live in connectors.auth) but are masked defensively in case a legacy
 *  row still holds a value. */
export const SECRET_FIELDS = [
  'ai_api_key', 'openai_api_key', 'discord_bot_token',
  'stripe_api_key', 'stripe_webhook_secret', 'serp_api_key',
  'meta_access_token', 'meta_system_user_token',
] as const

/** Replace any SET secret with SECRET_MASK; leave unset ('' / null / non-string) as-is. */
export function maskSecrets(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row }
  for (const f of SECRET_FIELDS) {
    if (typeof out[f] === 'string' && (out[f] as string).length > 0) out[f] = SECRET_MASK
  }
  return out
}

/** True when a value coming back on a WRITE should be treated as "leave the stored
 *  key alone": the mask itself (an untouched card re-saved), or absent entirely.
 *
 *  Empty string is deliberately NOT in this set — see isClearedSecret. Folding ''
 *  into "unchanged" meant blank-and-save silently no-opped while the card's own
 *  `setIsConnected(!!value.trim())` flipped to "not connected", so the UI reported
 *  a disconnect that never happened and the live credential stayed in the database
 *  and in use by every cron. None of the integration cards offers a delete control,
 *  so blanking the field was the ONLY way to revoke a leaked key — which is exactly
 *  the control you need working during an incident. */
export function isUnchangedSecret(value: unknown): boolean {
  return value === SECRET_MASK || value === null || value === undefined
}

/** True when the caller explicitly blanked a secret field and means "remove it".
 *  Callers should persist null (not '') so the column reads as unset everywhere. */
export function isClearedSecret(value: unknown): boolean {
  return typeof value === 'string' && value.trim() === ''
}
