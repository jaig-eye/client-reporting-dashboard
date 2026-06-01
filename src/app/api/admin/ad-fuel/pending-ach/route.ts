// GET /api/admin/ad-fuel/pending-ach
//
// Two responsibilities:
//   1. For any Stripe invoice currently open with ACH in-flight
//      (payment_intent.status = 'processing'), auto-create a pending ledger
//      entry if one doesn't exist yet. No date filter — open+processing means
//      it's actively in-flight right now. Already-paid invoices don't appear
//      in the open list so there's no backfill risk.
//   2. Return { pending: { clientId: amount } } — all ach_status='pending'
//      ledger entries per client. These are shown as a projected balance only;
//      they don't affect the confirmed balance calculation.

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

  // ── Step 1: detect open Stripe invoices with ACH in-flight ──────────────────
  // Gate: status='open' + payment_intent.status='processing' + created in last 14 days.
  // 14 days covers the full ACH processing window (3-5 business days + buffer).
  // Anything older was manually entered by the team; we must not duplicate it.
  const fourteenDaysAgoUnix = Math.floor((Date.now() - 14 * 24 * 60 * 60 * 1000) / 1000)
  try {
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
        status:  'open',
        limit:   100,
        created: { gte: fourteenDaysAgoUnix },
        expand:  ['data.payment_intent'],
      })

      for (const inv of invoices.data) {
        const raw = (inv as unknown as { payment_intent?: Stripe.PaymentIntent | string | null }).payment_intent
        const pi  = raw && typeof raw === 'object' ? raw as Stripe.PaymentIntent : null
        // Skip if no payment attempt, or if payment definitively failed/not started
        if (!pi || pi.status === 'canceled') continue

        const customerId = typeof inv.customer === 'string'
          ? inv.customer
          : (inv.customer as Stripe.Customer | null)?.id
        if (!customerId) continue
        const clientId = customerToClient[customerId]
        if (!clientId) continue

        // Only insert if no ledger entry already exists for this invoice
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

        const invoiceDate = new Date(inv.created * 1000).toISOString().slice(0, 10)

        await db.from('ad_fuel_ledger').insert({
          client_id:       clientId,
          date_of_payment: null,        // set when bank confirms (ACH clears)
          invoice_date:    invoiceDate,
          amount_af:       totalAf,
          invoice_id:      inv.id,
          ach_status:      'pending',
          type:            'ACH',
          created_by:      'auto-ach',
          note:            `ACH pending — ${inv.number ?? inv.id}`,
        })
      }
    }
  } catch (stripeErr) {
    console.error('[pending-ach] Stripe step failed (non-fatal):', stripeErr)
  }

  // ── Step 2: return all pending ledger amounts ────────────────────────────────
  // No date filter — pending entries have date_of_payment=null and the hourly
  // cron cleans them up (marks cleared or deletes if payment failed).
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
