// npm run local:setup — one-time install of the local platform's tools into .local/ (git-ignored).
//
// Kept out of the app's own dependencies on purpose: nothing here is installed on Vercel or shipped.

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOCAL } from './db.mjs'

// Postgres 17 — the major version production runs.
const PG_VERSION        = '17.10.0-beta.17'
// The PostgREST line Supabase runs. Newer releases work too, but this keeps local behaviour closest.
const POSTGREST_VERSION = 'v12.2.12'

if (process.platform !== 'win32') {
  console.error('The local platform is set up for Windows so far. See docs/LOCAL-PLATFORM.md.')
  process.exit(1)
}

const TOOLS     = join(LOCAL, 'tools')
const DOWNLOADS = join(LOCAL, 'downloads')
const BIN       = join(LOCAL, 'bin', 'v12')
for (const dir of [TOOLS, DOWNLOADS, BIN]) mkdirSync(dir, { recursive: true })

if (!existsSync(join(TOOLS, 'package.json'))) {
  writeFileSync(join(TOOLS, 'package.json'), JSON.stringify({ name: 'local-platform-tools', private: true }, null, 2))
}

console.log(`Installing portable Postgres ${PG_VERSION}…`)
execSync(`npm install --prefix "${TOOLS}" --no-audit --no-fund embedded-postgres@${PG_VERSION} pg`, { stdio: 'inherit' })

const exe = join(BIN, 'postgrest.exe')
if (existsSync(exe)) {
  console.log(`PostgREST ${POSTGREST_VERSION} already present.`)
} else {
  const url = `https://github.com/PostgREST/postgrest/releases/download/${POSTGREST_VERSION}/postgrest-${POSTGREST_VERSION}-windows-x86-64.zip`
  console.log(`Downloading PostgREST ${POSTGREST_VERSION}…`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`PostgREST download failed: HTTP ${res.status}`)
  const zip = join(DOWNLOADS, `postgrest-${POSTGREST_VERSION}.zip`)
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()))
  execSync(`powershell.exe -NoProfile -Command "Expand-Archive -Path '${zip}' -DestinationPath '${BIN}' -Force"`, { stdio: 'inherit' })
}

console.log('\nLocal tools ready. Next: npm run local:up')
