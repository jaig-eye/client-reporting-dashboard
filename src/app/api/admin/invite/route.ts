import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { Resend } from 'resend'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const clientId = formData.get('clientId') as string

  const db = createAdminClient()
  const { data: client } = await db.from('clients').select('*').eq('id', clientId).single()
  if (!client) return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/admin?error=not_found`)

  const resend = new Resend(process.env.RESEND_API_KEY)
  const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL}/login`

  await resend.emails.send({
    from: process.env.EMAIL_FROM!,
    to: client.email,
    subject: 'Your campaign dashboard is ready',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="font-size: 20px; font-weight: 700; margin-bottom: 8px;">Your reporting dashboard is live</h2>
        <p style="color: #6b7280; margin-bottom: 24px;">Hi ${client.name}, your campaign performance dashboard is ready to view.</p>
        <a href="${loginUrl}" style="background: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
          View Dashboard
        </a>
        <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">Enter your email (${client.email}) on the login page to receive a magic link.</p>
      </div>
    `,
  })

  return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/admin/clients/${clientId}?invited=true`)
}
