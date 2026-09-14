// Local-only platform — the database half.
//
// A portable Postgres 17 (same major version as production) running from .local/tools, with its
// data in .local/pgdata. Both are git-ignored. Nothing here can reach a production database: the
// connection details are fixed to 127.0.0.1 and a port no hosted service uses.

import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'

export const ROOT     = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const LOCAL    = join(ROOT, '.local')
export const DATA_DIR = join(LOCAL, 'pgdata')
const TOOLS           = join(LOCAL, 'tools', 'node_modules')

export const DB = {
  host:     '127.0.0.1',
  port:     54322,
  user:     'postgres',
  password: 'postgres',
  database: 'postgres',
}

const require = createRequire(import.meta.url)

async function loadTools() {
  if (!existsSync(join(TOOLS, 'embedded-postgres'))) {
    throw new Error('Local tools are not installed. Run: npm run local:setup')
  }
  const { default: EmbeddedPostgres } = await import(
    pathToFileURL(join(TOOLS, 'embedded-postgres', 'dist', 'index.js')).href
  )
  const pg = require(join(TOOLS, 'pg'))
  return { EmbeddedPostgres, pg }
}

/** Start the local cluster, creating it on first run. Returns the server handle and the pg module. */
export async function startDatabase() {
  const { EmbeddedPostgres, pg } = await loadTools()

  const server = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    port:        DB.port,
    user:        DB.user,
    password:    DB.password,
    persistent:  true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    // Postgres writes its routine log to stderr. Only surface what means something is wrong;
    // query errors from migrations are reported by the runner with the file name attached.
    onLog:   () => {},
    onError: m => {
      const s = String(m instanceof Error ? m.message : m).trim()
      if (/\b(FATAL|PANIC)\b/.test(s)) console.error(`[postgres] ${s}`)
    },
  })

  if (!existsSync(join(DATA_DIR, 'PG_VERSION'))) {
    console.log('Creating the local database (first run only)…')
    await server.initialise()
  }
  await server.start()
  return { server, pg }
}

/**
 * Bootstrap what Supabase would provide, then apply every migration not yet applied, in filename
 * order. Stops at the first failure and says which file, and where in it.
 */
export async function migrate(pg, { log = console.log } = {}) {
  const client = new pg.Client(DB)
  await client.connect()

  try {
    await client.query(readFileSync(join(ROOT, 'scripts', 'local', 'bootstrap.sql'), 'utf8'))

    const applied = new Set(
      (await client.query('SELECT name FROM local_meta.migrations')).rows.map(r => r.name),
    )
    const dir   = join(ROOT, 'supabase', 'migrations')
    const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()

    let count = 0
    for (const file of files) {
      if (applied.has(file)) continue
      // A migration that cannot run on a plain Postgres gets a replacement in scripts/local/overrides,
      // with the reason written at the top of the file. supabase/migrations is production history and is
      // never edited for local use.
      const override      = join(ROOT, 'scripts', 'local', 'overrides', file)
      const usingOverride = existsSync(override)
      const sql           = readFileSync(usingOverride ? override : join(dir, file), 'utf8')
      if (usingOverride) log(`  ${file} — using local override`)

      // A file that manages its own transaction, or builds an index CONCURRENTLY, cannot be
      // wrapped in one.
      const ownsTransaction = /\bCONCURRENTLY\b/i.test(sql) || /^\s*(BEGIN|COMMIT)\s*;/im.test(sql)

      try {
        if (!ownsTransaction) await client.query('BEGIN')
        await client.query(sql)
        await client.query('INSERT INTO local_meta.migrations (name) VALUES ($1)', [file])
        if (!ownsTransaction) await client.query('COMMIT')
        count++
      } catch (e) {
        if (!ownsTransaction) await client.query('ROLLBACK').catch(() => {})
        const pos = Number(e.position)
        const near = Number.isFinite(pos) && pos > 0
          ? `\n  near: …${sql.slice(Math.max(0, pos - 120), pos + 60).replace(/\s+/g, ' ')}…`
          : ''
        throw new Error(`${file}\n  ${e.message}${near}`)
      }
    }

    // Objects production has that no migration creates — see scripts/local/extras. Each file is
    // idempotent and says what it inferred, so it runs on every migrate rather than once.
    const extrasDir = join(ROOT, 'scripts', 'local', 'extras')
    const extras    = existsSync(extrasDir) ? readdirSync(extrasDir).filter(f => f.endsWith('.sql')).sort() : []
    for (const file of extras) {
      try {
        await client.query(readFileSync(join(extrasDir, file), 'utf8'))
      } catch (e) {
        throw new Error(`extras/${file}
  ${e.message}`)
      }
    }

    log(`Migrations: ${count} applied now, ${files.length} in total.` + (extras.length ? ` Local extras: ${extras.length}.` : ''))
    return { applied: count, total: files.length }
  } finally {
    await client.end()
  }
}
