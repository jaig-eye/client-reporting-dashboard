// npm run local:up — the whole platform on this machine, against a local database with fake data.
//
//   npm run local:up             database, API, gateway and the app (http://localhost:3000)
//   npm run local:up -- --no-app database, API and gateway only
//
// Ctrl+C stops everything. Nothing here can reach production: .env.local is written to point at
// 127.0.0.1, and startup is refused if it points anywhere else.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, delimiter } from 'node:path'
import { startDatabase, migrate, DB, ROOT, LOCAL } from './db.mjs'
import { loadSecrets, ensureEnvFile, PORTS, GATEWAY_URL } from './config.mjs'
import { startGateway } from './gateway.mjs'

if (process.platform !== 'win32') {
  console.error('The local platform is set up for Windows so far (portable Postgres + PostgREST builds). See docs/LOCAL-PLATFORM.md.')
  process.exit(1)
}

const withApp       = !process.argv.includes('--no-app')
const POSTGREST_EXE = join(LOCAL, 'bin', 'v12', 'postgrest.exe')
// PostgREST loads libpq.dll at start. The portable Postgres ships it, with the OpenSSL DLLs it needs.
const PG_BIN        = join(LOCAL, 'tools', 'node_modules', '@embedded-postgres', 'windows-x64', 'native', 'bin')

if (!existsSync(POSTGREST_EXE) || !existsSync(PG_BIN)) {
  console.error('Local tools are not installed. Run: npm run local:setup')
  process.exit(1)
}

const secrets = loadSecrets()
ensureEnvFile(secrets)

const { server: database, pg } = await startDatabase()
const children = []
let gateway
let stopping = false

async function stopAll(code) {
  if (stopping) return
  stopping = true
  console.log('\nStopping the local platform…')
  for (const child of children) { try { child.kill() } catch { /* already gone */ } }
  if (gateway) gateway.close()
  await database.stop().catch(() => {})
  process.exit(code)
}
process.on('SIGINT',  () => stopAll(0))
process.on('SIGTERM', () => stopAll(0))

try {
  await migrate(pg)
} catch (e) {
  console.error(`\nMIGRATION FAILED — ${e.message}`)
  await stopAll(1)
}

// ── PostgREST ─────────────────────────────────────────────────────────────────────
const postgrest = spawn(POSTGREST_EXE, [], {
  env: {
    ...process.env,
    PATH:               `${PG_BIN}${delimiter}${process.env.PATH ?? ''}`,
    PGRST_DB_URI:       `postgres://authenticator:authenticator@${DB.host}:${DB.port}/${DB.database}`,
    PGRST_DB_SCHEMAS:   'public',
    PGRST_DB_ANON_ROLE: 'anon',
    PGRST_JWT_SECRET:   secrets.jwtSecret,
    PGRST_SERVER_HOST:  '127.0.0.1',
    PGRST_SERVER_PORT:  String(PORTS.postgrest),
    PGRST_LOG_LEVEL:    'warn',
  },
  stdio: ['ignore', 'inherit', 'inherit'],
})
children.push(postgrest)
postgrest.on('exit', code => { if (!stopping) { console.error(`PostgREST stopped unexpectedly (exit ${code}).`); stopAll(1) } })

async function waitFor(url, label, timeoutMs = 30_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.status < 500) return } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 300))
  }
  throw new Error(`${label} did not start within ${timeoutMs / 1000}s`)
}

try {
  await waitFor(`http://127.0.0.1:${PORTS.postgrest}/`, 'PostgREST')
  gateway = await startGateway()
} catch (e) {
  console.error(e.message)
  await stopAll(1)
}

console.log(`\nLocal platform running`)
console.log(`  database  postgres://${DB.user}:${DB.password}@${DB.host}:${DB.port}/${DB.database}`)
console.log(`  API       ${GATEWAY_URL}  (stands in for Supabase)`)

// ── The app ───────────────────────────────────────────────────────────────────────
if (withApp) {
  console.log(`  app       http://localhost:${PORTS.app}\n`)
  const app = spawn('npm', ['run', 'dev', '--', '-p', String(PORTS.app)], {
    cwd: ROOT, stdio: 'inherit', shell: true, env: process.env,
  })
  children.push(app)
  app.on('exit', code => { if (!stopping) stopAll(code ?? 0) })
} else {
  console.log('  app       not started (--no-app). Run `npm run dev` separately.\n')
}
