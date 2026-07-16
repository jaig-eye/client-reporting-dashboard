/**
 * GET /api/cron/site-audits
 *
 * Runs weekly SEO audits for all sites that have audit_enabled = true
 * and haven't been audited in the last 6 days. Triggered by Vercel Cron
 * every Monday at 3 AM UTC (see vercel.json).
 *
 * Auth: Authorization: Bearer CRON_SECRET
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { runSiteAudit } from '@/lib/siteAudit'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300   // 5 minutes for bulk runs

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db      = createAdminClient()
  const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString()

  // Sites due for a fresh audit
  const { data: sites, error } = await db
    .from('sites')
    .select('id, url, client_id, audit_scope')
    .eq('audit_enabled', true)
    .eq('status', 'active')
    .or(`last_audit_at.is.null,last_audit_at.lte.${sixDaysAgo}`)
    .limit(20)   // cap per run to stay within the 5-min budget

  if (error) {
    console.error('[cron/site-audits]', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!sites || sites.length === 0) {
    return NextResponse.json({ ok: true, audited: 0 })
  }

  const results: Array<{ siteId: string; status: string; pages?: number; score?: number; error?: string }> = []

  for (const site of sites as Array<{ id: string; url: string; client_id: string | null; audit_scope: string }>) {
    // Resolve key pages from content_sitemap_pages
    let keyPages: string[] = []
    if ((site.audit_scope ?? 'key') === 'key' && site.client_id) {
      const { data: sitemapPages } = await db
        .from('content_sitemap_pages')
        .select('url')
        .eq('client_id', site.client_id)
        .eq('is_excluded', false)
        .or('is_priority.eq.true,is_service_page.eq.true')
        .limit(50)
      keyPages = (sitemapPages ?? []).map((r: { url: string }) => r.url)
    }

    // Create audit record
    const { data: auditRow, error: insertErr } = await db
      .from('site_audits')
      .insert({ site_id: site.id, status: 'running', source: 'crawler', scope: site.audit_scope ?? 'key' })
      .select()
      .single()

    if (insertErr || !auditRow) {
      results.push({ siteId: site.id, status: 'failed', error: insertErr?.message })
      continue
    }

    try {
      const result = await runSiteAudit({
        baseUrl:  site.url,
        scope:    (site.audit_scope ?? 'key') as 'key' | 'all',
        keyPages,
      })

      if (result.pages.length > 0) {
        await db.from('site_audit_pages').insert(
          result.pages.map(p => ({
            audit_id:        auditRow.id,
            site_id:         site.id,
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
      }

      await Promise.all([
        db.from('site_audits').update({
          status: 'completed', source: result.source,
          pages_crawled: result.pages.length,
          score: result.score, errors: result.errors, warnings: result.warnings,
          completed_at: new Date().toISOString(),
        }).eq('id', auditRow.id),

        db.from('sites').update({
          last_audit_at: new Date().toISOString(),
          audit_score: result.score, audit_errors: result.errors, audit_warnings: result.warnings,
        }).eq('id', site.id),
      ])

      results.push({ siteId: site.id, status: 'completed', pages: result.pages.length, score: result.score })

    } catch (err) {
      await db.from('site_audits').update({
        status: 'failed', error_message: String(err), completed_at: new Date().toISOString(),
      }).eq('id', auditRow.id)

      results.push({ siteId: site.id, status: 'failed', error: String(err) })
    }
  }

  console.log('[cron/site-audits] completed', results)
  return NextResponse.json({ ok: true, audited: results.length, results })
}