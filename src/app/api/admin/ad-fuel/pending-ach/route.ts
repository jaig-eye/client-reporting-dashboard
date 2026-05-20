// GET /api/admin/ad-fuel/pending-ach
//
// Two responsibilities:
//   1. For each Stripe invoice with ACH in-flight (payment_intent.status = 'processing'),
//      auto-create a pending ledger entry if one doesn't exist yet.
//      This lets the balance count the incoming funds immediately — on invoice day.
//   2. Return { pending: { clientId: amount } } — the sum of all ach_status='pending'
//      ledger entries per client (already in the balance, but not yet bank-confirmed).

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

  const db = createAdminClient()

  // ── Step 1: detect new ACH-processing invoices and insert pending ledger entries ──
  const stripe = await getStripeClient()
  if (stripe) {
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

    for (const inv of invoices.data) {
      const raw = (inv as unknown as { payment_intent?: Stripe.PaymentIntent | string | null }).payment_intent
      const pi  = raw && typeof raw === 'object' ? raw as Stripe.PaymentIntent : null
      if (pi?.status !== 'processing') continue

      const customerId = typeof inv.customer === 'string'
        ? inv.customer
        : (inv.customer as Stripe.Customer | null)?.id
      if (!customerId) continue
      const clientId = customerToClient[customerId]
      if (!clientId) continue

      // Deduplicate — only insert if no ledger entry for this invoice yet
      const { data: existing } = await db
        .from('ad_fuel_ledger')
        .select('id')
        .eq('invoice_id', inv.id)
        .eq('client_id', clientId)
        .maybeSingle()
      if (existing) continue

      let totalAf = 0
      for (const line of inv.lines.data) {
        if (!isAdFuelLine(line) || (line.amount ?? 0) <= 0) continue
        totalAf += line.amount / 100
      }
      if (totalAf <= 0) continue

      const invoiceDate  = new Date(inv.created * 1000).toISOString().slice(0, 10)
      const isRecurring  = inv.lines.data.length > 1

      await db.from('ad_fuel_ledger').insert({
        client_id:             clientId,
        date_of_payment:       invoiceDate,
        invoice_date:          invoiceDate,
        amount_af:             totalAf,
        invoice_id:            inv.id,
        ach_status:            'pending',
        type:                  isRecurring ? 'MRR' : 'One-Time',
        created_by:            'auto-ach',
        note:                  `ACH pending — ${inv.number ?? inv.id}`,
      })
    }
  }

  // ── Step 2: return pending ledger amounts (already counted in balance) ──
  const { data: pendingRows } = await db
    .from('ad_fuel_ledger')
    .select('client_id, amount_af')
    .eq('ach_status', 'pending')

  const pending: Record<string, number> = {}
  for (const row of (pendingRows ?? []) as { client_id: string; amount_af: number }[]) {
    pending[row.client_id] = (pending[row.client_id] ?? 0) + Number(row.amount_af)
  }

  return NextResponse.json({ pending })
}
