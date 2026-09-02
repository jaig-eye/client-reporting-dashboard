// ─────────────────────────────────────────────────────────────────────────────
// The two rules every note endpoint must obey, in one place.
//
// Both the collection route and the single-note route have to keep ciphertext
// off the wire and seal credentials identically. They each had their own inline
// copy, which is how the `has_secret` contract and the encryption error strings
// start to disagree — and a divergence here is not cosmetic: one half of it is
// what stops an encrypted password being sent to a browser.
//
// This lives in lib/ rather than being exported from a route because a Next.js
// route module may only export its handlers and route config.
// ─────────────────────────────────────────────────────────────────────────────

import { encryptSecret, secretsAvailable } from '@/lib/crypto/secrets'
import { categoryHoldsSecret }             from '@/lib/note-templates'

/**
 * Strip the ciphertext before anything leaves the server.
 *
 * The browser only ever needs to know THAT a secret is stored, so it can render
 * the locked state. The value itself is available exclusively through the
 * audited reveal endpoint.
 */
export function redactSecret<T extends Record<string, unknown>>(
  row: T,
): Omit<T, 'secret_enc'> & { has_secret: boolean } {
  const { secret_enc, ...rest } = row
  return { ...rest, has_secret: typeof secret_enc === 'string' && secret_enc.length > 0 }
}

/**
 * Turn a plaintext credential into stored ciphertext.
 *
 * Returns a 400-shaped error rather than storing anything when the key is
 * missing: falling back to plaintext would silently defeat the entire point, and
 * a loud failure is the correct behaviour for a misconfigured secret store.
 *
 * `undefined` means "not supplied — leave the stored value alone"; an empty
 * string means "clear it". Those are deliberately different so that editing a
 * login note's other fields cannot wipe the password by omission.
 */
export function encodeSecret(
  raw: string | undefined,
  category: string,
): { value?: string; error?: string } {
  if (raw === undefined) return {}
  const s = raw.trim()
  if (s === '') return { value: undefined }   // explicit clear

  // Enforced server-side, not merely hidden in the UI. The API used to accept
  // `secret` on any category, so a credential could be written onto a note whose
  // template has no secret field — invisible in the interface, unclearable
  // through it, and still decryptable through the reveal endpoint.
  if (!categoryHoldsSecret(category)) {
    return { error: `Credentials can only be stored on a Login, DNS or Hosting note, not a ${category} one.` }
  }

  if (!secretsAvailable()) {
    return { error: 'Credential storage is not configured. Set CREDENTIAL_ENCRYPTION_KEY in the environment (openssl rand -base64 32), then try again.' }
  }
  try {
    return { value: encryptSecret(s) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not encrypt the credential' }
  }
}
