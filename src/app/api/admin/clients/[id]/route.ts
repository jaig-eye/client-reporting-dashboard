import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'

function isAdminAuthed(session: string | undefined) {
  return session && session === process.env.ADMIN_PASSWORD
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await request.json()

  const allowed = [
    'logo_url',
    'benchmark_roas', 'benchmark_ctr', 'benchmark_cpc',
    'benchmark_conv_rate', 'benchmark_cpm',
    'metric_config',
  ]
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) patch[key] = body[key] // null allowed — clears override
  }

  const db = createAdminClient()
  const { data, error } = await db
    .from('clients')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Invalidate Next.js Data Cache so the client page and metric-mapping always serve fresh DB data
  revalidatePath(`/admin/clients/${id}`)
  revalidatePath('/admin/metric-mapping')
  revalidatePath('/admin')

  return NextResponse.json(data)
}
