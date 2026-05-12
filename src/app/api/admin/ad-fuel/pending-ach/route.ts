import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { isAdminAuthed } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { getStripeClient, isAdFuelLine } from '@/lib/stripe'
import type Stripe from 'stripe'

export async function GET(_request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const stripe = await getStripeClient()
  if (!stripe) return NextResponse.json({ pending: {} })

  const db = createAdminClient()
  const { data: clients } = await db
    .from('clients')
    .select('id, stripe_customer_id')
    .not('stripe_customer_id', 'is', null)

  const customerToClient: Record<string, string> = {}
  for (const c of (clients ?? []) as { id: string; stripe_customer_id: string }[]) {
    customerToClient[c.stripe_customer_id] = c.id
  }

  const invoices = await stripe.invoices.list({
    status: 'open',
    limit:  100,
    expand: ['data.payment_intent'],
  })

  const pending: Record<string, number> = {}
  for (const inv of invoices.data) {
    const raw = (inv as unknown as { payment_intent?: Stripe.PaymentIntent | string | null }).payment_intent
    const pi  = raw && typeof raw === 'object' ? raw as Stripe.PaymentIntent : null
    if (pi?.status !== 'processing') continue
    const customerId = typeof inv.customer === 'string' ? inv.customer : (inv.customer as Stripe.Customer | null)?.id
    if (!customerId) continue
    const clientId = customerToClient[customerId]
    if (!clientId) continue
    for (const line of inv.lines.data) {
      if (!isAdFuelLine(line) || (line.amount ?? 0) <= 0) continue
      pending[clientId] = (pending[clientId] ?? 0) + line.amount / 100
    }
  }

  return NextResponse.json({ pending })
}
