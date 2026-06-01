// GET /api/admin/ad-fuel/pending-ach
//
// Two responsibilities:
//   1. For any open Stripe invoice (last 14 days) with a non-canceled payment
//      intent, auto-create a pending ledger entry if one doesn't exist yet.
//   2. Return { pending: { clientId: amount } } — all ach_status='pending'
//      ledger entries per client, shown as projected balance (not confirmed).

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { isAdminAuthed } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { getStripeClient, isAdFuelLine } from '@/lib/stripe'
import type Stripe from 'stripe'

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const debug = new URL(request.url).searchParams.get('debug') === '1'
  const db = createAdminClient()

  const debugLog: unknown[] = []

  // ── Step 1: detect open Stripe invoices with ACH in-flight ──────────────────
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

      // No created filter — subscription update invoices carry the subscription's
      // original created date (e.g. 2024), not today's date, so a date filter
      // would silently exclude them. open + non-canceled payment_intent is the
      // correct gate: it means a payment is actively in-flight right now.
      const invoices = await stripe.invoices.list({
        status: 'open',
        limit:  100,
        expand: ['data.payment_intent'],
      })

      if (debug) debugLog.push({ total_open_invoices: invoices.data.length, known_customer_ids: Object.keys(customerToClient) })

      for (const inv of invoices.data) {
        const raw = (inv as unknown as { payment_intent?: Stripe.PaymentIntent | string | null }).payment_intent
        const pi  = raw && typeof raw === 'object' ? raw as Stripe.PaymentIntent : null

        const customerId = typeof inv.customer === 'string'
          ? inv.customer
          : (inv.customer as Stripe.Customer | null)?.id

        const clientId = customerId ? customerToClient[customerId] : undefined

        // Compute ad fuel total from all lines (subscription invoices paginate lines,
        // but first page covers nearly all real cases — usually 1-3 lines per invoice)
        let totalAf = 0
        const lineDetails: unknown[] = []
        for (const line of inv.lines.data) {
          const passes = isAdFuelLine(line) && (line.amount ?? 0) > 0
          if (debug) lineDetails.push({ desc: line.description, amount: line.amount, passes_ad_fuel_check: passes })
          if (passes) totalAf += line.amount / 100
        }

        if (debug) {
          debugLog.push({
            invoice_id:   inv.id,
            invoice_number: inv.number,
            customer_id:  customerId,
            client_id:    clientId ?? 'NOT FOUND IN DB',
            pi_status:    pi?.status ?? 'NO PAYMENT INTENT',
            created:      new Date(inv.created * 1000).toISOString().slice(0, 10),
            total_af:     totalAf,
            lines:        lineDetails,
            skip_reason:
              !pi                  ? 'no payment_intent' :
              pi.status === 'canceled' ? 'payment_intent canceled' :
              !customerId          ? 'no customer on invoice' :
              !clientId            ? 'customer not in clients table' :
              totalAf <= 0         ? 'no ad fuel line items found' :
              null,
          })
        }

        if (!pi || pi.status === 'canceled') continue
        if (!customerId || !clientId) continue
        if (totalAf <= 0) continue

        const { data: existing } = await db
          .from('ad_fuel_ledger')
          .select('id')
          .eq('invoice_id', inv.id)
          .eq('client_id', clientId)
          .maybeSingle()
        if (existing) {
          if (debug) debugLog.push({ invoice_id: inv.id, skip_reason: 'already in ledger' })
          continue
        }

        const invoiceDate = new Date(inv.created * 1000).toISOString().slice(0, 10)

        await db.from('ad_fuel_ledger').insert({
          client_id:       clientId,
          date_of_payment: null,
          invoice_date:    invoiceDate,
          amount_af:       totalAf,
          invoice_id:      inv.id,
          ach_status:      'pending',
          type:            'ACH',
          created_by:      'auto-ach',
          note:            `ACH pending — ${inv.number ?? inv.id}`,
        })

        console.log(`[pending-ach] inserted pending entry for invoice ${inv.id}, client ${clientId}, amount ${totalAf}`)
        if (debug) debugLog.push({ inserted: inv.id, client_id: clientId, amount_af: totalAf })
      }
    }
  } catch (stripeErr) {
    console.error('[pending-ach] Stripe step failed:', stripeErr)
    if (debug) debugLog.push({ error: String(stripeErr) })
  }

  // ── Step 2: return all pending ledger amounts ────────────────────────────────
  const { data: pendingRows } = await db
    .from('ad_fuel_ledger')
    .select('client_id, amount_af')
    .eq('ach_status', 'pending')

  const pending: Record<string, number> = {}
  for (const row of (pendingRows ?? []) as { client_id: string; amount_af: number }[]) {
    pending[row.client_id] = (pending[row.client_id] ?? 0) + Number(row.amount_af)
  }

  if (debug) return NextResponse.json({ pending, debug: debugLog })
  return NextResponse.json({ pending })
}
