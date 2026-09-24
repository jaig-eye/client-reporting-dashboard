// ─────────────────────────────────────────────────────────────────────────────
// TEMPORARY — DELETE THIS FILE BEFORE MERGING.
//
// A single self-contained diagnostic page for evaluating the content changes before they ship.
// Nothing imports it and it changes no UI, so removing it is `rm -r` on its one folder.
//
// (Named without a leading underscore on purpose: Next.js treats _folders as private and excludes
// them from routing, so an underscored version of this returns 404.)
//
// Open it in a browser while signed in as admin:
//
//   /api/admin/content/preview-insights?client_id=<uuid>
//   /api/admin/content/preview-insights                  ← lists clients to pick from
//
// It answers the two questions that matter before merging:
//
//   1. WHAT DOES THE PIPELINE SEE NOW? Every keyword source, with counts and samples, plus the
//      keywords the cannibalization guard would protect and the word budget that will be enforced.
//      This is the input side, which is otherwise only visible in Vercel logs.
//
//   2. WHAT IS THE OUTPUT ACTUALLY LIKE? Recent posts with their real word counts against the
//      range their client is configured for, plus internal links and headings — so over-writing,
//      under-writing and structural loss are all readable at a glance.
//
// READ-ONLY. No AI calls, no DataForSEO calls, no writes, nothing billed. Every query soft-fails
// on its own, so a client with no Ahrefs or no migrations applied still renders the rest.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const esc = (v: unknown) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

type Row = Record<string, unknown>

/** Run a query, returning [] and a note rather than throwing when the table or column is absent. */
async function safe<T = Row>(label: string, q: PromiseLike<{ data: unknown; error: unknown }>,
): Promise<{ rows: T[]; note: string | null }> {
  try {
    const { data, error } = await q
    if (error) return { rows: [], note: (error as { message?: string }).message ?? 'query failed' }
    return { rows: (data ?? []) as T[], note: null }
  } catch (e) {
    return { rows: [], note: String(e).slice(0, 120) }
  }
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthed(req.cookies.get('admin_session')?.value)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  const db = createAdminClient()
  const clientId = req.nextUrl.searchParams.get('client_id')

  // ── No client chosen: list the ones with a content programme ──────────────
  if (!clientId) {
    const { rows } = await safe('clients', db
      .from('content_settings').select('client_id, target_length, client:clients(name)').limit(100))
    const items = rows.map(r => {
      const c = Array.isArray(r.client) ? r.client[0] : r.client
      const name = (c as Row | null)?.name ?? r.client_id
      return `<li><a href="?client_id=${esc(r.client_id)}">${esc(name)}</a></li>`
    }).join('')
    return html(`<h1>Content insights</h1><p>Pick a client.</p><ul>${items || '<li>No content clients.</li>'}</ul>`)
  }

  const since90 = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)

  const [clientRes, settingsRes, paidRes, ahrefsRes, gscRes, trackedRes, researchRes, postsRes] = await Promise.all([
    safe('client',   db.from('clients').select('name').eq('id', clientId).limit(1)),
    safe('settings', db.from('content_settings')
      .select('target_length, posts_per_run, schedule_frequency, schedule_day_of_week, publish_time')
      .eq('client_id', clientId).limit(1)),
    safe('paid', db.from('google_ads_search_terms')
      .select('search_term, conversions').eq('client_id', clientId).gte('date', since90).gt('conversions', 0).limit(500)),
    safe('ahrefs', db.from('ahrefs_keywords')
      .select('keyword, position, volume').eq('client_id', clientId).order('date', { ascending: false }).limit(300)),
    safe('gsc', db.from('gsc_metrics')
      .select('query, position, impressions, clicks').eq('client_id', clientId).gte('date', since90).limit(3000)),
    safe('tracked', db.from('seo_keywords')
      .select('keyword, is_tracked, content_post_id').eq('client_id', clientId).eq('is_tracked', true).limit(300)),
    safe('research', db.from('seo_keywords')
      .select('keyword, search_volume, keyword_difficulty, intent')
      .eq('client_id', clientId).eq('is_tracked', false).is('content_post_id', null).limit(300)),
    safe('posts', db.from('content_posts')
      .select('title, word_count, internal_links, heading_count, seo_score, status, generated_at')
      .eq('client_id', clientId).not('word_count', 'is', null)
      .order('generated_at', { ascending: false }).limit(25)),
  ])

  const clientName = esc((clientRes.rows[0] as Row | undefined)?.name ?? clientId)
  const s = (settingsRes.rows[0] ?? {}) as Row
  const target = Number(s.target_length ?? 1500) || 1500
  const floor  = Math.round(target * 0.9)
  const ceil   = Math.round(target * 1.15)
  const perRun = Number(s.posts_per_run ?? 1) || 1

  // ── The guard's protected set, built the way generateTopics builds it ─────
  // GSC top-5 with clicks, Ahrefs page one, tracked top-10.
  const gscAgg = new Map<string, { pos: number; impr: number; clicks: number; n: number }>()
  for (const r of gscRes.rows) {
    const q = String(r.query ?? '')
    if (!q) continue
    const a = gscAgg.get(q) ?? { pos: 0, impr: 0, clicks: 0, n: 0 }
    a.pos += Number(r.position) || 0
    a.impr += Number(r.impressions) || 0
    a.clicks += Number(r.clicks) || 0
    a.n += 1
    gscAgg.set(q, a)
  }
  const gscRows = Array.from(gscAgg.entries())
    .map(([query, a]) => ({ query, position: a.n ? a.pos / a.n : 0, impressions: a.impr, clicks: a.clicks }))
  const gscProtected = gscRows.filter(r => r.position >= 1 && r.position <= 4 && r.clicks > 0)
  const ahrefsLatest = new Map<string, Row>()
  for (const r of ahrefsRes.rows) {            // already ordered newest-first
    const k = String(r.keyword ?? '').toLowerCase()
    if (k && !ahrefsLatest.has(k)) ahrefsLatest.set(k, r)
  }
  const ahrefsProtected = Array.from(ahrefsLatest.values())
    .filter(r => Number(r.position) > 0 && Number(r.position) <= 10)

  const paidAgg = new Map<string, number>()
  for (const r of paidRes.rows) {
    const t = String(r.search_term ?? '')
    if (t) paidAgg.set(t, (paidAgg.get(t) ?? 0) + (Number(r.conversions) || 0))
  }
  const paidTop = Array.from(paidAgg.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10)

  // ── Output: real posts against the range their client is set to ───────────
  const posts = postsRes.rows.map(p => {
    const w = Number(p.word_count) || 0
    return {
      title: esc(p.title), words: w, links: Number(p.internal_links) || 0,
      headings: Number(p.heading_count) || 0,
      seo: Number.isFinite(Number(p.seo_score)) ? Number(p.seo_score) : null,
      verdict: w === 0 ? '—' : w > ceil ? 'over' : w < floor ? 'under' : 'in range',
      when: esc(String(p.generated_at ?? '').slice(0, 10)),
    }
  })
  const scored = posts.filter(p => p.words > 0)
  const over  = scored.filter(p => p.verdict === 'over').length
  const under = scored.filter(p => p.verdict === 'under').length
  const avg   = scored.length ? Math.round(scored.reduce((t, p) => t + p.words, 0) / scored.length) : 0

  const src = (name: string, live: boolean, count: number, note: string | null, sample: string) => `
    <tr>
      <td>${esc(name)}</td>
      <td class="${live ? 'ok' : 'off'}">${live ? 'live' : 'not available'}</td>
      <td class="n">${count}</td>
      <td class="muted">${note ? esc(note) : esc(sample)}</td>
    </tr>`

  return html(`
    <h1>${clientName}</h1>
    <p class="muted">Read-only. Nothing here calls an AI or DataForSEO, and nothing is written.</p>

    <h2>Settings the pipeline will enforce</h2>
    <table>
      <tr><th>Word target</th><td>${target.toLocaleString()}</td></tr>
      <tr><th>Enforced range</th><td><strong>${floor.toLocaleString()}–${ceil.toLocaleString()}</strong> — anything longer gets one revision pass</td></tr>
      <tr><th>Cadence</th><td>${esc(s.schedule_frequency ?? 'weekly')} × ${perRun} post${perRun === 1 ? '' : 's'}${perRun > 1 ? ' (staggered 2h apart)' : ''}</td></tr>
      <tr><th>Publish time</th><td>${esc(s.publish_time ?? '09:00')}</td></tr>
    </table>

    <h2>Keyword sources feeding topic selection</h2>
    <table>
      <tr><th>Source</th><th>State</th><th class="n">Rows</th><th>Sample / note</th></tr>
      ${src('Search Console (primary driver)', gscRes.rows.length > 0, gscAgg.size, gscRes.note,
            gscRows.slice(0, 3).map(r => r.query).join(', '))}
      ${src('Google Ads converting terms', paidAgg.size > 0, paidAgg.size, paidRes.note,
            paidTop.slice(0, 3).map(([t, c]) => `${t} (${c.toFixed(1)})`).join(', '))}
      ${src('Ahrefs positions', ahrefsLatest.size > 0, ahrefsLatest.size, ahrefsRes.note,
            Array.from(ahrefsLatest.values()).slice(0, 3).map(r => `${r.keyword} #${r.position}`).join(', '))}
      ${src('DataForSEO research candidates', researchRes.rows.length > 0, researchRes.rows.length, researchRes.note,
            researchRes.rows.slice(0, 3).map(r => `${r.keyword} (${r.search_volume ?? '?'}/mo)`).join(', '))}
      ${src('Tracked keyword ranks', trackedRes.rows.length > 0, trackedRes.rows.length, trackedRes.note,
            trackedRes.rows.slice(0, 3).map(r => String(r.keyword)).join(', '))}
    </table>
    <p class="muted">A source showing <em>not available</em> simply does not render in the prompt — selection runs on the rest.</p>

    <h2>Cannibalization guard — what it would protect</h2>
    <p class="muted">A topic targeting one of these exactly is dropped. A longer variant is kept but demoted to a supporting article pointed at the ranking page.</p>
    <table>
      <tr><th>From</th><th class="n">Protected</th><th>Examples</th></tr>
      <tr><td>Search Console top-5 with clicks</td><td class="n">${gscProtected.length}</td>
          <td class="muted">${esc(gscProtected.slice(0, 4).map(r => `${r.query} (#${r.position.toFixed(0)})`).join(', ')) || '—'}</td></tr>
      <tr><td>Ahrefs page one</td><td class="n">${ahrefsProtected.length}</td>
          <td class="muted">${esc(ahrefsProtected.slice(0, 4).map(r => `${r.keyword} (#${r.position})`).join(', ')) || '—'}</td></tr>
      <tr><td>Tracked top-10 (DataForSEO)</td><td class="n">${trackedRes.rows.length}</td>
          <td class="muted">${esc(trackedRes.rows.slice(0, 4).map(r => String(r.keyword)).join(', ')) || '—'}</td></tr>
    </table>

    <h2>Output — the last ${posts.length} generated posts</h2>
    <p>Average <strong>${avg.toLocaleString()}</strong> words against a ${target.toLocaleString()} target.
       <strong>${over}</strong> over the ${ceil.toLocaleString()} ceiling, <strong>${under}</strong> under ${floor.toLocaleString()}.</p>
    <p class="muted">Posts generated before this branch will show the old behaviour; ones generated after should sit in range. That comparison is the point of this page.</p>
    <table>
      <tr><th>Generated</th><th>Title</th><th class="n">Words</th><th>Length</th><th class="n">Links</th><th class="n">H2/H3</th><th class="n">SEO</th></tr>
      ${posts.map(p => `<tr>
        <td class="muted">${p.when}</td>
        <td>${p.title}</td>
        <td class="n">${p.words.toLocaleString()}</td>
        <td class="${p.verdict === 'in range' ? 'ok' : p.verdict === '—' ? 'muted' : 'warn'}">${p.verdict}</td>
        <td class="n">${p.links}</td>
        <td class="n">${p.headings}</td>
        <td class="n">${p.seo ?? '—'}</td>
      </tr>`).join('') || '<tr><td colspan="7" class="muted">No generated posts yet.</td></tr>'}
    </table>
    ${postsRes.note ? `<p class="warn">posts query: ${esc(postsRes.note)}</p>` : ''}

    <p class="muted" style="margin-top:2rem">
      To compare against the new pipeline: approve a topic, hit Generate, and reload this page —
      the new post appears at the top of the table.
    </p>`)
}

function html(body: string): NextResponse {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
     <title>Content insights (temporary)</title>
     <style>
       :root { color-scheme: light dark; }
       body { font: 14px/1.55 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
              margin: 0 auto; padding: 2rem 1rem; max-width: 1100px; }
       h1 { font-size: 1.4rem; margin: 0 0 .25rem; }
       h2 { font-size: .95rem; text-transform: uppercase; letter-spacing: .05em;
            margin: 2rem 0 .5rem; opacity: .65; }
       table { width: 100%; border-collapse: collapse; margin-bottom: .5rem; }
       th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid rgba(128,128,128,.25);
                vertical-align: top; }
       th { font-weight: 600; font-size: .78rem; opacity: .7; }
       .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
       .muted { opacity: .6; }
       .ok { color: #16794a; } .warn { color: #a3541a; } .off { opacity: .45; }
       @media (prefers-color-scheme: dark) { .ok { color: #4ade80; } .warn { color: #fbbf24; } }
       a { color: inherit; }
     </style>${body}`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}
