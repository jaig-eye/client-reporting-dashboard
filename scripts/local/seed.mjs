// npm run local:seed — fills the LOCAL database with realistic fake data so every page renders.
//
// Idempotent: re-running updates the same rows rather than piling up duplicates. Refuses to run
// against anything but the local database on 127.0.0.1. Works whether or not `local:up` is running.

import { createRequire } from 'node:module'
import { join } from 'node:path'
import { ROOT, DB, startDatabase } from './db.mjs'

const requireFromApp = createRequire(join(ROOT, 'package.json'))
const bcrypt = requireFromApp('bcryptjs')

// ── Test accounts ─────────────────────────────────────────────────────────────────
// Local-only credentials. They exist in .local/pgdata and nowhere else.
export const LOCAL_ACCOUNTS = [
  { email: 'admin@local.test',  username: 'localadmin',  name: 'Local Admin',  role: 'admin',  password: 'local-admin-123' },
  { email: 'viewer@local.test', username: 'localviewer', name: 'Local Viewer', role: 'viewer', password: 'local-viewer-123' },
]

async function seedAccounts(c) {
  for (const a of LOCAL_ACCOUNTS) {
    await c.query(
      `INSERT INTO users (email, username, name, password_hash, role, is_active, must_reset_password)
       VALUES ($1, $2, $3, $4, $5, true, false)
       ON CONFLICT (email) DO UPDATE SET
         username = EXCLUDED.username, name = EXCLUDED.name, password_hash = EXCLUDED.password_hash,
         role = EXCLUDED.role, is_active = true, must_reset_password = false, password_changed_at = NULL`,
      [a.email, a.username, a.name, bcrypt.hashSync(a.password, 10), a.role],
    )
  }
  return LOCAL_ACCOUNTS.length
}

// ── Run ───────────────────────────────────────────────────────────────────────────
async function connect(pg) {
  const c = new pg.Client(DB)
  await c.connect()
  return c
}

const pg = createRequire(join(ROOT, '.local', 'tools', 'node_modules', 'pg', 'package.json'))('pg')

let startedHere = null
let c
try {
  c = await connect(pg)
} catch (e) {
  if (e.code !== 'ECONNREFUSED') throw e
  // local:up is not running — start the database just for the seed.
  startedHere = (await startDatabase()).server
  c = await connect(pg)
}

try {
  if (DB.host !== '127.0.0.1') throw new Error('Refusing to seed a non-local database.')
  const accounts = await seedAccounts(c)
  console.log(`Seeded: ${accounts} test accounts`)
  for (const a of LOCAL_ACCOUNTS) console.log(`  ${a.role.padEnd(6)} ${a.email}  /  ${a.password}`)
} finally {
  await c.end()
  if (startedHere) await startedHere.stop()
}
