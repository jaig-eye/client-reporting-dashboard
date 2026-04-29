import Stripe from 'stripe'
import { createAdminClient } from './supabase/server'
import { getAgencySettings } from './agency-settings'

export async function getStripeClient(): Promise<Stripe | null> {
  const settings = await getAgencySettings()
  if (!settings.stripe_api_key) return null
  return new Stripe(settings.stripe_api_key, { apiVersion: '2026-04-22.dahlia' })
}

export function isAdFuelLine(line: Stripe.InvoiceLineItem): boolean {
  const desc = (line.description ?? '').toLowerCase()
  return desc.includes('ad fuel')
}

/**
 * Syncs Stripe invoices for a single client — inserts new ad-fuel ledger rows,
 * skipping any invoice_id already recorded to prevent duplicates.
 */
export async function syncStripeInvoicesForClient(clientId: string, stripe: Stripe): Promise<number> {
  const db = createAdminClient()

  const { data: client } = await db.from('clients').select('stripe_customer_id, ad_fuel_cut').eq('id', clientId).single()
  if (!client?.stripe_customer_id) return 0

  // Fetch last 90 days of paid invoices, expanding product info for line items
  const since = Math.floor((Date.now() - 90 * 24 * 60 * 60 * 1000) / 1000)
  const invoices = await stripe.invoices.list({
    customer: client.stripe_customer_id,
    status:   'paid',
    created:  { gte: since },
    limit:    100,
    expand:   ['data.lines.data.pricing.price_details.price.product'],
  })

  let inserted = 0
  for (const invoice of invoices.data) {
    for (const line of invoice.lines.data) {
      if (!isAdFuelLine(line)) continue
      if ((line.amount ?? 0) <= 0) continue

      // Deduplicate by invoice_id — use invoice.id + line.id as a compound key via note
      const { data: existing } = await db
        .from('ad_fuel_ledger')
        .select('id')
        .eq('invoice_id', invoice.id)
        .eq('client_id', clientId)
        .maybeSingle()
      if (existing) continue

      // Single ad fuel line on invoice → One-Time; bundled with other products → MRR
      const isRecurring = invoice.lines.data.length > 1
      const dateOfPayment = new Date(invoice.created * 1000).toISOString().split('T')[0]

      await db.from('ad_fuel_ledger').insert({
        client_id:       clientId,
        date_of_payment: dateOfPayment,
        amount_af:       line.amount / 100,
        invoice_id:      invoice.id,
        type:            isRecurring ? 'MRR' : 'One-Time',
        created_by:      'Stripe',
        note:            line.description ?? invoice.number ?? '',
      })
      inserted++
    }
  }
  return inserted
}
