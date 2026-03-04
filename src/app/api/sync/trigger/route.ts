import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { syncClient } from '@/lib/sync'

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')?.value
  if (!session || session !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { clientId, days, dateStart, dateEnd } = await request.json()
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  try {
    const records = await syncClient(clientId, parseInt(days) || 30, undefined, dateStart, dateEnd)
    return NextResponse.json({ success: true, records })
  } catch (e) {
    console.error('Sync error:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
