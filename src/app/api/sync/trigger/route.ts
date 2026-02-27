import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'
import { syncClient } from '@/lib/sync'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await request.formData()
  const clientId = formData.get('clientId') as string

  try {
    await syncClient(clientId, 30)
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/admin?synced=${clientId}`)
  } catch (e) {
    console.error('Sync error:', e)
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/admin?error=sync_failed`)
  }
}
