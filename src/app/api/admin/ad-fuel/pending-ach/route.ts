// GET    /api/admin/ad-fuel/pending-ach
//   Read-only — returns { pending: { clientId: amount } } from ad_fuel_ach_pending.
//   Safe to call on every page load. No Stripe API calls.
//
// POST   /api/admin/ad-fuel/pending-ach
//   Triggers Stripe detection: scans open invoices + subscriptions, inserts
//   unrecorded pending entries into ad_fuel_ach_pending, returns { pending }.
//   Add ?debug=1 for full diagnostic breakdown per invoice.
//
// DELETE /api/admin/ad-fuel/pending-ach?id=<uuid>
//   Removes a single pending ACH entry (e.g. manually voided before cron runs).

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { isAdminAuthed } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { getStripeClient, isAdFuelLine } from '@/lib/stripe'
import type Stripe from 'stripe'

type DB = ReturnType<typeof createAdminClient>

function requireAdmin(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  return isAdminAuthed(cookieStore.get('admin_session')?.value)
}

async function getPendingAmounts(db: DB): Promise<Record<string, number>> {
  const { data } = await db
    .from('ad_fuel_ach_pending')
    .select('client_id, amount_af')

  const pending: Record<string, number> = {}
  for (const row of (data ?? []) as { client_id: string; amount_af: number }[]) {
    pending[row.client_id] = (pending[row.client_id] ?? 0) + Number(row.amount_af)
  }
  return pending
}

async function tryInsert(
  db: DB,
  inv: Stripe.Invoice,
  clientId: string,
  debugLog: unknown[],
  debug: boolean,
  source: string,
): Promise<boolean> {
  // Dedup against ad_fuel_ach_pending
  const { data: existing } = await db
    .from('ad_fuel_ach_pending')
    .select('id')
    .eq('invoice_id', inv.id)
    .eq('client_id', clientId)
    .maybeSingle()

  if (existing) {
    if (debug) debugLog.push({ source, invoice_id: inv.id, skip: 'already in pending table' })
    return false
  }

  let totalAf = 0
  const lineDetails: unknown[] = []
  for (const line of (inv.lines?.data ?? [])) {
    const passes = isAdFuelLine(line) && (line.amount ?? 0) > 0
    if (debug) lineDetails.push({ desc: line.description, amount: line.amount, passes })
    if (passes) totalAf += line.amount / 100
  }

  if ((inv.lines as unknown as { has_more?: boolean })?.has_more) {
    console.warn(`[pending-ach] Invoice ${inv.id} has paginated line items — total may be partial`)
  }

  if (totalAf <= 0) {
    if (debug) debugLog.push({ source, invoice_id: inv.id, skip: 'no ad fuel lines', lines: lineDetails })
    return false
  }

  // Scale amount to only what's still owed — handles partial card payments
  const amountDue       = inv.amount_due       ?? 0
  const amountRemaining = inv.amount_remaining ?? amountDue
  if (amountRemaining <= 0) {
    if (debug) debugLog.push({ source, invoice_id: inv.id, skip: 'nothing remaining on invoice' })
    return false
  }
  const remainingRatio = amountDue > 0 ? amountRemaining / amountDue : 1
  const pendingAmount  = Math.round(totalAf * remainingRatio * 100) / 100
  if (pendingAmount <= 0) {
    if (debug) debugLog.push({ source, invoice_id: inv.id, skip: 'pendingAmount scaled to 0' })
    return false
  }

  const invoiceDate = new Date(inv.created * 1000).toISOString().slice(0, 10)

  const { error } = await db.from('ad_fuel_ach_pending').insert({
    client_id:    clientId,
    invoice_id:   inv.id,
    invoice_date: invoiceDate,
    amount_af:    pendingAmount,
    note:         `ACH pending — ${inv.number ?? inv.id}`,
  })

  if (error) {
    console.error(`[pending-ach] insert failed for invoice ${inv.id}:`, error.message)
    if (debug) debugLog.push({ source, invoice_id: inv.id, insert_error: error.message })
    return false
  }

  console.log(`[pending-ach] inserted (${source}) invoice=${inv.id} client=${clientId} amount=${totalAf}`)
  if (debug) debugLog.push({ source, invoice_id: inv.id, inserted: true, amount_af: totalAf, lines: lineDetails })
  return true
}

// ── GET — read-only ──────────────────────────────────────────────────────────

export async function GET(_request: NextRequest) {
  const cookieStore = await cookies()
  if (!requireAdmin(cookieStore))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createAdminClient()
  return NextResponse.json({ pending: await getPendingAmounts(db) })
}

// ── POST — Stripe detection ──────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (!requireAdmin(cookieStore))
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

      const insertedInvoiceIds = new Set<string>()
      const threeDaysAgoUnix = Math.floor((Date.now() - 3 * 24 * 60 * 60 * 1000) / 1000)

      // ── Path A: open invoices list ─────────────────────────────────────────
      const openInvoices = await stripe.invoices.list({
        status:  'open',
        limit:   100,
        created: { gte: threeDaysAgoUnix },
        expand:  [
          'data.payment_intent',
          'data.lines.data.pricing.price_details.price.product',
        ],
      })

      if (debug) debugLog.push({ path: 'A_open_invoices', total: openInvoices.data.length })

      for (const inv of openInvoices.data) {
        const raw      = (inv as unknown as { payment_intent?: Stripe.PaymentIntent | string | null }).payment_intent
        const pi       = raw && typeof raw === 'object' ? raw as Stripe.PaymentIntent : null
        const piStatus = pi?.status ?? null

        const customerId = typeof inv.customer === 'string'
          ? inv.customer
          : (inv.customer as Stripe.Customer | null)?.id
        const clientId = customerId ? customerToClient[customerId] : undefined

        // Allowlist: only genuine ACH states
        // null PI = ACH credit transfer, processing = ACH in-transit, requires_action = bank verification
        const achInFlight = !pi || piStatus === 'processing' || piStatus === 'requires_action'

        if (debug) debugLog.push({
          path: 'A', invoice_id: inv.id, invoice_number: inv.number,
          customer_id: customerId, client_id: clientId ?? 'NOT IN DB', pi_status: piStatus,
          skip: !achInFlight ? `non-ACH payment_intent (${piStatus})` :
                !customerId  ? 'no customer on invoice' :
                !clientId    ? 'customer not mapped to client' : null,
        })

        if (!achInFlight) continue
        if (!customerId || !clientId) continue

        const inserted = await tryInsert(db, inv, clientId, debugLog, debug, 'open_invoices')
        if (inserted) insertedInvoiceIds.add(inv.id)
      }

      // ── Path B: subscriptions → latest_invoice (retrieved directly) ───────
      const subs = await stripe.subscriptions.list({
        status: 'all',
        limit:  100,
        expand: ['data.latest_invoice'],
      })

      if (debug) debugLog.push({ path: 'B_subscriptions', total: subs.data.length })

      for (const sub of subs.data) {
        const latestInv = sub.latest_invoice && typeof sub.latest_invoice === 'object'
          ? sub.latest_invoice as Stripe.Invoice
          : null
        if (!latestInv || latestInv.status !== 'open') continue

        const customerId = typeof sub.customer === 'string'
          ? sub.customer
          : (sub.customer as Stripe.Customer | null)?.id
        const clientId = customerId ? customerToClient[customerId] : undefined
        if (!customerId || !clientId) continue

        if (insertedInvoiceIds.has(latestInv.id)) continue

        const inv = await stripe.invoices.retrieve(latestInv.id, {
          expand: ['payment_intent', 'lines.data.pricing.price_details.price.product'],
        })

        if (inv.created < threeDaysAgoUnix) {
          if (debug) debugLog.push({ path: 'B', invoice_id: inv.id, skip: `too old (${new Date(inv.created * 1000).toISOString().slice(0, 10)})` })
          continue
        }

        const raw      = (inv as unknown as { payment_intent?: Stripe.PaymentIntent | string | null }).payment_intent
        const pi       = raw && typeof raw === 'object' ? raw as Stripe.PaymentIntent : null
        const piStatus = pi?.status ?? null

        const achInFlightB = !pi || piStatus === 'processing' || piStatus === 'requires_action'
        if (!achInFlightB) {
          if (debug) debugLog.push({ path: 'B', invoice_id: inv.id, skip: `non-ACH payment_intent (${piStatus})` })
          continue
        }

        if (debug) debugLog.push({
          path: 'B', subscription_id: sub.id, invoice_id: inv.id,
          customer_id: customerId, client_id: clientId, pi_status: piStatus,
        })

        const inserted = await tryInsert(db, inv, clientId, debugLog, debug, 'subscription')
        if (inserted) insertedInvoiceIds.add(inv.id)
      }
    }
  } catch (err) {
    console.error('[pending-ach] Stripe detection failed:', err)
    if (debug) debugLog.push({ error: String(err) })
  }

  const pending = await getPendingAmounts(db)
  if (debug) return NextResponse.json({ pending, debug: debugLog })
  return NextResponse.json({ pending })
}

// ── DELETE — remove a single pending entry ───────────────────────────────────

export async function DELETE(request: NextRequest) {
  const cookieStore = await cookies()
  if (!requireAdmin(cookieStore))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const db = createAdminClient()
  // Fetch first to verify the entry exists — delete is scoped by both id + client_id
  // to prevent one client's entry being deleted by guessing another's UUID.
  const { data: entry } = await db
    .from('ad_fuel_ach_pending')
    .select('client_id')
    .eq('id', id)
    .maybeSingle()
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await db
    .from('ad_fuel_ach_pending')
    .delete()
    .eq('id', id)
    .eq('client_id', entry.client_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deleted: true })
}
