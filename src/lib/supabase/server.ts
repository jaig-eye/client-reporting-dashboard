import { createClient } from '@supabase/supabase-js'

// All server-side DB access uses the secret API key.
// Access control is handled at the app layer via dashboard tokens.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error(
    `Missing Supabase env vars: ${!url ? 'NEXT_PUBLIC_SUPABASE_URL ' : ''}${!key ? 'SUPABASE_SECRET_KEY' : ''}`.trim()
  )
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    // Never serve a read from Next's Data Cache.
    //
    // Next patches the global fetch inside route handlers and server components, and supabase-js
    // has no fetch of its own, so every query made through this client was a cacheable GET.
    // `export const dynamic = 'force-dynamic'` does not cover it — that governs whether the ROUTE
    // is re-run, not whether the fetches inside it are served from cache. The effect was a write
    // that succeeded and a read that kept insisting nothing had changed: remove a keyword, watch
    // it come back ticked, reload the page, still there. The database was right the whole time.
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, cache: 'no-store' }),
    },
  })
}
