import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { syncClient } from '@/lib/sync'

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')?.value
  if (!session || session !== process.env.ADMIN_PASSWORD) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/admin/login`)
  }

  const formData = await request.formData()
  const clientId = formData.get('clientId') as string
  const days = parseInt(formData.get('days') as string || '30')

  try {
    await syncClient(clientId, days)
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/admin/clients/${clientId}?synced=true`)
  } catch (e) {
    console.error('Sync error:', e)
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/admin/clients/${clientId}?error=sync_failed`)
  }
}
