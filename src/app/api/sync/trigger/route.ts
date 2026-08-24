import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { syncClient } from '@/lib/sync'
import { isAdminAuthed } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  // Verify the signed session token — a raw ADMIN_PASSWORD comparison no longer matches
  // now that admin_session holds a signed token.
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { clientId, days, dateStart, dateEnd, accountId } = await request.json()
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  try {
    const records = await syncClient(clientId, 'manual', parseInt(days) || 30, accountId || undefined, dateStart, dateEnd)
    return NextResponse.json({ success: true, records })
  } catch (e) {
    console.error('Sync error:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
