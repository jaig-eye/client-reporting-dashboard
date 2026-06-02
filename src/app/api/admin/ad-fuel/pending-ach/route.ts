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

  const { error: insertError } = await db.from('ad_fuel_ledger').insert({
    client_id:       clientId,
    date_of_payment: invoiceDate,  // use invoice date as placeholder; updated to real payment date when ACH clears
    invoice_date:    invoiceDate,
    amount_af:       totalAf,
    invoice_id:      inv.id,
    ach_status:      'pending',
    type:            'ACH',
    created_by:      'auto-ach',
    note:            `ACH pending — ${inv.number ?? inv.id}`,
  })

  if (insertError) {
    console.error(`[pending-ach] insert failed for invoice ${inv.id}:`, insertError.message)
    if (debug) debugLog.push({ source, invoice_id: inv.id, insert_error: insertError.message })
    return false
  }

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

      // Track inserted invoice IDs so Path B doesn't duplicate what Path A inserted
      const insertedInvoiceIds = new Set<string>()

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
            piStatus === 'canceled' ? 'payment_intent canceled' :
            !customerId            ? 'no customer on invoice' :
            !clientId              ? 'customer not mapped to client' :
            null,
        })

        if (pi && piStatus === 'canceled') continue
        if (!customerId || !clientId) continue

        const inserted = await tryInsert(db, inv, clientId, debugLog, debug, 'open_invoices')
        if (inserted) insertedInvoiceIds.add(inv.id)
      }

      // ── Path B: subscriptions → latest_invoice (retrieved directly) ────────────
      // Stripe does not reliably expand payment_intent when nested inside
      // subscriptions.list() — it returns null even when a payment exists.
      // Fix: list subscriptions to get the invoice ID, then retrieve the full
      // invoice directly so payment_intent and product data expand correctly.
      const subs = await stripe.subscriptions.list({
        status: 'all',
        limit:  100,
        expand: ['data.latest_invoice'],  // just enough to get the invoice ID + status
      })

      if (debug) debugLog.push({ path: 'B_subscriptions', total: subs.data.length })

      for (const sub of subs.data) {
        const latestInv = sub.latest_invoice && typeof sub.latest_invoice === 'object'
          ? sub.latest_invoice as Stripe.Invoice
          : null
        if (!latestInv || latestInv.status !== 'open') {
          if (debug && latestInv) debugLog.push({ path: 'B', subscription_id: sub.id, invoice_id: latestInv.id, skip: `invoice status=${latestInv.status}` })
          continue
        }

        const customerId = typeof sub.customer === 'string'
          ? sub.customer
          : (sub.customer as Stripe.Customer | null)?.id
        const clientId = customerId ? customerToClient[customerId] : undefined

        if (!customerId || !clientId) {
          if (debug) debugLog.push({ path: 'B', subscription_id: sub.id, invoice_id: latestInv.id, customer_id: customerId, skip: !customerId ? 'no customer' : 'customer not mapped to client' })
          continue
        }

        // Skip if Path A already handled this invoice in this same request
        if (insertedInvoiceIds.has(latestInv.id)) {
          if (debug) debugLog.push({ path: 'B', subscription_id: sub.id, invoice_id: latestInv.id, skip: 'already handled by path A' })
          continue
        }

        // Retrieve the full invoice directly — nested expand in subscriptions.list()
        // does not reliably populate payment_intent
        const inv = await stripe.invoices.retrieve(latestInv.id, {
          expand: [
            'payment_intent',
            'lines.data.pricing.price_details.price.product',
          ],
        })

        const raw = (inv as unknown as { payment_intent?: Stripe.PaymentIntent | string | null }).payment_intent
        const pi  = raw && typeof raw === 'object' ? raw as Stripe.PaymentIntent : null
        const piStatus = pi?.status ?? null

        // ACH Credit Transfer invoices have no payment_intent — the customer pushes
        // money to Stripe's bank account and Stripe marks the invoice paid on arrival.
        // We detect any open invoice for a known client; the cron resolves it when paid.
        if (pi && piStatus === 'canceled') {
          if (debug) debugLog.push({ path: 'B', invoice_id: inv.id, skip: 'payment_intent canceled' })
          continue
        }

        if (debug) debugLog.push({
          path: 'B', subscription_id: sub.id, invoice_id: inv.id, invoice_number: inv.number,
          customer_id: customerId, client_id: clientId, pi_status: piStatus,
        })

        const inserted = await tryInsert(db, inv, clientId, debugLog, debug, 'subscription')
        if (inserted) insertedInvoiceIds.add(inv.id)
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
