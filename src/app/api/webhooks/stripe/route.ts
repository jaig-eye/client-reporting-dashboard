// Stripe webhook — handles invoice.payment_succeeded events.
//
// For EVERY successful payment:
//   → Inserts a row into payment_notifications so the admin browser plays
//     a sound notification via Supabase Realtime (regardless of whether it's
//     an Ad Fuel invoice or a regular invoice).
//
// For Ad Fuel invoices only (lines that match isAdFuelLine):
//   → Also inserts into ad_fuel_ledger for balance tracking.
//
// Register this URL in the Stripe dashboard: POST /api/webhooks/stripe

import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/server'
import { getAgencySettings } from '@/lib/agency-settings'
import { isAdFuelLine } from '@/lib/stripe'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const settings = await getAgencySettings()
  if (!settings.stripe_api_key || !settings.stripe_webhook_secret) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 400 })
  }

  const rawBody = await req.text()
  const sig = req.headers.get('stripe-signature') ?? ''

  let event: Stripe.Event
  try {
    const stripe = new Stripe(settings.stripe_api_key, { apiVersion: '2026-04-22.dahlia' })
    event = stripe.webhooks.constructEvent(rawBody, sig, settings.stripe_webhook_secret)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  if (event.type !== 'invoice.payment_succeeded') {
    return NextResponse.json({ received: true })
  }

  const invoice    = event.data.object as Stripe.Invoice
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id
  if (!customerId) return NextResponse.json({ received: true })

  const db = createAdminClient()

  // ── Look up the client (optional — notification fires even for unknown customers) ──
  const { data: client } = await db
    .from('clients')
    .select('id, name, ad_fuel_cut')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()

  // ── Always fire a payment notification ────────────────────────────────────
  // This runs for every successful invoice — Ad Fuel or not — so the admin
  // browser gets the sound regardless of invoice type.
  const amountPaid = (invoice.amount_paid ?? 0) / 100  // cents → dollars
  if (amountPaid > 0) {
    const customerEmail = typeof invoice.customer_email === 'string' ? invoice.customer_email : null
    const description   = invoice.number ?? invoice.description ?? null

    await db.from('payment_notifications').upsert(
      {
        stripe_event_id: event.id,
        amount:          amountPaid,
        currency:        invoice.currency ?? 'usd',
        description,
        customer_email:  customerEmail,
        client_name:     client?.name ?? null,
      },
      { onConflict: 'stripe_event_id', ignoreDuplicates: true }
    )
  }

  // ── Ad Fuel ledger (existing logic — only for Ad Fuel line items) ──────────
  if (!client) return NextResponse.json({ received: true })

  const stripe = new Stripe(settings.stripe_api_key, { apiVersion: '2026-04-22.dahlia' })
  const fullInvoice = await stripe.invoices.retrieve(invoice.id, {
    expand: ['lines.data.pricing.price_details.price.product'],
  })

  for (const line of fullInvoice.lines.data) {
    if (!isAdFuelLine(line)) continue
    if ((line.amount ?? 0) <= 0) continue

    // Deduplicate
    const { data: existing } = await db
      .from('ad_fuel_ledger')
      .select('id')
      .eq('invoice_id', fullInvoice.id)
      .eq('client_id', client.id)
      .maybeSingle()
    if (existing) continue

    const isRecurring = fullInvoice.lines.data.length > 1

    const paidAt = (fullInvoice as unknown as { status_transitions?: { paid_at?: number | null } }).status_transitions?.paid_at
    const dateOfPayment = paidAt
      ? new Date(paidAt * 1000).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0]
    const invoiceDate = new Date(fullInvoice.created * 1000).toISOString().split('T')[0]

    await db.from('ad_fuel_ledger').insert({
      client_id:       client.id,
      date_of_payment: dateOfPayment,
      invoice_date:    invoiceDate,
      amount_af:       line.amount / 100,
      invoice_id:      fullInvoice.id,
      type:            isRecurring ? 'MRR' : 'One-Time',
      created_by:      'Stripe',
      note:            line.description ?? fullInvoice.number ?? '',
    })
  }

  return NextResponse.json({ received: true })
}
