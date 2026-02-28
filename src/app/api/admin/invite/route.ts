import { NextResponse } from 'next/server'

// Email invites removed — share the dashboard link directly from the admin panel
export async function POST() {
  return NextResponse.json({ error: 'Not implemented' }, { status: 410 })
}
