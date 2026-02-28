import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')?.value
  if (!session || session !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { name, email, slug } = await request.json()
  if (!name || !email || !slug) {
    return NextResponse.json({ error: 'name, email, and slug are required' }, { status: 400 })
  }

  const db = createAdminClient()
  const { data, error } = await db
    .from('clients')
    .insert({ name, email, slug })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}
