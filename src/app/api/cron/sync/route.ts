import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { syncClient } from '@/lib/sync'

// Called daily by Vercel Cron (vercel.json)
export async function GET(request: NextRequest) {
  // Verify cron secret to prevent unauthorized calls
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()
  const { data: clients } = await db.from('clients').select('id, name')

  const results = []
  for (const client of clients || []) {
    try {
      const count = await syncClient(client.id, 1) // sync last 1 day incrementally
      results.push({ client: client.name, status: 'success', records: count })
    } catch (e) {
      results.push({ client: client.name, status: 'error', error: String(e) })
    }
  }

  return NextResponse.json({ synced: results.length, results })
}
