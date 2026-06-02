// GET /api/cron/ad-fuel-ach-clear
// Hourly cron — detects new ACH-processing invoices and resolves existing pending entries.
//
//   Detect:  open Stripe invoices with a non-canceled payment_intent → insert pending ledger entry
//   Paid     → update date_of_payment to actual bank-confirmed date, mark cleared
//   Void/uncollectible → delete the pending entry
//   Open but payment_intent not in-flight → delete the pending entry
//   Still processing / requires_action → no-op

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
  // Only look at invoices created in the last 3 days — older open invoices are
  // stale/uncollected or were manually entered. Once an entry is inserted, the
  // cron resolves it (Step 2) regardless of age.
  const threeDaysAgoUnix = Math.floor((Date.now() - 3 * 24 * 60 * 60 * 1000) / 1000)
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
      status:  'open',
      limit:   100,
      created: { gte: threeDaysAgoUnix },
      expand:  [
        'data.payment_intent',
        'data.lines.data.pricing.price_details.price.product',
      ],
    })

    for (const inv of invoices.data) {
      const raw = (inv as unknown as { payment_intent?: Stripe.PaymentIntent | string | null }).payment_intent
      const pi  = raw && typeof raw === 'object' ? raw as Stripe.PaymentIntent : null
      // Skip failed payment intents. Allow null PI (ACH credit transfer, no PI involved).
      if (pi && (pi.status === 'canceled' || pi.status === 'requires_payment_method')) continue

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
      if ((inv.lines as unknown as { has_more?: boolean }).has_more) {
        console.warn(`[ad-fuel-ach-clear] Invoice ${inv.id} has paginated line items — ad fuel total may be partial`)
      }
      if (totalAf <= 0) continue

      const invoiceDate = new Date(inv.created * 1000).toISOString().slice(0, 10)

      const { error: insertError } = await db.from('ad_fuel_ledger').insert({
        client_id:       clientId,
        date_of_payment: invoiceDate,  // placeholder; updated to real payment date when ACH clears
        invoice_date:    invoiceDate,
        amount_af:       totalAf,
        invoice_id:      inv.id,
        ach_status:      'pending',
        type:            'ACH',
        created_by:      'auto-ach',
        note:            `ACH pending — ${inv.number ?? inv.id}`,
      })
      if (insertError) {
        console.error(`[ad-fuel-ach-clear] insert failed for invoice ${inv.id}:`, insertError.message)
        continue
      }
      console.log(`[ad-fuel-ach-clear] detected new pending ACH for invoice ${inv.id}, client ${clientId}, amount ${totalAf}`)
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
        const paidAtUnix  = inv.status_transitions?.paid_at
        const clearedDate = paidAtUnix
          ? new Date(paidAtUnix * 1000).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10)

        const { error: updateError } = await db.from('ad_fuel_ledger')
          .update({ date_of_payment: clearedDate, ach_status: 'cleared' })
          .eq('id', entry.id)

        if (updateError) {
          console.error(`[ad-fuel-ach-clear] update failed for entry ${entry.id}:`, updateError.message)
          continue
        }

        console.log(`[ad-fuel-ach-clear] cleared entry ${entry.id} for client ${entry.client_id} on ${clearedDate}`)
        cleared++

      } else if (inv.status === 'void' || inv.status === 'uncollectible') {
        await db.from('ad_fuel_ledger').delete().eq('id', entry.id)
        console.log(`[ad-fuel-ach-clear] removed entry ${entry.id} — invoice ${inv.status}`)
        failed++

      } else if (inv.status === 'open') {
        const raw      = (inv as unknown as { payment_intent?: { status: string } | string | null }).payment_intent
        const pi       = raw && typeof raw === 'object' ? raw as { status: string } : null

        // No payment_intent = ACH credit transfer — customer pushes money to Stripe's
        // bank account, invoice goes paid automatically. Leave the entry alone.
        if (!pi) continue

        // Allowlist: only these two statuses mean a PaymentIntent-based ACH is in-flight
        const inFlight = pi.status === 'processing' || pi.status === 'requires_action'
        if (!inFlight) {
          await db.from('ad_fuel_ledger').delete().eq('id', entry.id)
          console.log(`[ad-fuel-ach-clear] removed entry ${entry.id} — payment_intent ${pi.status}`)
          failed++
        }
      }
    } catch (err) {
      console.error(`[ad-fuel-ach-clear] error checking entry ${entry.id}:`, err)
    }
  }

  return NextResponse.json({ detected, checked: pendingEntries.length, cleared, failed })
}
