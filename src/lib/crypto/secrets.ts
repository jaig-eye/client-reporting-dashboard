// ─────────────────────────────────────────────────────────────────────────────
// Envelope encryption for stored credentials.
//
// WHAT THIS DEFENDS AGAINST, honestly:
//
//   ✔ A database dump. The key lives in the environment, never in Postgres, so
//     a stolen backup, a leaked service-role key, or a SQL-injection read of
//     client_notes yields ciphertext and nothing else.
//   ✔ Casual exposure. Secrets never appear in list responses, never reach the
//     browser except on an explicit, audited reveal, and are never logged.
//
//   ✘ Application compromise. Anyone who can run code on the server can read
//     CREDENTIAL_ENCRYPTION_KEY and decrypt everything. This is a lockbox, not
//     a vault: it is strictly better than plaintext and strictly worse than a
//     dedicated secrets manager where the app holds no key at all.
//
// So the recommendation stays: for high-value credentials, keep the source of
// truth in 1Password/Bitwarden and store a pointer here. This exists for the
// cases where the team genuinely needs the value inside the dashboard.
//
// AES-256-GCM is used because it is authenticated: tampering with stored
// ciphertext produces a decryption failure rather than silently different
// plaintext.
// ─────────────────────────────────────────────────────────────────────────────

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12    // 96-bit nonce, the GCM standard
const TAG_LEN = 16
/** Version prefix so the format can change later without ambiguity. */
const PREFIX = 'v1'

export class SecretsUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretsUnavailableError'
  }
}

/**
 * KEY ROTATION
 *
 * CREDENTIAL_ENCRYPTION_KEY is the active key — everything is sealed under it.
 * CREDENTIAL_ENCRYPTION_KEY_OLD is an optional comma-separated list of retired
 * keys that decryption will still try.
 *
 * Without this, rotating the key — the routine response to a suspected leak,
 * which is the single scenario this module exists for — would irrecoverably
 * destroy every stored credential, discovered one failed unlock at a time. With
 * it, rotation is: move the current value to _OLD, set a new one, and every
 * existing secret keeps opening while new writes use the new key. Re-sealing an
 * individual secret happens naturally the next time someone saves it.
 */
function decryptionKeys(): Buffer[] {
  const keys = [key()]
  const retired = process.env.CREDENTIAL_ENCRYPTION_KEY_OLD
  if (retired) {
    for (const k of retired.split(',').map(s => s.trim()).filter(Boolean)) {
      try { keys.push(parseKey(k)) } catch { /* skip an unusable retired key */ }
    }
  }
  return keys
}

/** Decode a base64 or hex 32-byte key. */
function parseKey(trimmed: string): Buffer {
  let buf: Buffer
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    buf = Buffer.from(trimmed, 'hex')
  } else {
    buf = Buffer.from(trimmed, 'base64')
  }
  if (buf.length !== 32) {
    throw new SecretsUnavailableError(
      `CREDENTIAL_ENCRYPTION_KEY must decode to 32 bytes (got ${buf.length}). Use \`openssl rand -base64 32\`.`,
    )
  }
  return buf
}

/**
 * Resolve the 32-byte active key. Accepts base64 or hex so operators can paste
 * either `openssl rand -base64 32` or `openssl rand -hex 32`.
 */
function key(): Buffer {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY
  if (!raw || raw.trim() === '') {
    throw new SecretsUnavailableError(
      'CREDENTIAL_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and add it to the environment before storing credentials.',
    )
  }
  const trimmed = raw.trim()

  let buf: Buffer
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    buf = Buffer.from(trimmed, 'hex')
  } else {
    buf = Buffer.from(trimmed, 'base64')
  }

  if (buf.length !== 32) {
    throw new SecretsUnavailableError(
      `CREDENTIAL_ENCRYPTION_KEY must decode to 32 bytes (got ${buf.length}). Use \`openssl rand -base64 32\`.`,
    )
  }
  return buf
}

/** True when the environment is configured to store credentials at all. */
export function secretsAvailable(): boolean {
  try { key(); return true } catch { return false }
}

/**
 * Encrypt a plaintext secret.
 *
 * Output: `v1.<iv>.<tag>.<ciphertext>`, all base64url. The IV is random per
 * call, so encrypting the same password twice produces different ciphertext and
 * an observer cannot tell that two clients share a password.
 */
export function encryptSecret(plaintext: string): string {
  const k = key()
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, k, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    PREFIX,
    iv.toString('base64url'),
    tag.toString('base64url'),
    enc.toString('base64url'),
  ].join('.')
}

/**
 * Decrypt. Throws on a wrong key or tampered ciphertext rather than returning
 * anything, which is the point of using an authenticated cipher.
 */
export function decryptSecret(stored: string): string {
  const parts = stored.split('.')
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error('Stored secret is not in the expected format')
  }
  const iv  = Buffer.from(parts[1], 'base64url')
  const tag = Buffer.from(parts[2], 'base64url')
  const enc = Buffer.from(parts[3], 'base64url')
  if (iv.length !== IV_LEN || tag.length !== TAG_LEN) {
    throw new Error('Stored secret has an invalid nonce or tag length')
  }

  // Try the active key, then any retired ones. GCM authenticates, so a wrong key
  // throws rather than returning plausible garbage — trying several is safe and
  // is what makes rotation survivable.
  const keys = decryptionKeys()
  let lastErr: unknown
  for (const k of keys) {
    try {
      const decipher = createDecipheriv(ALGO, k, iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
    } catch (e) { lastErr = e }
  }
  throw new Error(
    keys.length > 1
      ? 'Could not decrypt with the current key or any retired key.'
      : `Could not decrypt with the current key.${lastErr ? '' : ''}`,
  )
}

/** Cheap shape check without needing the key — used to show "a secret is stored". */
export function looksEncrypted(v: unknown): boolean {
  return typeof v === 'string' && v.startsWith(`${PREFIX}.`) && v.split('.').length === 4
}
