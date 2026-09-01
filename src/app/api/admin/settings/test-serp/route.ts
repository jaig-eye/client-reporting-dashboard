import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { isAdminAuthed } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { SECRET_MASK } from '@/lib/secretMask'

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { api_key } = (await request.json()) as { api_key?: string }
  if (!api_key) return NextResponse.json({ error: 'Missing api_key' }, { status: 400 })

  // The card renders SECRET_MASK for a stored key, so "Test key" on an unedited
  // field posted bullets and this route forwarded them verbatim to serpapi.com —
  // a correctly configured key always reported "Invalid API key". Resolve the mask
  // to the stored value server-side; a real key typed into the box still tests as
  // typed, which is what makes the button useful before saving.
  let keyToTest = api_key
  if (api_key === SECRET_MASK) {
    const db = createAdminClient()
    const { data } = await db.from('agency_settings').select('serp_api_key').maybeSingle()
    const stored = (data as { serp_api_key?: string | null } | null)?.serp_api_key
    if (!stored) return NextResponse.json({ error: 'No SerpAPI key is saved yet' }, { status: 400 })
    keyToTest = stored
  }

  try {
    const url = `https://serpapi.com/search.json?q=test&api_key=${encodeURIComponent(keyToTest)}&num=1&engine=google`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    const data = await res.json() as { error?: string }
    if (!res.ok || data.error) {
      return NextResponse.json({ error: data.error ?? res.statusText }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed to reach SerpAPI — check key or network' }, { status: 502 })
  }
}
