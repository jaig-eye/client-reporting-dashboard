// POST /api/admin/content/posts/[id]/scan-links
// Extracts all links and phone numbers from a post and does a HEAD check on each URL.
// Results are ephemeral (not persisted). Capped at 50 URLs, 10s total timeout.

import { NextRequest, NextResponse } from 'next/server'
import { cookies }         from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed }   from '@/lib/auth'
import { isPublicUrl }     from '@/lib/ssrf'
import { PLATFORM_BOT_UA } from '@/lib/platformBot'

export const maxDuration = 30

interface LinkResult {
  url:        string
  status:     number | null
  ok:         boolean
  redirected: boolean
  finalUrl:   string | null
  error?:     string
}

interface PhoneResult {
  raw:    string
  digits: string
  valid:  boolean
}

function extractLinks(html: string): string[] {
  const hrefs: string[] = []
  const re = /href\s*=\s*["']([^"'#]+)["']/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const href = m[1].trim()
    if (!href || /^(mailto:|tel:|javascript:)/i.test(href)) continue
    if (href.startsWith('http://') || href.startsWith('https://')) {
      hrefs.push(href)
    }
  }
  // Deduplicate
  return Array.from(new Set(hrefs)).slice(0, 50)
}

function extractPhones(html: string): string[] {
  // Extract tel: hrefs and phone-like patterns in text
  const phones: string[] = []
  const telRe = /href\s*=\s*["']tel:([^"']+)["']/gi
  let m: RegExpExecArray | null
  while ((m = telRe.exec(html)) !== null) phones.push(m[1].trim())
  // Plain text phone patterns
  const textRe = /\b(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g
  const stripped = html.replace(/<[^>]+>/g, ' ')
  while ((m = textRe.exec(stripped)) !== null) phones.push(m[0].trim())
  return Array.from(new Set(phones)).slice(0, 20)
}

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '')
}

function isValidNANP(digits: string): boolean {
  const d = digits.replace(/^1/, '')
  return d.length === 10 && /^[2-9]/.test(d) && /^[2-9]/.test(d[3])
}

async function checkLink(url: string, signal: AbortSignal): Promise<LinkResult> {
  if (!isPublicUrl(url)) {
    return { url, status: null, ok: false, redirected: false, finalUrl: null, error: 'blocked (private URL)' }
  }
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': PLATFORM_BOT_UA },
      redirect: 'follow',
      signal,
    })
    return {
      url,
      status:     res.status,
      ok:         res.status < 400,
      redirected: res.redirected,
      finalUrl:   res.redirected ? res.url : null,
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      return { url, status: null, ok: false, redirected: false, finalUrl: null, error: 'timeout' }
    }
    // Some servers reject HEAD — retry with GET (range: 0 bytes to avoid downloading body)
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': PLATFORM_BOT_UA, Range: 'bytes=0-0' },
        redirect: 'follow',
        signal,
      })
      return {
        url,
        status:     res.status,
        ok:         res.status < 400 || res.status === 206,
        redirected: res.redirected,
        finalUrl:   res.redirected ? res.url : null,
      }
    } catch {
      return { url, status: null, ok: false, redirected: false, finalUrl: null, error: 'fetch failed' }
    }
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const db = createAdminClient()

  const { data: post, error } = await db
    .from('content_posts')
    .select('id, content')
    .eq('id', id)
    .maybeSingle()

  if (error || !post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }

  const html = (post as { id: string; content: string | null }).content ?? ''
  const urls  = extractLinks(html)
  const rawPhones = extractPhones(html)

  // 10s total budget for all URL checks
  const controller = new AbortController()
  const timeout    = setTimeout(() => controller.abort(), 10_000)

  const linkResults = await Promise.allSettled(
    urls.map(url => checkLink(url, controller.signal))
  ).finally(() => clearTimeout(timeout))

  const links: LinkResult[] = linkResults.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { url: urls[i], status: null, ok: false, redirected: false, finalUrl: null, error: 'error' }
  )

  const phones: PhoneResult[] = rawPhones.map(raw => {
    const digits = normalizePhone(raw)
    return { raw, digits, valid: isValidNANP(digits) }
  })

  return NextResponse.json({
    links,
    phones,
    scannedAt: new Date().toISOString(),
  })
}
