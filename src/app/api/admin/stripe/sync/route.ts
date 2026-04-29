import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { isAdminAuthed } from '@/lib/auth'
import { getStripeClient, syncStripeInvoicesForClient } from '@/lib/stripe'

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { clientId } = await req.json()
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  const stripe = await getStripeClient()
  if (!stripe) return NextResponse.json({ error: 'Stripe not configured — add stripe_api_key in Agency Settings' }, { status: 400 })

  const inserted = await syncStripeInvoicesForClient(clientId, stripe)
  return NextResponse.json({ success: true, inserted })
}
