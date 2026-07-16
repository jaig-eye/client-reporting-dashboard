/**
 * GET  /api/admin/sites/[id]/audit  — fetch latest audit run + pages
 * POST /api/admin/sites/[id]/audit  — trigger a new audit (runs synchronously, ~15-45s)
 *
 * The POST also accepts { enabled, scope } to update the site's audit settings
 * before running, so the toggle + immediate first run is a single request.
 */

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'
import { runSiteAudit } from '@/lib/siteAudit'

export const dynamic      = 'force-dynamic'
export const maxDuration  = 60   // seconds — requires Vercel Pro; on Hobby it's capped at 10s

/* ── GET ──────────────────────────────────────────────────────────── */

export async function GET(
  _: NextRequest,
  { params }: { params: { id: string } }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  const { data: audit, error: auditErr } = await db
    .from('site_audits')
    .select('*')
    .eq('site_id', params.id)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (auditErr) return NextResponse.json({ error: auditErr.message }, { status: 500 })
  if (!audit)   return NextResponse.json({ audit: null, pages: [] })

  const { data: pages, error: pagesErr } = await db
    .from('site_audit_pages')
    .select('*')
    .eq('audit_id', audit.id)
    .order('score', { ascending: true })   // worst pages first

  if (pagesErr) return NextResponse.json({ error: pagesErr.message }, { status: 500 })

  return NextResponse.json({ audit, pages: pages ?? [] })
}

/* ── POST ─────────────────────────────────────────────────────────── */

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({})) as {
    enabled?: boolean
    scope?:   'key' | 'all'
  }

  const db = createAdminClient()

  // 1. Load the site
  const { data: site, error: siteErr } = await db
    .from('sites')
    .select('id, url, client_id, audit_enabled, audit_scope')
    .eq('id', params.id)
    .maybeSingle()

  if (siteErr) return NextResponse.json({ error: siteErr.message }, { status: 500 })
  if (!site)   return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  // 2. Apply toggle / scope changes before running
  const newEnabled = body.enabled  ?? site.audit_enabled
  const newScope   = (body.scope   ?? site.audit_scope ?? 'key') as 'key' | 'all'

  if (body.enabled !== undefined || body.scope !== undefined) {
    await db.from('sites').update({
      audit_enabled: newEnabled,
      audit_scope:   newScope,
    }).eq('id', params.id)
  }

  // If being disabled, just update and return — no run needed
  if (!newEnabled) {
    return NextResponse.json({ ok: true, disabled: true })
  }

  // 3. Create audit record (status: 'running')
  const { data: auditRow, error: insertErr } = await db
    .from('site_audits')
    .insert({
      site_id: params.id,
      status:  'running',
      source:  'crawler',
      scope:   newScope,
    })
    .select()
    .single()

  if (insertErr || !auditRow) return NextResponse.json({ error: insertErr?.message ?? 'Failed to create audit record' }, { status: 500 })

  // 4. Resolve key pages from content_sitemap_pages (if client is linked)
  let keyPages: string[] = []
  if (newScope === 'key' && site.client_id) {
    const { data: sitemapPages } = await db
      .from('content_sitemap_pages')
      .select('url')
      .eq('client_id', site.client_id)
      .eq('is_excluded', false)
      .or('is_priority.eq.true,is_service_page.eq.true')
      .limit(50)
    keyPages = (sitemapPages ?? []).map((r: { url: string }) => r.url)
  }

  // 5. Run the crawl
  try {
    const result = await runSiteAudit({
      baseUrl:  site.url,
      scope:    newScope,
      keyPages,
    })

    // 6. Store page results
    if (result.pages.length > 0) {
      const { error: pagesInsertErr } = await db.from('site_audit_pages').insert(
        result.pages.map(p => ({
          audit_id:        auditRow.id,
          site_id:         params.id,
          url:             p.url,
          title:           p.title,
          title_length:    p.titleLength,
          meta_description: p.metaDescription,
          meta_length:     p.metaLength,
          h1_count:        p.h1Count,
          h1_text:         p.h1Text,
          word_count:      p.wordCount,
          imgs_total:      p.imgsTotal,
          imgs_no_alt:     p.imgsNoAlt,
          has_schema:      p.hasSchema,
          has_canonical:   p.hasCanonical,
          http_status:     p.httpStatus,
          score:           p.score,
          errors:          p.errors,
          warnings:        p.warnings,
          issues:          p.issues,
        }))
      )
      if (pagesInsertErr) throw new Error(`Failed to store page results: ${pagesInsertErr.message}`)
    }

    // 7. Mark audit completed + update site summary
    await Promise.all([
      db.from('site_audits').update({
        status:        'completed',
        source:        result.source,
        pages_crawled: result.pages.length,
        score:         result.score,
        errors:        result.errors,
        warnings:      result.warnings,
        completed_at:  new Date().toISOString(),
      }).eq('id', auditRow.id),

      db.from('sites').update({
        last_audit_at:  new Date().toISOString(),
        audit_score:    result.score,
        audit_errors:   result.errors,
        audit_warnings: result.warnings,
      }).eq('id', params.id),
    ])

    return NextResponse.json({
      audit: { ...auditRow, status: 'completed', ...result },
      pages: result.pages,
    })

  } catch (err) {
    // Mark failed so the cron can retry
    await db.from('site_audits').update({
      status:        'failed',
      error_message: String(err),
      completed_at:  new Date().toISOString(),
    }).eq('id', auditRow.id)

    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}