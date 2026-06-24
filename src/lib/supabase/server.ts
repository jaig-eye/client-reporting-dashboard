import { createClient } from '@supabase/supabase-js'

// All server-side DB access uses the secret API key.
// Access control is handled at the app layer via dashboard tokens.
// Singleton: module state is per-invocation in serverless, so this avoids re-creating
// the client object on every createAdminClient() call within the same request.
let _adminClient: ReturnType<typeof createClient> | null = null

export function createAdminClient() {
  if (_adminClient) return _adminClient
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error(
    `Missing Supabase env vars: ${!url ? 'NEXT_PUBLIC_SUPABASE_URL ' : ''}${!key ? 'SUPABASE_SECRET_KEY' : ''}`.trim()
  )
  _adminClient = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
  return _adminClient
}
