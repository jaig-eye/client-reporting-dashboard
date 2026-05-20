// GET    /api/admin/ad-fuel/ledger?client_id=...  — list entries
// POST   /api/admin/ad-fuel/ledger                — add entry
// DELETE /api/admin/ad-fuel/ledger  body: { ids: string[] } — bulk delete
// Single-entry delete is handled by [id]/route.ts

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

  let query = db
    .from('ad_fuel_ledger')
    .select('id, client_id, date_of_payment, invoice_date, amount_af, split_override, invoice_id, type, note, created_by, created_at')
    .order('date_of_payment', { ascending: false })

  if (clientId) query = query.eq('client_id', clientId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
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
