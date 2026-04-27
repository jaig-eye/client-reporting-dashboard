// POST /api/admin/ad-fuel/import
// Accepts a CSV file and bulk-inserts ledger entries.
// Expected CSV columns (header row required, order flexible):
//   date_of_payment, client_id, client_name, amount_af, split_override,
//   invoice_id, type, note, created_by
// client_id can be a UUID or a numeric legacy ID matched against clients.id.
// client_name is used as a fallback lookup when client_id is absent/unmatched.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

function parseCSV(text: string): Record<string, string>[] {
  const lines  = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim())
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''))
  return lines.slice(1).map(line => {
    const vals = line.split(',')
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = (vals[i] ?? '').trim().replace(/^"|"$/g, '') })
    return row
  })
}

function parseDate(v: string): string | null {
  if (!v) return null
  const d = new Date(v)
  if (isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

function parseNum(v: string): number | null {
  const n = parseFloat(v.replace(/[$,]/g, ''))
  return isFinite(n) ? n : null
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

  const text = await file.text()
  const rows = parseCSV(text)
  if (rows.length === 0) return NextResponse.json({ inserted: 0, skipped: 0, errors: ['CSV is empty or has no data rows'] })

  const db = createAdminClient()
  const { data: clients } = await db.from('clients').select('id, name')
  const clientsArr = (clients ?? []) as { id: string; name: string }[]

  // Build lookup maps
  const byId: Record<string, string>   = {}  // uuid → uuid
  const byName: Record<string, string> = {}  // lower name → uuid
  for (const c of clientsArr) {
    byId[c.id] = c.id
    byName[c.name.toLowerCase().trim()] = c.id
  }

  let inserted = 0
  let skipped  = 0
  const errors: string[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = i + 2

    const date = parseDate(row.date_of_payment)
    if (!date) { errors.push(`Row ${rowNum}: invalid date_of_payment "${row.date_of_payment}"`); skipped++; continue }

    const amount = parseNum(row.amount_af ?? row.ad_fuel_amount ?? row.amount ?? '')
    if (amount == null || amount <= 0) { errors.push(`Row ${rowNum}: invalid amount_af "${row.amount_af}"`); skipped++; continue }

    // Resolve client UUID
    let clientId: string | null = null
    const rawId   = (row.client_id ?? '').trim()
    const rawName = (row.client_name ?? '').trim().toLowerCase()
    if (rawId && byId[rawId]) {
      clientId = byId[rawId]
    } else if (rawName && byName[rawName]) {
      clientId = byName[rawName]
    }
    if (!clientId) { errors.push(`Row ${rowNum}: could not resolve client "${row.client_id || row.client_name}"`); skipped++; continue }

    const splitOverride = parseNum(row.split_override ?? row.split ?? '')
    const normalizedSplit = splitOverride != null
      ? (splitOverride > 1 ? splitOverride / 100 : splitOverride)
      : null

    const { error } = await db.from('ad_fuel_ledger').insert({
      client_id:       clientId,
      date_of_payment: date,
      amount_af:       amount,
      split_override:  normalizedSplit,
      invoice_id:      row.invoice_id   || null,
      type:            row.type         || null,
      note:            row.note || row.notes || null,
      created_by:      row.created_by || row.added_by || null,
    })

    if (error) { errors.push(`Row ${rowNum}: ${error.message}`); skipped++; continue }
    inserted++
  }

  return NextResponse.json({ inserted, skipped, errors })
}
