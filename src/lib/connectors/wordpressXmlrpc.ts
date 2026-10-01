// ─────────────────────────────────────────────────────────────────────────────
// Writing post meta WordPress's REST API refuses to accept.
//
// THE PROBLEM
//
// Rank Math keeps its SEO title, description and focus keyword as ordinary post meta, but never
// registers those keys with `show_in_rest`. The REST API only accepts a `meta` key that has been
// registered, and silently discards everything else — while still answering 200 with a complete
// post object. So a push looks perfect and sets nothing, and no amount of care on the REST side
// can change that.
//
// THE WAY ROUND IT
//
// XML-RPC's wp.editPost takes a `custom_fields` array and writes post meta directly. It never
// consults `show_in_rest`; WordPress checks only that the caller can edit that post's meta. And
// application passwords authenticate XML-RPC, so this needs no new credentials and nothing
// installed on the client's site.
//
// The catch is that xmlrpc.php is disabled on a lot of installs — hosts and security plugins turn
// it off because it is a brute-force and pingback-DDoS vector. So this is the second resort, after
// Rank Math's own updateMeta route (lib/connectors/rankMathApi): it runs only when that write
// failed for a reason other than "Rank Math is not installed", and only for the fields a read-back
// shows missing (every field, when nothing could be read). Where XML-RPC is blocked too, the
// caller reports it.
//
// wp.editPost re-saves the whole post through wp_update_post. Dates and status carry over
// unchanged, but save_post hooks fire and the modified date moves — another reason it is a
// fallback and not the first choice.
//
// UPDATE, NOT APPEND
//
// wp.editPost with a bare {key, value} calls add_post_meta, which appends another row for a key
// that already exists rather than replacing it — so repeated pushes would pile up duplicates and
// get_post_meta would keep returning the first, stale one. Passing the existing meta's `id` makes
// it an update instead, so this reads the current custom fields first.
//
// Everything here soft-fails. A site with XML-RPC disabled, a parse it does not recognise, or any
// network failure returns false; it never throws into a publish that already succeeded.
//
// REDIRECTS
//
// The application password travels in the request BODY here, not a header — so a redirect that
// fetch follows on its own would carry it to wherever the Location points, and a 307/308 re-sends
// the body verbatim. Requests go through fetchWithSiteCredentials, which follows same-site
// redirects only (at most three hops) and refuses anything else.
//
// They carry BROWSER_BOT_UA like every other WordPress call: sites behind Cloudflare or Wordfence
// are allow-listed on it and answer 403 without it.
// ─────────────────────────────────────────────────────────────────────────────

import { fetchWithSiteCredentials } from '@/lib/connectors/wordpress'
import { BROWSER_BOT_UA } from '@/lib/platformBot'

/** Bounds the whole exchange — the read and the write, redirects included — unless the caller asks for less. */
const XMLRPC_TIMEOUT_MS = 20_000

/** Escape a string for XML text content. Keyword and title values are arbitrary user text. */
function esc(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function unesc(v: string): string {
  return v
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function xmlrpcUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/xmlrpc.php`
}

/** POST a methodCall and return the raw XML body, or null when the endpoint is unusable. */
async function call(siteUrl: string, xml: string, signal: AbortSignal): Promise<string | null> {
  try {
    const res = await fetchWithSiteCredentials(xmlrpcUrl(siteUrl), {
      method:  'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'User-Agent': BROWSER_BOT_UA },
      body:    xml,
      signal,
    }, '[wp-xmlrpc]')
    // 403/404/405 is the normal shape of "xmlrpc.php is disabled here".
    if (!res.ok) {
      console.warn(`[wp-xmlrpc] ${siteUrl} returned ${res.status} — XML-RPC is probably disabled`)
      return null
    }
    const body = await res.text()
    // A fault is a well-formed response carrying an error; surface it rather than parsing on.
    if (/<fault>/i.test(body)) {
      const message = unesc(body.match(/<name>faultString<\/name>\s*<value>\s*(?:<string>)?([\s\S]*?)(?:<\/string>)?\s*<\/value>/i)?.[1]?.trim() ?? 'unknown fault')
      console.warn(`[wp-xmlrpc] ${siteUrl} fault: ${message.slice(0, 200)}`)
      return null
    }
    return body
  } catch (e) {
    // A refused redirect lands here too; fetchWithSiteCredentials has already logged why.
    console.warn(`[wp-xmlrpc] ${siteUrl} unreachable:`, String(e).slice(0, 160))
    return null
  }
}

/** One <member> of a struct. */
const member = (name: string, valueXml: string) => `<member><name>${name}</name><value>${valueXml}</value></member>`

/**
 * The post's current custom fields, as key → meta id.
 *
 * Needed so an existing key is updated rather than appended to. A key that is absent simply will
 * not appear, and the caller then sends it without an id, which creates it.
 */
async function existingFieldIds(
  siteUrl: string,
  auth: { username: string; app_password: string },
  postId: number,
  signal: AbortSignal,
): Promise<Map<string, string> | null> {
  const xml =
    `<?xml version="1.0"?><methodCall><methodName>wp.getPost</methodName><params>` +
    `<param><value><int>1</int></value></param>` +
    `<param><value><string>${esc(auth.username)}</string></value></param>` +
    `<param><value><string>${esc(auth.app_password)}</string></value></param>` +
    `<param><value><int>${postId}</int></value></param>` +
    `<param><value><array><data><value><string>custom_fields</string></value></data></array></value></param>` +
    `</params></methodCall>`

  const body = await call(siteUrl, xml, signal)
  if (body === null) return null

  // Each custom field arrives as its own <struct> carrying id, key and value members. Narrow
  // parsing on purpose: anything unrecognised yields no id, which degrades to "create" rather
  // than to a wrong update.
  const ids = new Map<string, string>()
  for (const block of body.match(/<struct>[\s\S]*?<\/struct>/g) ?? []) {
    const field = (name: string) =>
      block.match(new RegExp(`<name>${name}</name>\\s*<value>\\s*(?:<string>)?([\\s\\S]*?)(?:</string>)?\\s*</value>`, 'i'))?.[1]?.trim()
    const id = field('id')
    const key = field('key')
    if (id && key) ids.set(unesc(key), unesc(id))
  }
  return ids
}

/**
 * Write post meta over XML-RPC. Returns true only when WordPress accepted the edit.
 *
 * `meta` is key → value. Existing keys are updated in place; missing ones are created.
 * `timeoutMs` bounds both requests together, so the caller can fit them into the time it has left.
 */
export async function xmlrpcSetPostMeta(
  siteUrl: string,
  auth: { username: string; app_password: string },
  postId: number,
  meta: Record<string, string>,
  timeoutMs: number = XMLRPC_TIMEOUT_MS,
): Promise<boolean> {
  const entries = Object.entries(meta).filter(([, v]) => v !== undefined && v !== null)
  if (entries.length === 0) return true

  const signal = AbortSignal.timeout(Math.max(1, Math.min(timeoutMs, XMLRPC_TIMEOUT_MS)))
  const ids = await existingFieldIds(siteUrl, auth, postId, signal)
  // null means the endpoint is unusable — no point attempting the write.
  if (ids === null) return false

  const fields = entries.map(([key, value]) => {
    const id = ids.get(key)
    return `<value><struct>` +
      (id ? member('id', `<string>${esc(id)}</string>`) : '') +
      member('key',   `<string>${esc(key)}</string>`) +
      member('value', `<string>${esc(String(value))}</string>`) +
      `</struct></value>`
  }).join('')

  const xml =
    `<?xml version="1.0"?><methodCall><methodName>wp.editPost</methodName><params>` +
    `<param><value><int>1</int></value></param>` +
    `<param><value><string>${esc(auth.username)}</string></value></param>` +
    `<param><value><string>${esc(auth.app_password)}</string></value></param>` +
    `<param><value><int>${postId}</int></value></param>` +
    `<param><value><struct>` +
      member('custom_fields', `<array><data>${fields}</data></array>`) +
    `</struct></value></param>` +
    `</params></methodCall>`

  const body = await call(siteUrl, xml, signal)
  if (body === null) return false
  // wp.editPost answers <boolean>1</boolean> on success.
  return /<boolean>\s*1\s*<\/boolean>/.test(body)
}
