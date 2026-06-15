import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

const PAGE_DAYS = 10

export async function GET(request: NextRequest) {
  const token = request.cookies.get('client_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createAdminClient()
  const { data: clientData } = await db
    .from('clients')
    .select('id')
    .eq('dashboard_token', token)
    .maybeSingle()

  if (!clientData) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const clientId = clientData.id

  const page = parseInt(new URL(request.url).searchParams.get('page') ?? '0', 10)

  // Daily spend window for this page
  const toOffset   = page * PAGE_DAYS
  const fromOffset = toOffset + PAGE_DAYS
  const now = new Date()
  const toDate   = new Date(now.getTime() - toOffset   * 86_400_000).toISOString().slice(0, 10)
  const fromDate = new Date(now.getTime() - fromOffset * 86_400_000).toISOString().slice(0, 10)

  type SpendRow = { client_id: string; date: string; spend: number }

  const [ledgerRes, gRes, mRes] = await Promise.all([
    // Ledger — all entries for this client (no pagination needed, <50 rows typical)
    page === 0
      ? db.from('ad_fuel_ledger')
          .select('id, date_of_payment, invoice_date, amount_af, type, note, ach_status, created_at')
          .eq('client_id', clientId)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] }),
    db.rpc('daily_google_spend_by_client', { floor_date: fromDate })
      .lte('date', toDate)
      .gte('date', fromDate)
      .eq('client_id', clientId),
    db.rpc('daily_meta_spend_by_client', { floor_date: fromDate })
      .lte('date', toDate)
      .gte('date', fromDate)
      .eq('client_id', clientId),
  ])

  // Build day-by-day debit log: merge google + meta by date, sorted newest first
  const byDate = new Map<string, { google: number; meta: number }>()

  for (const row of (gRes.data ?? []) as SpendRow[]) {
    const d = byDate.get(row.date) ?? { google: 0, meta: 0 }
    d.google += Number(row.spend)
    byDate.set(row.date, d)
  }
  for (const row of (mRes.data ?? []) as SpendRow[]) {
    const d = byDate.get(row.date) ?? { google: 0, meta: 0 }
    d.meta += Number(row.spend)
    byDate.set(row.date, d)
  }

  const dailyDebits = Array.from(byDate.entries())
    .map(([date, { google, meta }]) => ({ date, google_spend: google, meta_spend: meta, total: google + meta }))
    .sort((a, b) => b.date.localeCompare(a.date))

  return NextResponse.json({
    ledger:      ledgerRes.data ?? [],
    dailyDebits,
    nextPage:    dailyDebits.length >= PAGE_DAYS ? page + 1 : null,
  })
}
