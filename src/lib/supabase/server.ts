import { createClient } from '@supabase/supabase-js'

// All server-side DB access uses the service role key.
// This bypasses RLS — access control is handled at the app layer via dashboard tokens.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
