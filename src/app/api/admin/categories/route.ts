// /api/admin/categories
// CRUD for campaign categories.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

function requireAdmin(req: NextRequest): boolean {
  const session = req.cookies.get('admin_session')?.value
  return !!session && session === process.env.ADMIN_PASSWORD
}

// GET — list all categories ordered by sort_order
export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = createAdminClient()
  const { data, error } = await db.from('campaign_categories').select('*').order('sort_order').order('created_at')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST — create a new category
export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { name, color, display_mode, conversion_label, default_conversion_value } = body

  if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const db = createAdminClient()
  const { data, error } = await db
    .from('campaign_categories')
    .insert({
      name:                     name.trim(),
      color:                    color                   ?? '#6b7280',
      display_mode:             display_mode            ?? 'custom',
      conversion_label:         conversion_label        ?? 'Conversions',
      default_conversion_value: default_conversion_value ?? 0,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
