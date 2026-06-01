// GET /api/admin/ad-fuel/pending-ach
//
// Two responsibilities:
//   1. Detect open/pending ACH invoices in Stripe (two paths):
//      a. stripe.invoices.list(status:'open') — catches manual and one-off invoices
//      b. stripe.subscriptions.list() via latest_invoice — catches subscription billing
//      For each unrecorded invoice with a non-canceled payment_intent, insert a
//      pending ledger entry (date_of_payment=null until ACH clears).
//   2. Return { pending: { clientId: amount } } — all ach_status='pending' ledger
//      entries per client, shown as projected balance (not included in confirmed balance).
//
// Add ?debug=1 to see a full diagnostic breakdown of every invoice checked.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { isAdminAuthed } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { getStripeClient, isAdFuelLine } from '@/lib/stripe'
import type Stripe from 'stripe'

async function tryInsert(
  db: ReturnType<typeof import('@/lib/supabase/server').createAdminClient>,
  inv: Stripe.Invoice,
  clientId: string,
  debugLog: unknown[],
  debug: boolean,
  source: string,
): Promise<boolean> {
  const { data: existing } = await db
    .from('ad_fuel_ledger')
    .select('id')
    .eq('invoice_id', inv.id)
    .eq('client_id', clientId)
    .maybeSingle()

  if (existing) {
    if (debug) debugLog.push({ source, invoice_id: inv.id, skip: 'already in ledger' })
    return false
  }

  let totalAf = 0
  const lineDetails: unknown[] = []
  for (const line of (inv.lines?.data ?? [])) {
    const passes = isAdFuelLine(line) && (line.amount ?? 0) > 0
    if (debug) lineDetails.push({ desc: line.description, amount: line.amount, passes })
    if (passes) totalAf += line.amount / 100
  }

  const hasMore = (inv.lines as unknown as { has_more?: boolean })?.has_more
  if (hasMore) console.warn(`[pending-ach] Invoice ${inv.id} has paginated line items — total may be partial`)

  if (totalAf <= 0) {
    if (debug) debugLog.push({ source, invoice_id: inv.id, skip: 'no ad fuel lines', lines: lineDetails })
    return false
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

  console.log(`[pending-ach] inserted pending entry (${source}) invoice=${inv.id} client=${clientId} amount=${totalAf}`)
  if (debug) debugLog.push({ source, invoice_id: inv.id, inserted: true, amount_af: totalAf, lines: lineDetails })
  return true
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const debug = new URL(request.url).searchParams.get('debug') === '1'
  const db = createAdminClient()
  const debugLog: unknown[] = []

  try {
    const stripe = await getStripeClient()
    if (!stripe) {
      if (debug) debugLog.push({ error: 'Stripe not configured' })
    } else {
      const { data: clients } = await db
        .from('clients')
        .select('id, stripe_customer_id')
        .not('stripe_customer_id', 'is', null)

      const customerToClient: Record<string, string> = {}
      for (const c of (clients ?? []) as { id: string; stripe_customer_id: string }[]) {
        customerToClient[c.stripe_customer_id] = c.id
      }

      if (debug) debugLog.push({ known_stripe_customers: Object.keys(customerToClient) })

      // ── Path A: open invoices list ───────────────────────────────────────────
      const openInvoices = await stripe.invoices.list({
        status: 'open',
        limit:  100,
        expand: [
          'data.payment_intent',
          'data.lines.data.pricing.price_details.price.product',
        ],
      })

      if (debug) debugLog.push({ path: 'A_open_invoices', total: openInvoices.data.length })

      for (const inv of openInvoices.data) {
        const raw = (inv as unknown as { payment_intent?: Stripe.PaymentIntent | string | null }).payment_intent
        const pi  = raw && typeof raw === 'object' ? raw as Stripe.PaymentIntent : null
        const piStatus = pi?.status ?? null

        const customerId = typeof inv.customer === 'string'
          ? inv.customer
          : (inv.customer as Stripe.Customer | null)?.id
        const clientId = customerId ? customerToClient[customerId] : undefined

        if (debug) debugLog.push({
          path: 'A', invoice_id: inv.id, invoice_number: inv.number,
          customer_id: customerId, client_id: clientId ?? 'NOT IN DB',
          pi_status: piStatus,
          skip:
            !pi                    ? 'no payment_intent' :
            piStatus === 'canceled' ? 'payment_intent canceled' :
            !customerId            ? 'no customer on invoice' :
            !clientId              ? 'customer not mapped to client' :
            null,
        })

        if (!pi || piStatus === 'canceled') continue
        if (!customerId || !clientId) continue

        await tryInsert(db, inv, clientId, debugLog, debug, 'open_invoices')
      }

      // ── Path B: subscriptions → latest_invoice ───────────────────────────────
      // Catches subscription invoices that may not surface cleanly via invoices.list
      const subs = await stripe.subscriptions.list({
        status: 'all',
        limit:  100,
        expand: [
          'data.latest_invoice.payment_intent',
          'data.latest_invoice.lines.data.pricing.price_details.price.product',
        ],
      })

      if (debug) debugLog.push({ path: 'B_subscriptions', total: subs.data.length })

      for (const sub of subs.data) {
        const inv = sub.latest_invoice && typeof sub.latest_invoice === 'object'
          ? sub.latest_invoice as Stripe.Invoice
          : null
        if (!inv) continue
        if (inv.status !== 'open') {
          if (debug) debugLog.push({ path: 'B', subscription_id: sub.id, invoice_id: (inv as Stripe.Invoice).id, skip: `invoice status=${inv.status}` })
          continue
        }

        const raw = (inv as unknown as { payment_intent?: Stripe.PaymentIntent | string | null }).payment_intent
        const pi  = raw && typeof raw === 'object' ? raw as Stripe.PaymentIntent : null
        const piStatus = pi?.status ?? null

        const customerId = typeof sub.customer === 'string'
          ? sub.customer
          : (sub.customer as Stripe.Customer | null)?.id
        const clientId = customerId ? customerToClient[customerId] : undefined

        if (debug) debugLog.push({
          path: 'B', subscription_id: sub.id, invoice_id: inv.id, invoice_number: inv.number,
          customer_id: customerId, client_id: clientId ?? 'NOT IN DB',
          pi_status: piStatus,
          skip:
            !pi                    ? 'no payment_intent' :
            piStatus === 'canceled' ? 'payment_intent canceled' :
            !customerId            ? 'no customer on subscription' :
            !clientId              ? 'customer not mapped to client' :
            null,
        })

        if (!pi || piStatus === 'canceled') continue
        if (!customerId || !clientId) continue

        await tryInsert(db, inv, clientId, debugLog, debug, 'subscription')
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
