import { NextRequest, NextResponse }  from 'next/server'
import { createAdminClient }          from '@/lib/supabase/server'
import { isAdminAuthed }              from '@/lib/auth'
import { createHash, randomBytes }    from 'crypto'

export async function GET(req: NextRequest) {
  if (!isAdminAuthed(req.cookies.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = req.cookies.get('admin_user_id')?.value
  if (!userId) return NextResponse.json({ error: 'No user account' }, { status: 403 })

  const db = createAdminClient()
  const { data, error } = await db
    .from('mcp_tokens')
    .select('id, token_prefix, label, created_at, last_used_at')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tokens: data ?? [] })
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthed(req.cookies.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = req.cookies.get('admin_user_id')?.value
  if (!userId) return NextResponse.json({ error: 'No user account' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const label = String(body.label ?? '').trim() || 'My Token'

  const rawToken   = 'mcp_' + randomBytes(32).toString('hex')
  const tokenHash  = createHash('sha256').update(rawToken).digest('hex')
  const tokenPrefix = rawToken.slice(0, 16)

  const db = createAdminClient()
  const { error } = await db.from('mcp_tokens').insert({
    user_id:      userId,
    token_hash:   tokenHash,
    token_prefix: tokenPrefix,
    label,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ token: rawToken, prefix: tokenPrefix, label })
}
