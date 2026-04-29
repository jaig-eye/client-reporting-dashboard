import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email'
import { isAdminAuthed } from '@/lib/auth'
import { getAgencySettings } from '@/lib/agency-settings'

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { clientId, email, from, to, compare } = await req.json()
  if (!clientId || !email) {
    return NextResponse.json({ error: 'clientId and email are required' }, { status: 400 })
  }

  // Look up the client's dashboard_token so we can call the export route
  const db = createAdminClient()
  const { data: client } = await db.from('clients').select('name, dashboard_token').eq('id', clientId).single()
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  // Build query string
  const qs = [
    from    ? `from=${from}`    : '',
    to      ? `to=${to}`        : '',
    compare && compare !== 'none' ? `compare=${compare}` : '',
  ].filter(Boolean).join('&')

  // Fetch the email HTML from the existing export route using the client's token as a cookie
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`
  const reportUrl = `${appUrl}/api/export/report?format=email${qs ? '&' + qs : ''}`
  const reportRes = await fetch(reportUrl, {
    headers: { Cookie: `client_token=${client.dashboard_token}` },
  })

  if (!reportRes.ok) {
    return NextResponse.json({ error: 'Failed to generate report HTML' }, { status: 500 })
  }

  const html = await reportRes.text()
  const settings = await getAgencySettings()
  const agencyName = settings.agency_name ?? 'Your Agency'

  const dateLabel = [from, to].filter(Boolean).join(' – ') || 'recent period'

  await sendEmail({
    to: email,
    subject: `${client.name} — Performance Report (${dateLabel})`,
    html,
    text: `Performance report for ${client.name} from ${agencyName}. Please view this email in an HTML-capable client.`,
  })

  return NextResponse.json({ success: true })
}
