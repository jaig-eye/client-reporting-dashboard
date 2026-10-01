// Shared plumbing for the Google and Meta sign-in flows (/api/auth/{google,meta}/{start,callback}).
//
// Two jobs:
//   1. Only a signed-in admin can connect an account, and only to a flow they started. The
//      callbacks used to save whatever tokens arrived, with no session check and no state check —
//      so anyone could run the flow with their own Google or Meta account and replace the
//      agency's connection. Now: start requires an admin, sets a one-time nonce cookie and puts the
//      nonce in `state`; the callback requires the admin again and the matching nonce.
//   2. The flow can run in a popup. Google refuses to show its sign-in inside an iframe, and the
//      admin is embedded in the CRM — so a popup is the only way it works there. A popup callback
//      answers with a tiny page that tells the opener the result and closes; the page that opened
//      it refreshes in place. Without a popup (opened directly), it redirects as before.

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { requireWriteAdmin } from '@/lib/auth'

const NONCE_COOKIE = 'oauth_nonce'
const NONCE_TTL_S  = 15 * 60

export interface OAuthState {
  nonce?: string
  popup?: boolean
  [k: string]: unknown
}

export function appUrlFrom(request: NextRequest): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin).replace(/\/$/, '')
}

/** Encode state for the provider. */
export function encodeState(state: OAuthState): string {
  return Buffer.from(JSON.stringify(state)).toString('base64url')
}

/** Decode state from the provider; {} when absent or malformed. */
export function decodeState(raw: string | null): OAuthState {
  if (!raw) return {}
  try { return JSON.parse(Buffer.from(raw, 'base64url').toString()) as OAuthState } catch { return {} }
}

/**
 * Start a flow: require an admin, mint a nonce, and redirect to the provider with the nonce in
 * state and in a short-lived httpOnly cookie. `buildUrl` gets the encoded state.
 */
export async function beginOAuth(
  request: NextRequest,
  state: Omit<OAuthState, 'nonce' | 'popup'>,
  buildUrl: (encodedState: string) => string,
): Promise<NextResponse> {
  const popup = request.nextUrl.searchParams.get('popup') === '1'
  const gate = await requireWriteAdmin()
  if (!gate.ok) {
    return finishOAuth(request, { popup }, { ok: false, provider: 'oauth', error: 'Sign in to the admin first, then connect again.', path: '/admin' })
  }
  const nonce = randomBytes(18).toString('base64url')
  const res = NextResponse.redirect(buildUrl(encodeState({ ...state, nonce, popup })))
  res.cookies.set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    // Lax is enough: the provider brings the browser back with a top-level GET.
    sameSite: 'lax',
    path:     '/api/auth',
    maxAge:   NONCE_TTL_S,
  })
  return res
}

/**
 * Check a callback: a signed-in admin, and the state's nonce matching the cookie this browser got
 * at the start. Returns an error message, or null when the callback may proceed.
 */
export async function verifyOAuthCallback(request: NextRequest, state: OAuthState): Promise<string | null> {
  const gate = await requireWriteAdmin()
  if (!gate.ok) return 'Your admin session ended. Sign in and connect again.'
  const cookie = request.cookies.get(NONCE_COOKIE)?.value ?? ''
  const nonce  = typeof state.nonce === 'string' ? state.nonce : ''
  if (!cookie || !nonce || cookie.length !== nonce.length || !timingSafeEqual(Buffer.from(cookie), Buffer.from(nonce))) {
    return 'This sign-in didn’t start here, or took too long. Start it again from Integrations.'
  }
  return null
}

/**
 * End a flow. In a popup: a page that tells the opener and closes. Otherwise: a redirect to
 * `path` (relative to the app) — the old behaviour. The nonce cookie is cleared either way.
 */
export function finishOAuth(
  request: NextRequest,
  state: OAuthState,
  result: { ok: boolean; provider: string; error?: string; path: string },
): NextResponse {
  const appUrl = appUrlFrom(request)
  let res: NextResponse
  if (state.popup) {
    const payload = JSON.stringify({ source: 'agency-oauth', provider: result.provider, ok: result.ok, error: result.error ?? null })
      .replace(/</g, '\\u003c')
    const origin = JSON.stringify(new URL(appUrl).origin)
    const fallback = `${appUrl}${result.path}`
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${result.ok ? 'Connected' : 'Not connected'}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#f8f9fb;color:#111827}main{max-width:360px;padding:24px;text-align:center}a{color:#2563eb}</style></head>
<body><main><p><strong>${result.ok ? 'Connected.' : 'Not connected.'}</strong></p><p>${result.ok ? 'You can close this window.' : escapeHtml(result.error ?? 'Something went wrong.')}</p><p><a href="${escapeHtml(fallback)}">Back to the admin</a></p></main>
<script>(function(){var d=${payload};try{if(window.opener&&!window.opener.closed){window.opener.postMessage(d,${origin});window.close();}}catch(e){}})();</script></body></html>`
    res = new NextResponse(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
  } else {
    const url = new URL(result.path, appUrl)
    res = NextResponse.redirect(url.toString())
  }
  res.cookies.set(NONCE_COOKIE, '', { path: '/api/auth', maxAge: 0 })
  return res
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
