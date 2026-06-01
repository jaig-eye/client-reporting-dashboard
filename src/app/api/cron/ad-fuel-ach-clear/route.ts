// GET /api/cron/ad-fuel-ach-clear
// Hourly cron — detects new ACH-processing invoices and resolves existing pending entries.
//
//   Detect:  open Stripe invoices with payment_intent.status='processing' → insert pending ledger entry
//   Paid     → update date_of_payment to actual bank-confirmed date, mark cleared
//   Void/uncollectible or payment failed → delete the pending entry (money never came)
//   Still processing → no-op

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getStripeClient, isAdFuelLine } from '@/lib/stripe'
import type Stripe from 'stripe'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  const stripe = await getStripeClient()
  if (!stripe) {
    return NextResponse.json({ skipped: true, reason: 'Stripe not configured' })
  }

  // ── Step 1: detect open Stripe invoices with ACH in-flight ──────────────────
  // Gate: status='open' + payment_intent.status='processing'.
  // No date filter — open+processing means actively in-flight right now.
  // Paid invoices don't appear in the open list so no historical backfill risk.
  let detected = 0
  try {
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
      const isRecurring = inv.lines.data.length > 1

      await db.from('ad_fuel_ledger').insert({
        client_id:       clientId,
        date_of_payment: null,         // set when ACH clears (bank confirmation date)
        invoice_date:    invoiceDate,
        amount_af:       totalAf,
        invoice_id:      inv.id,
        ach_status:      'pending',
        type:            'ACH',
        created_by:      'auto-ach',
        note:            `ACH pending — ${inv.number ?? inv.id}`,
      })
      console.log(`[ad-fuel-ach-clear] detected new pending ACH for invoice ${inv.id}`)
      detected++
    }
  } catch (err) {
    console.error('[ad-fuel-ach-clear] detect step failed:', err)
  }

  // ── Step 2: resolve existing pending entries ───────────────────────────────
  const { data: pendingEntries } = await db
    .from('ad_fuel_ledger')
    .select('id, invoice_id, client_id, amount_af')
    .eq('ach_status', 'pending')
    .not('invoice_id', 'is', null)

  if (!pendingEntries?.length) {
    return NextResponse.json({ detected, checked: 0, cleared: 0, failed: 0 })
  }

  let cleared = 0
  let failed  = 0

  for (const entry of pendingEntries as { id: string; invoice_id: string; client_id: string; amount_af: number }[]) {
    try {
      const inv = await stripe.invoices.retrieve(entry.invoice_id, {
        expand: ['payment_intent'],
      })

      if (inv.status === 'paid') {
        // ACH confirmed by bank — update to actual clearance date
        const paidAtUnix  = inv.status_transitions?.paid_at
        const clearedDate = paidAtUnix
          ? new Date(paidAtUnix * 1000).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10)

        await db.from('ad_fuel_ledger')
          .update({ date_of_payment: clearedDate, ach_status: 'cleared' })
          .eq('id', entry.id)

        console.log(`[ad-fuel-ach-clear] cleared entry ${entry.id} for client ${entry.client_id} on ${clearedDate}`)
        cleared++

      } else if (inv.status === 'void' || inv.status === 'uncollectible') {
        // Invoice was cancelled or Stripe gave up — remove the pending entry
        await db.from('ad_fuel_ledger').delete().eq('id', entry.id)
        console.log(`[ad-fuel-ach-clear] removed entry ${entry.id} — invoice ${inv.status}`)
        failed++

      } else if (inv.status === 'open') {
        // Check if the payment_intent itself failed
        const raw      = (inv as unknown as { payment_intent?: { status: string } | string | null }).payment_intent
        const piStatus = raw && typeof raw === 'object' ? (raw as { status: string }).status : null

        if (piStatus === 'requires_payment_method' || piStatus === 'canceled') {
          await db.from('ad_fuel_ledger').delete().eq('id', entry.id)
          console.log(`[ad-fuel-ach-clear] removed entry ${entry.id} — payment_intent ${piStatus}`)
          failed++
        }
        // piStatus === 'processing' → still in-flight, do nothing
      }
    } catch (err) {
      console.error(`[ad-fuel-ach-clear] error checking entry ${entry.id}:`, err)
    }
  }

  return NextResponse.json({ detected, checked: pendingEntries.length, cleared, failed })
}
