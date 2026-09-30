// The dead-credential rule, run over the real error strings from ninety days of production
// sync_jobs (2026-07-02 → 2026-09-30), plus the failures that have not happened yet but must alert.
const test = require('node:test'); const assert = require('node:assert/strict')
const path = require('path')
const { isDeadCredentialError } = require(path.join(process.env.WT, 'src/lib/connectors/authFailure.ts'))
const { metaTokenExpiry } = require(path.join(process.env.WT, 'src/lib/connectors/meta-ads.ts'))

const QUIET = [
  ['GHL location inactive (79 in prod)', 'GHL sync failed: Error: GHL API error 401: {"statusCode":401,"message":"Location is not active"}'],
  ['GHL command timed out (46)', 'GHL sync failed: Error: GHL API error 401: {"statusCode":401,"message":"Command timed out"}'],
  ['stale job (72)', 'Job timed out (stale)'],
  ['Meta service unavailable (30)', 'Error: Meta API error 400: {"error":{"message":"Service temporarily unavailable","type":"OAuthException","is_transient":false,"code":2,"error_subcode":1504044}}'],
  ['DB statement timeout (13)', 'Error: google_ads_search_terms upsert failed: canceling statement due to statement timeout'],
  ['Meta unknown 500 (6)', 'Error: Meta API error 500: {"error":{"code":1,"message":"An unknown error occurred","error_subcode":99}}'],
  ['Meta retry later (4)', 'Error: Meta API error 500: {"error":{"message":"An unexpected error has occurred. Please retry your request later.","type":"OAuthException","is_transient":true,"code":2}}'],
  ['schema cache (4)', 'Error: google_ads_search_terms upsert failed: Could not query the database for the schema cache. Retrying.'],
  ['Google refresh internal_failure (3)', 'Error: Google token refresh failed: internal_failure'],
  ['Meta request limit (2)', 'Error: Meta API error 403: {"error":{"message":"Application request limit reached","type":"OAuthException","is_transient":true,"code":4}}'],
  ['Google Ads 500 (2)', 'Error: Google Ads query failed 500: { "error": { "code": 500, "message": "Internal error encountered.", "status": "INTERNAL" } }'],
  ['empty message', ''],
  ['code 1900 is not code 190', 'Error: something failed with code: 1900'],
]
const ALERT = [
  ['Meta session expired (51 in prod)', 'Error: Meta API error 400: {"error":{"message":"Error validating access token: Session has expired on Friday, 25-Sep-26 08:36:39 PDT.","type":"OAuthException","code":190,"error_subcode":463}}'],
  ['Meta password changed', 'Error: Meta API error 400: {"error":{"message":"Error validating access token: The session has been invalidated because the user changed their password","code":190}}'],
  ['Google refresh token revoked', 'Error: Google token refresh failed: invalid_grant'],
  ['Google Ads unauthenticated', 'Error: Google Ads query failed 401: { "error": { "code": 401, "status": "UNAUTHENTICATED" } }'],
  ['Ahrefs key revoked', 'Error: Ahrefs API error 401: {"error":"Unauthorized"}'],
  ['BigCommerce token revoked', 'Error: BigCommerce API error 401: {"status":401,"title":"Unauthorized"}'],
  ['BigCommerce orders token revoked', 'Error: BigCommerce Orders API 401'],
  ['GHL agency key revoked', 'GHL sync failed: Error: GHL API error 401: {"statusCode":401,"message":"Invalid JWT"}'],
]
test('transient and unrelated failures stay quiet', () => {
  for (const [label, msg] of QUIET) assert.equal(isDeadCredentialError(msg), false, label)
})
test('dead credentials alert', () => {
  for (const [label, msg] of ALERT) assert.equal(isDeadCredentialError(msg), true, label)
})

test('metaTokenExpiry reads debug_token and never throws', async () => {
  const realFetch = global.fetch
  process.env.META_APP_ID = 'app'; process.env.META_APP_SECRET = 'secret'
  try {
    let asked = ''
    global.fetch = async (url) => { asked = String(url); return new Response(JSON.stringify({ data: { is_valid: true, expires_at: 1795000000 } })) }
    assert.deepEqual(await metaTokenExpiry('tok'), { valid: true, expiresAt: new Date(1795000000 * 1000).toISOString() })
    assert.match(asked, /\/debug_token\?input_token=tok&access_token=app%7Csecret/)

    global.fetch = async () => new Response(JSON.stringify({ data: { is_valid: true, expires_at: 0 } }))
    assert.deepEqual(await metaTokenExpiry('tok'), { valid: true, expiresAt: null }, 'a token that never expires')

    global.fetch = async () => new Response(JSON.stringify({ data: { is_valid: false, expires_at: 1700000000 } }))
    assert.equal((await metaTokenExpiry('tok')).valid, false)

    global.fetch = async () => { throw new Error('network down') }
    assert.equal(await metaTokenExpiry('tok'), null)
    global.fetch = async () => new Response('nope', { status: 500 })
    assert.equal(await metaTokenExpiry('tok'), null)

    delete process.env.META_APP_SECRET
    assert.equal(await metaTokenExpiry('tok'), null, 'no app credentials')
  } finally { global.fetch = realFetch }
})
