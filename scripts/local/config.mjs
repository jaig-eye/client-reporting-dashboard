// Local-only platform — ports, generated keys, and the .env.local that points the app at them.
//
// Keys are generated on first run and kept in .local/secrets.json (git-ignored). They are signed with
// a secret that exists only on this machine, so they are worthless anywhere else.

import { randomBytes, createHmac } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, LOCAL, DB } from './db.mjs'

export const PORTS = {
  gateway:   54321,   // stands in for https://<project>.supabase.co
  db:        DB.port,
  postgrest: 54323,
  app:       3000,
}
export const GATEWAY_URL = `http://127.0.0.1:${PORTS.gateway}`

const SECRETS_FILE = join(LOCAL, 'secrets.json')
const ENV_FILE     = join(ROOT, '.env.local')
const ENV_MARKER   = '# Written by scripts/local'

const b64url = input => Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

function signJwt(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body   = b64url(JSON.stringify(payload))
  const sig    = b64url(createHmac('sha256', secret).update(`${header}.${body}`).digest())
  return `${header}.${body}.${sig}`
}

/** Load the local keys, generating them on first run. */
export function loadSecrets() {
  mkdirSync(LOCAL, { recursive: true })
  if (existsSync(SECRETS_FILE)) return JSON.parse(readFileSync(SECRETS_FILE, 'utf8'))

  const jwtSecret = randomBytes(32).toString('hex')
  const iat = Math.floor(Date.now() / 1000)
  const exp = iat + 60 * 60 * 24 * 365 * 10
  const secrets = {
    jwtSecret,
    // The same two kinds of key a Supabase project issues. The app's server client uses the
    // service_role one; PostgREST switches to that role and it bypasses RLS, as in production.
    serviceRoleKey: signJwt({ role: 'service_role', iss: 'local-platform', iat, exp }, jwtSecret),
    anonKey:        signJwt({ role: 'anon',         iss: 'local-platform', iat, exp }, jwtSecret),
    sessionSecret:  randomBytes(32).toString('hex'),
    cronSecret:     randomBytes(24).toString('hex'),
  }
  writeFileSync(SECRETS_FILE, JSON.stringify(secrets, null, 2))
  return secrets
}

function parseEnv(text) {
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

const isLocalUrl = url => {
  try { return ['127.0.0.1', 'localhost'].includes(new URL(url).hostname) } catch { return false }
}

/**
 * Make sure .env.local points the app at the local platform — and refuse to go on if it points at a
 * real database. A local run must never read or write production.
 */
export function ensureEnvFile(secrets) {
  const wanted = [
    ENV_MARKER + ' — points this checkout at the LOCAL platform (npm run local:up). Safe to delete.',
    `NEXT_PUBLIC_SUPABASE_URL=${GATEWAY_URL}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${secrets.anonKey}`,
    `SUPABASE_SECRET_KEY=${secrets.serviceRoleKey}`,
    `SESSION_SECRET=${secrets.sessionSecret}`,
    `CRON_SECRET=${secrets.cronSecret}`,
    `NEXT_PUBLIC_APP_URL=http://localhost:${PORTS.app}`,
    '',
  ].join('\n')

  if (existsSync(ENV_FILE)) {
    const current = readFileSync(ENV_FILE, 'utf8')
    const url = parseEnv(current).NEXT_PUBLIC_SUPABASE_URL
    if (url && !isLocalUrl(url)) {
      throw new Error(
        `.env.local points at ${new URL(url).hostname}, not the local platform. `
        + 'Refusing to start: a local run must never touch a real database. '
        + 'Move that file aside (e.g. rename it to .env.local.remote) and run again.',
      )
    }
    if (!current.startsWith(ENV_MARKER)) {
      throw new Error('.env.local exists and was not written by the local platform. Move it aside and run again.')
    }
    if (current === wanted) return
  }
  writeFileSync(ENV_FILE, wanted)
  console.log('Wrote .env.local for the local platform.')
}
