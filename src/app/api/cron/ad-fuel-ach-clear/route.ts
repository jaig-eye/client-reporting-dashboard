// GET /api/cron/ad-fuel-ach-clear
// Hourly cron — detects, partially credits, and resolves ACH invoices.
//
// Step 1 — Detect: open Stripe invoices (last 3 days) where PI is genuinely
//           ACH in-flight (processing / requires_action / null PI).
//           Amount scaled to inv.amount_remaining / amount_due portion of ad fuel lines.
// Step 2 — Resolve: for each pending entry, credit the delta (amount paid since
//           last credit) to ad_fuel_ledger. Handles partial card + ACH payments.
//           Deletes pending entry when invoice is fully paid or void/failed.
// Step 3 — Delta: scan recent ledger entries with invoice_id; credit any newly
//           paid portion for regular invoices that received additional payments.

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeCompare } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { getStripeClient, isAdFuelLine } from '@/lib/stripe'
import type Stripe from 'stripe'

export const maxDuration = 60

// Paginate through ALL invoice line items and return the total ad-fuel amount.
// stripe.invoices.retrieve() only returns the first 10 lines in inv.lines.data;
// invoices with >10 items require explicit pagination via listLineItems().
async function fetchAdFuelTotal(stripe: Stripe, invoiceId: string): Promise<number> {
  let total = 0
  let hasMore = true
  let startingAfter: string | undefined
  while (hasMore) {
    const page = await stripe.invoices.listLineItems(invoiceId, {
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    for (const line of page.data) {
      if (isAdFuelLine(line as unknown as Stripe.InvoiceLineItem) && (line.amount ?? 0) > 0) {
        total += line.amount / 100
      }
    }
    hasMore = page.has_more
    if (hasMore && page.data.length > 0) startingAfter = page.data[page.data.length - 1].id
    else break
  }
  return total
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!timingSafeCompare(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  const stripe = await getStripeClient()
  if (!stripe) {
    return NextResponse.json({ skipped: true, reason: 'Stripe not configured' })
  }

  // ── Step 1: detect open invoices with ACH in-flight ─────────────────────────
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

      // Allowlist: only genuine ACH states — null PI (credit transfer),
      // processing (ACH in-transit), requires_action (bank verification)
      const achInFlight = !pi || pi.status === 'processing' || pi.status === 'requires_action'
      if (!achInFlight) continue

      const customerId = typeof inv.customer === 'string'
        ? inv.customer
        : (inv.customer as Stripe.Customer | null)?.id
      if (!customerId) continue
      const clientId = customerToClient[customerId]
      if (!clientId) continue

      const { data: existing } = await db
        .from('ad_fuel_ach_pending')
        .select('id')
        .eq('invoice_id', inv.id)
        .eq('client_id', clientId)
        .maybeSingle()
      if (existing) continue

      const totalAf = await fetchAdFuelTotal(stripe, inv.id)
      if (totalAf <= 0) continue

      // Scale amount to what's actually still owed (handles partial card payments)
      const amountDue       = inv.amount_due       ?? 0
      const amountRemaining = inv.amount_remaining ?? amountDue
      if (amountRemaining <= 0) continue
      const remainingRatio = amountDue > 0 ? amountRemaining / amountDue : 1
      const pendingAmount  = Math.round(totalAf * remainingRatio * 100) / 100
      if (pendingAmount <= 0) continue

      const invoiceDate = new Date(inv.created * 1000).toISOString().slice(0, 10)
      const { error } = await db.from('ad_fuel_ach_pending').insert({
        client_id:    clientId,
        invoice_id:   inv.id,
        invoice_date: invoiceDate,
        amount_af:    pendingAmount,
        note:         `ACH pending — ${inv.number ?? inv.id}`,
      })
      if (error) {
        console.error(`[ad-fuel-ach-clear] insert failed for invoice ${inv.id}:`, error.message)
        continue
      }
      console.log(`[ad-fuel-ach-clear] detected pending ACH invoice=${inv.id} client=${clientId} amount=${pendingAmount}`)
      detected++
    }
  } catch (err) {
    console.error('[ad-fuel-ach-clear] detect step failed:', err)
  }

  // ── Step 2: resolve existing pending entries (delta-based) ──────────────────
  const { data: pendingEntries } = await db
    .from('ad_fuel_ach_pending')
    .select('id, invoice_id, client_id, invoice_date, amount_af, note')

  let cleared = 0
  let failed  = 0

  type PendingRow = { id: string; invoice_id: string; client_id: string; invoice_date: string; amount_af: number; note: string | null }

  for (const entry of (pendingEntries ?? []) as PendingRow[]) {
    try {
      const inv = await stripe.invoices.retrieve(entry.invoice_id, {
        expand: ['payment_intent'],
      })

      if (inv.status === 'void' || inv.status === 'uncollectible') {
        await db.from('ad_fuel_ach_pending').delete().eq('id', entry.id)
        console.log(`[ad-fuel-ach-clear] removed entry ${entry.id} — invoice ${inv.status}`)
        failed++
        continue
      }

      // Check what's already been credited in the ledger for this invoice
      const { data: existingCredits } = await db
        .from('ad_fuel_ledger')
        .select('amount_af')
        .eq('invoice_id', entry.invoice_id)
        .eq('client_id', entry.client_id)
      const alreadyCredited = ((existingCredits ?? []) as { amount_af: number }[])
        .reduce((s, r) => s + Number(r.amount_af), 0)

      const amountDue  = inv.amount_due  ?? 0
      const amountPaid = amountDue - (inv.amount_remaining ?? 0)

      // For fully paid invoices, recalculate totalAf from line items (source of truth).
      // Using entry.amount_af fails when it represents only the REMAINING portion
      // (e.g. $2,500) while a manual entry already covers the first portion ($5,000)
      // — the delta would be negative and the final payment would never be credited.
      // For paid invoices recalculate from all line items (paginated) — using
      // entry.amount_af as the base gives delta=0 when it stores only the remaining portion.
      let totalInvoiceAf = entry.amount_af
      if (inv.status === 'paid') {
        const fromLines = await fetchAdFuelTotal(stripe, entry.invoice_id)
        if (fromLines > 0) totalInvoiceAf = fromLines
      }

      const shouldCredit = amountDue > 0
        ? Math.round(totalInvoiceAf * (amountPaid / amountDue) * 100) / 100
        : 0
      const delta = Math.round((shouldCredit - alreadyCredited) * 100) / 100

      if (delta > 0.01) {
        const paidAtUnix  = inv.status_transitions?.paid_at
        const creditDate  = paidAtUnix
          ? new Date(paidAtUnix * 1000).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10)

        const note = (inv.amount_remaining ?? 0) > 0
          ? `ACH partial — ${inv.number ?? entry.invoice_id} ($${Math.round(amountPaid / 100)} of $${Math.round(amountDue / 100)})`
          : `ACH cleared — ${inv.number ?? entry.invoice_id}`

        const { error: insertErr } = await db.from('ad_fuel_ledger').insert({
          client_id:       entry.client_id,
          date_of_payment: creditDate,
          invoice_date:    entry.invoice_date,
          amount_af:       delta,
          invoice_id:      entry.invoice_id,
          type:            'ACH',
          created_by:      'auto-ach',
          note,
        })
        if (insertErr) {
          console.error(`[ad-fuel-ach-clear] ledger insert failed for ${entry.id}:`, insertErr.message)
          continue
        }
        console.log(`[ad-fuel-ach-clear] credited $${delta} for entry ${entry.id} (${amountPaid >= amountDue ? 'full' : 'partial'})`)
        cleared++

        // Fire payment notification so the admin browser hears a sound for ACH
        // clearances (same as card payments via the Stripe webhook).
        // Best-effort — don't block ledger logic if this fails.
        db.from('payment_notifications').upsert(
          {
            stripe_event_id: `ach-${entry.invoice_id}-${creditDate}`,
            amount:          delta,
            currency:        'usd',
            description:     note,
            client_name:     null,  // client name lookup would add latency; omit
          },
          { onConflict: 'stripe_event_id', ignoreDuplicates: true }
        ).then(null, (e) => console.warn('[ad-fuel-ach-clear] payment_notifications insert failed (non-fatal):', e))
      }

      // Remove pending entry when fully paid or nothing remaining
      const fullyPaid = inv.status === 'paid' || (inv.amount_remaining ?? 1) <= 0
      if (fullyPaid) {
        await db.from('ad_fuel_ach_pending').delete().eq('id', entry.id)
        if (delta <= 0.01) cleared++  // count as cleared even if no new delta
      } else if (inv.status === 'open') {
        const raw      = (inv as unknown as { payment_intent?: { status: string } | string | null }).payment_intent
        const pi       = raw && typeof raw === 'object' ? raw as { status: string } : null
        if (!pi) continue  // ACH credit transfer, wait for paid status
        const inFlight = pi.status === 'processing' || pi.status === 'requires_action'
        if (!inFlight) {
          await db.from('ad_fuel_ach_pending').delete().eq('id', entry.id)
          console.log(`[ad-fuel-ach-clear] removed entry ${entry.id} — payment_intent ${pi.status}`)
          failed++
        }
      }
    } catch (err) {
      console.error(`[ad-fuel-ach-clear] error checking entry ${entry.id}:`, err)
    }
  }

  // ── Step 3: delta-credit regular ledger entries with invoice_id ─────────────
  // Catches partial payments on non-ACH invoices that already have a ledger entry
  // from a previous sync or manual entry. Best-effort — errors are silently skipped.
  let deltaCredits = 0
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data: recentLedger } = await db
      .from('ad_fuel_ledger')
      .select('invoice_id, client_id, amount_af')
      .not('invoice_id', 'is', null)
      .gte('created_at', thirtyDaysAgo)

    // Group by invoice_id+client_id
    const ledgerByInvoice: Record<string, { clientId: string; amountAf: number }> = {}
    for (const r of ((recentLedger ?? []) as { invoice_id: string; client_id: string; amount_af: number }[])) {
      const key = `${r.invoice_id}__${r.client_id}`
      if (!ledgerByInvoice[key]) ledgerByInvoice[key] = { clientId: r.client_id, amountAf: 0 }
      ledgerByInvoice[key].amountAf += Number(r.amount_af)
    }

    for (const [key, entry] of Object.entries(ledgerByInvoice)) {
      const invoiceId = key.split('__')[0]
      try {
        const inv = await stripe.invoices.retrieve(invoiceId)
        const amountDue  = inv.amount_due  ?? 0
        const amountPaid = amountDue - (inv.amount_remaining ?? 0)
        // Paginate all line items — inv.lines.data only has the first 10
        const fromLines    = await fetchAdFuelTotal(stripe, invoiceId)
        const totalInvoiceAf = fromLines > 0 ? fromLines : entry.amountAf
        const shouldCredit = amountDue > 0
          ? Math.round(totalInvoiceAf * (amountPaid / amountDue) * 100) / 100
          : totalInvoiceAf
        const delta = Math.round((shouldCredit - entry.amountAf) * 100) / 100
        if (delta > 0.01) {
          const paidAt     = inv.status_transitions?.paid_at
          const creditDate = paidAt ? new Date(paidAt * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
          await db.from('ad_fuel_ledger').insert({
            client_id:       entry.clientId,
            date_of_payment: creditDate,
            invoice_id:      invoiceId,
            amount_af:       delta,
            type:            'ACH',
            created_by:      'auto-ach',
            note:            `Partial payment delta — ${inv.number ?? invoiceId}`,
          })
          console.log(`[ad-fuel-ach-clear] step3 delta $${delta} for invoice ${invoiceId}`)
          deltaCredits++
        }
      } catch (e) { console.warn('[ad-fuel-ach-clear] step3 delta credit failed:', e) }
    }
  } catch (err) {
    console.error('[ad-fuel-ach-clear] step3 failed:', err)
  }

  return NextResponse.json({
    detected,
    checked: pendingEntries?.length ?? 0,
    cleared,
    failed,
    deltaCredits,
  })
}
