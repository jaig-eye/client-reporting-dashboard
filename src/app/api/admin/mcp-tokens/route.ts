import { NextRequest, NextResponse }  from 'next/server'
import { createAdminClient }          from '@/lib/supabase/server'
import { isAdminAuthed, getVerifiedUserId, requireWriteAdmin } from '@/lib/auth'
import { createHash, randomBytes }    from 'crypto'

export async function GET(req: NextRequest) {
  const session = req.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = getVerifiedUserId(session)
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
  // Minting a long-lived API credential — gate on a verified, non-revoked,
  // non-viewer session so a deactivated/force-reset admin (or a viewer) cannot mint.
  const gate = await requireWriteAdmin()
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status })
  }
  const session = req.cookies.get('admin_session')?.value
  const userId = getVerifiedUserId(session)
  if (!userId) return NextResponse.json({ error: 'No user account' }, { status: 403 })

  const db = createAdminClient()
  const { count } = await db
    .from('mcp_tokens')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('revoked_at', null)
  if ((count ?? 0) >= 10) {
    return NextResponse.json({ error: 'Token limit reached (10 max). Revoke an existing token first.' }, { status: 422 })
  }

  const body = await req.json().catch(() => ({}))
  const label = String(body.label ?? '').trim() || 'My Token'

  const rawToken   = 'mcp_' + randomBytes(32).toString('hex')
  const tokenHash  = createHash('sha256').update(rawToken).digest('hex')
  const tokenPrefix = rawToken.slice(0, 16)

  const { error } = await db.from('mcp_tokens').insert({
    user_id:      userId,
    token_hash:   tokenHash,
    token_prefix: tokenPrefix,
    label,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ token: rawToken, prefix: tokenPrefix, label })
}
