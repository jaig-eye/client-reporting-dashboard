// POST /api/admin/content/pages/queue
// Wizard submission handler — creates content_topics for service/regular pages
// and optionally fires generation immediately.

import { internalAdminCookie } from '@/lib/session'
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil }                 from '@vercel/functions'
import { isAdminAuthed }             from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase/server'
import { logActivity }               from '@/lib/activity'

const MAX_PAGES = 25

interface PageEntry {
  title: string
  slug:  string  // bare slug segment only, e.g. "drain-cleaning"
}

interface Body {
  client_id:         string
  content_type:      'service_page' | 'regular_page'
  pages:             PageEntry[]
  delivery:          'immediate' | 'spaced'
  space_interval?:   string   // 'daily' | 'every2' | 'weekly' | 'biweekly'
  space_start_date?: string   // ISO date — required when delivery === 'spaced'
}

const INTERVAL_DAYS: Record<string, number> = {
  daily:    1,
  every2:   2,
  weekly:   7,
  biweekly: 14,
}

function spacedDate(startDate: string, index: number, interval: string): string {
  const days = INTERVAL_DAYS[interval] ?? 7
  const d    = new Date(startDate + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + index * days)
  return d.toISOString().slice(0, 10)
}

export async function POST(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Body
  try {
    body = await request.json() as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { client_id, content_type, pages, delivery, space_interval, space_start_date } = body

  if (!client_id || !content_type || !Array.isArray(pages) || pages.length === 0) {
    return NextResponse.json({ error: 'client_id, content_type, and pages are required' }, { status: 400 })
  }

  if (!['service_page', 'regular_page'].includes(content_type)) {
    return NextResponse.json({ error: 'content_type must be service_page or regular_page' }, { status: 400 })
  }

  if (pages.length > MAX_PAGES) {
    return NextResponse.json({ error: `Maximum ${MAX_PAGES} pages per submission` }, { status: 400 })
  }

  if (delivery === 'spaced' && !space_start_date) {
    return NextResponse.json({ error: 'space_start_date is required for spaced delivery' }, { status: 400 })
  }

  const db       = createAdminClient()
  const todayStr = new Date().toISOString().slice(0, 10)

  const rows = pages.map((page, i) => {
    const publishDate = delivery === 'spaced' && space_start_date
      ? spacedDate(space_start_date, i, space_interval ?? 'weekly')
      : todayStr

    return {
      client_id,
      content_type,
      topic:               page.title,
      target_keyword:      page.title,
      custom_slug:         page.slug || null,
      status:              'approved',
      target_publish_date: publishDate,
      rationale:           'Queued via Page Generation Wizard',
    }
  })

  const { data: inserted, error: insertErr } = await db
    .from('content_topics')
    .insert(rows)
    .select('id, topic, custom_slug, target_publish_date, content_type')

  if (insertErr || !inserted) {
    console.error('[pages/queue] insert error:', insertErr)
    return NextResponse.json({ error: 'Failed to create topics' }, { status: 500 })
  }

  logActivity(null, 'queued_pages', 'content_topics', {
    clientId: client_id,
    meta: { count: inserted.length, content_type, delivery },
  })

  // For immediate delivery: fire generation for each topic.
  // waitUntil keeps the Vercel function alive until all fetches complete.
  if (delivery === 'immediate') {
    // Derived from the incoming request, not an env var with a localhost default.
    // The Cookie below carries a real 14-day super-admin session token, and the
    // old `?? 'http://localhost:3000'` fallback would have sent it in cleartext
    // HTTP to whatever happened to be listening on the container's own port 3000
    // if NEXT_PUBLIC_APP_URL were unset. Using request.nextUrl.origin also means
    // preview deployments call themselves rather than production.
    const appUrl = request.nextUrl.origin

    // Minted ONCE per request, not once per topic inside the loop.
    const internalCookie = internalAdminCookie()

    waitUntil(
      Promise.allSettled(
        (inserted as { id: string }[]).map(async (topic) => {
          try {
            await Promise.resolve(db.from('content_topics').update({ status: 'generating' }).eq('id', topic.id))
            const res = await fetch(`${appUrl}/api/admin/content/generate`, {
              method:  'POST',
              headers: {
                'Content-Type': 'application/json',
                'Cookie': internalCookie,
              },
              body: JSON.stringify({ topic_id: topic.id, suppress_email: true }),
            })
            if (!res.ok) {
              const text = await res.text().catch(() => '')
              console.error('[pages/queue] generation failed for topic', topic.id, res.status, text)
              await Promise.resolve(db.from('content_topics').update({ status: 'approved' }).eq('id', topic.id)).catch(() => {})
            }
          } catch (e) {
            console.error('[pages/queue] generation error for topic', topic.id, e)
            await Promise.resolve(db.from('content_topics').update({ status: 'approved' }).eq('id', topic.id)).catch(() => {})
          }
        })
      )
    )
  }

  return NextResponse.json({
    total:      inserted.length,
    generating: delivery === 'immediate',
    topics:     inserted,
  })
}
