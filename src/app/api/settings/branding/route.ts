// Public branding endpoint — no auth required.
// Returns only agency_name and agency_logo_url for use on the admin login page.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const db = createAdminClient()
    const { data } = await db
      .from('agency_settings')
      .select('agency_name, agency_logo_url')
      .single()

    return NextResponse.json({
      agency_name:     data?.agency_name     ?? 'LaunchLocal',
      agency_logo_url: data?.agency_logo_url ?? null,
    })
  } catch {
    return NextResponse.json({ agency_name: 'LaunchLocal', agency_logo_url: null })
  }
}
