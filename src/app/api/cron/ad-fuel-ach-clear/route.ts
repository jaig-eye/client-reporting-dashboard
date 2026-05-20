// GET /api/cron/ad-fuel-ach-clear
// Hourly cron — resolves pending ACH ledger entries against Stripe.
//
//   Paid     → update date_of_payment to actual bank-confirmed date, mark cleared
//   Void/uncollectible or payment failed → delete the pending entry (money never came)
//   Still processing → no-op

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getStripeClient } from '@/lib/stripe'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  const { data: pendingEntries } = await db
    .from('ad_fuel_ledger')
    .select('id, invoice_id, client_id, amount_af')
    .eq('ach_status', 'pending')
    .not('invoice_id', 'is', null)

  if (!pendingEntries?.length) {
    return NextResponse.json({ checked: 0, cleared: 0, failed: 0 })
  }

  const stripe = await getStripeClient()
  if (!stripe) {
    return NextResponse.json({ skipped: true, reason: 'Stripe not configured' })
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

  return NextResponse.json({ checked: pendingEntries.length, cleared, failed })
}
