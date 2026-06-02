// GET    /api/admin/ad-fuel/ledger?client_id=...  — confirmed ledger + pending ACH merged
// POST   /api/admin/ad-fuel/ledger                — add confirmed entry
// DELETE /api/admin/ad-fuel/ledger  body: { ids: string[] } — bulk delete confirmed entries

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { logActivity } from '@/lib/activity'

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const clientId = new URL(request.url).searchParams.get('client_id')
  const db = createAdminClient()

  // Fetch confirmed ledger entries and pending ACH entries in parallel
  let ledgerQuery = db
    .from('ad_fuel_ledger')
    .select('id, client_id, date_of_payment, invoice_date, amount_af, split_override, invoice_id, type, note, created_by, created_at, ach_status')
  let pendingQuery = db
    .from('ad_fuel_ach_pending')
    .select('id, client_id, invoice_id, invoice_date, amount_af, note, created_at')

  if (clientId) {
    ledgerQuery  = ledgerQuery.eq('client_id', clientId)
    pendingQuery = pendingQuery.eq('client_id', clientId)
  }

  const [ledgerRes, pendingRes] = await Promise.all([ledgerQuery, pendingQuery])

  if (ledgerRes.error) return NextResponse.json({ error: ledgerRes.error.message }, { status: 500 })

  // Shape pending rows to match the LedgerEntry interface, tagged with is_ach_pending
  type PendingRow = { id: string; client_id: string; invoice_id: string; invoice_date: string; amount_af: number; note: string | null; created_at: string }
  const pendingRows = ((pendingRes.data ?? []) as PendingRow[]).map(p => ({
    id:              p.id,
    client_id:       p.client_id,
    date_of_payment: p.invoice_date,  // use invoice date as display placeholder
    invoice_date:    p.invoice_date,
    amount_af:       p.amount_af,
    split_override:  null,
    invoice_id:      p.invoice_id,
    type:            'ACH',
    note:            p.note,
    created_by:      'auto-ach',
    created_at:      p.created_at,
    ach_status:      'pending',  // virtual — for badge display in UI
    is_ach_pending:  true,       // routes delete to pending-ach endpoint
  }))

  type MergedRow = Record<string, unknown> & { is_ach_pending: boolean }

  // Merge and sort descending by payment date (pending rows use invoice_date)
  const confirmed: MergedRow[] = (ledgerRes.data ?? []).map((e: Record<string, unknown>) => ({ ...e, is_ach_pending: false }))
  const combined: MergedRow[] = [...confirmed, ...pendingRows]
  combined.sort((a, b) => {
    const aDate = ((a.date_of_payment ?? a.invoice_date ?? a.created_at) as string) ?? ''
    const bDate = ((b.date_of_payment ?? b.invoice_date ?? b.created_at) as string) ?? ''
    return bDate.localeCompare(aDate)
  })

  return NextResponse.json(combined)
}

export async function DELETE(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { ids } = await request.json() as { ids: string[] }
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids array is required' }, { status: 400 })
  }

  const db = createAdminClient()
  const { error } = await db.from('ad_fuel_ledger').delete().in('id', ids)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const adminSession = await getAdminSession()
  logActivity(adminSession, 'deleted', 'ledger_entry', { meta: { count: ids.length } })
  return NextResponse.json({ deleted: ids.length })
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json() as {
    client_id:       string
    date_of_payment: string
    amount_af:       number
    split_override?: number | null
    invoice_id?:     string | null
    type?:           string | null
    note?:           string | null
    created_by?:     string | null
  }

  if (!body.client_id || !body.date_of_payment || body.amount_af == null) {
    return NextResponse.json({ error: 'client_id, date_of_payment, and amount_af are required' }, { status: 400 })
  }
  if (body.split_override != null && (body.split_override < 0 || body.split_override > 1)) {
    return NextResponse.json({ error: 'split_override must be between 0 and 1 (e.g. 0.80 for 80%)' }, { status: 400 })
  }

  const db = createAdminClient()
  const { data, error } = await db
    .from('ad_fuel_ledger')
    .insert({
      client_id:       body.client_id,
      date_of_payment: body.date_of_payment,
      amount_af:       body.amount_af,
      split_override:  body.split_override ?? null,
      invoice_id:      body.invoice_id ?? null,
      type:            body.type ?? null,
      note:            body.note ?? null,
      created_by:      body.created_by ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const adminSession = await getAdminSession()
  logActivity(adminSession, 'created', 'ledger_entry', {
    resourceId: (data as { id?: string } | null)?.id,
    clientId: body.client_id,
    meta: { amount_af: body.amount_af, type: body.type ?? null },
  })
  return NextResponse.json(data)
}
