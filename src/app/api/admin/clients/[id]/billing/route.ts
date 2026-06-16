import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'
import { getStripeClient } from '@/lib/stripe'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const db = createAdminClient()

  const [clientRes, ledgerRes] = await Promise.all([
    db.from('clients').select('stripe_customer_id').eq('id', id).maybeSingle(),
    db.from('ad_fuel_ledger')
      .select('id, date_of_payment, invoice_date, amount_af, type, note, ach_status, invoice_id, created_at')
      .eq('client_id', id)
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  const stripeCustomerId = (clientRes.data as { stripe_customer_id?: string | null } | null)?.stripe_customer_id

  let invoices: object[] = []
  if (stripeCustomerId) {
    try {
      const stripe = await getStripeClient()
      if (stripe) {
        const result = await stripe.invoices.list({
          customer: stripeCustomerId,
          limit:    24,
        })
        invoices = result.data
          .filter(inv => inv.status !== 'draft')
          .map(inv => ({
            id:          inv.id,
            number:      inv.number,
            date:        inv.created,
            amount:      (inv.status === 'paid' ? (inv.amount_paid ?? 0) : (inv.amount_due ?? inv.total ?? 0)) / 100,
            status:      inv.status,
            description: inv.description ?? inv.lines?.data?.[0]?.description ?? null,
            hosted_url:  inv.hosted_invoice_url,
          }))
      }
    } catch {
      // Stripe unavailable — return ledger only
    }
  }

  return NextResponse.json({
    invoices,
    ledger: ledgerRes.data ?? [],
  })
}
