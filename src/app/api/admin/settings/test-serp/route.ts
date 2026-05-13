import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { isAdminAuthed } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { api_key } = (await request.json()) as { api_key?: string }
  if (!api_key) return NextResponse.json({ error: 'Missing api_key' }, { status: 400 })

  try {
    const url = `https://serpapi.com/search.json?q=test&api_key=${encodeURIComponent(api_key)}&num=1&engine=google`
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
