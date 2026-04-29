// Stripe webhook — receives invoice.payment_succeeded events and auto-logs
// ad fuel payments to the ledger for matching clients.
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

  const invoice = event.data.object as Stripe.Invoice
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id
  if (!customerId) return NextResponse.json({ received: true })

  const db = createAdminClient()
  const { data: client } = await db
    .from('clients')
    .select('id, ad_fuel_cut')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()

  if (!client) return NextResponse.json({ received: true })

  // Expand line item product details by re-fetching the invoice
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

    const isRecurring = fullInvoice.billing_reason === 'subscription_cycle'
    const dateOfPayment = new Date(fullInvoice.created * 1000).toISOString().split('T')[0]

    await db.from('ad_fuel_ledger').insert({
      client_id:       client.id,
      date_of_payment: dateOfPayment,
      amount_af:       line.amount / 100,
      invoice_id:      fullInvoice.id,
      type:            isRecurring ? 'MRR' : 'One-Time',
      created_by:      'Stripe',
      note:            line.description ?? fullInvoice.number ?? '',
    })
  }

  return NextResponse.json({ received: true })
}
