import { createClient } from '@supabase/supabase-js'

// All server-side DB access uses the secret API key.
// Access control is handled at the app layer via dashboard tokens.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error(
    `Missing Supabase env vars: ${!url ? 'NEXT_PUBLIC_SUPABASE_URL ' : ''}${!key ? 'SUPABASE_SECRET_KEY' : ''}`.trim()
  )
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}
