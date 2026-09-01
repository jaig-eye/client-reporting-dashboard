# Security audit — `fix/auth-hardening`

Status at the point this branch was pushed. Written to be picked up cold.

**Nothing here is deployed.** `main` is untouched. Migrations 195 and 196 are NOT
applied to production.

---

## 1. What the database actually looks like (verified live)

This is the good news, and it changes how urgent everything else is.

| Check | Result |
|---|---|
| Tables in `public` with RLS **disabled** | **0** |
| Tables with RLS enabled and no policies | all of them |
| Browser anon key used to read data | **no** (one realtime subscription only) |

Every table has RLS **on** with **no policies**. For an app that reads exclusively
through the service-role key that is the correct lockdown: the service role
bypasses RLS, and `anon` / `authenticated` can read **nothing**. The publishable
anon key in the browser bundle is not a data-access credential.

So the "someone points Postman at our Supabase URL and downloads the clients
table" failure mode does not exist. That is a genuinely strong starting position
and it is worth not regressing: **any future migration that adds a table must
leave RLS enabled**, and any `GRANT` to `anon` needs a specific reason.

### The one real leak found — fixed in migration 196

`public.get_gsc_summary` is `SECURITY DEFINER` **and** `EXECUTE` is granted to
`anon`. Definer functions run as the owner, which bypasses RLS — so this one
function punches straight through the lockdown described above.

Anyone holding the public anon key could:

```
POST /rest/v1/rpc/get_gsc_summary  { "p_client_id": "<any client uuid>", ... }
```

and read that client's Search Console data — queries, pages, impressions, clicks.
Unauthenticated, cross-tenant, no audit trail.

It has **zero callers** in `src/` (verified by grep); the dashboards read GSC
through the service role. Migration 196 revokes it, revokes the other
public-executable RPCs as defence in depth (all `SECURITY INVOKER`, so already
returning empty to anon), and pins `search_path` on the definer function.

**This is the single highest-value item in this document.** It is also the only
confirmed live data leak found.

---

## 2. Magic-link client dashboards — how they work, and why the auth work does not touch them

Explicitly checked, because breaking these was the stated red line.

```
/api/auth/access?token=<clients.dashboard_token>   (or ?ghl_token=<location id>)
        ↓ validates the token against `clients`
        ↓ sets the `client_token` cookie
/dashboard  →  createAdminClient()  →  service-role reads scoped by client_id
```

Two properties matter:

1. **Client dashboards never touch `admin_session`.** They authenticate on
   `client_token`, a completely separate cookie, validated against
   `clients.dashboard_token`. Nothing in the signed-session work reads, writes,
   or validates that path.
2. **All their data reads go through the service role**, which is unaffected by
   `GRANT`/`REVOKE` on `anon` and `authenticated`. Migration 196 cannot affect
   them.

The one place the two systems touch is cookie clearing, and this branch
deliberately **narrowed** that: `/api/auth/signout` now clears client cookies
only (it had been widened to drop admin cookies too), and `/api/admin/preview/exit`
clears `client_token` with attributes that actually apply inside the CRM iframe.

**Residual risk to watch on deploy:** the admin session format changes, so every
admin is logged out once. Client magic links are unaffected — but that is worth
verifying with one real client link immediately after deploy rather than assuming.

---

## 3. What this branch changes

- **Signed admin sessions.** `admin_session` held the raw `ADMIN_PASSWORD` and
  identity came from the unsigned `admin_user_id` cookie, whose *absence* meant
  super admin — so deleting one cookie in devtools was a privilege escalation,
  and setting it to a colleague's uuid was impersonation. Now an HMAC-signed
  token carries the claims.
- **`SESSION_SECRET` is required in production**, with no `ADMIN_PASSWORD`
  fallback, because that value *was* the cookie and may sit in request logs.
- **Cron auth fails closed.** The old inline check interpolated an unset
  `CRON_SECRET` into the literal string `"Bearer undefined"`, which is truthy —
  anyone sending that header authenticated as the cron. All 16 cron routes plus
  `/api/sync/trigger` and `/api/admin/content/schedule` now use `verifyCronAuth`.
- **bcrypt** replaces unsalted SHA-256 for new hashes, with a 72-byte cap
  (bcrypt silently truncates past that).
- **Forced password rotation** (migration 195) — see the concerns below.
- **Audit integrity.** Four routes took the acting user from the unsigned cookie
  and wrote it to `user_id` / `reviewed_by` / `updated_by`; now the signed claim.
- **Docs corrected.** `CLAUDE.md` and `CONVENTIONS.md` still prescribed the
  `admin_user_id` super-admin check and the fail-open cron compare.

---

## 4. Open concerns — read before deploying

> **Status update (2026-09-01).** Sections 4.1–4.4 below were written against the
> pre-merge branch and are kept for the reasoning. Most are now closed on
> `integration/auth-hardening-crm`; see **§6 Post-merge hardening** at the end of this
> document for what was fixed and what genuinely remains. **§4.5 operational
> preconditions still stand in full** — `SESSION_SECRET` and the unapplied migrations
> are still blockers.

Ordered by how much they should worry you.

### 4.1 Sessions cannot be revoked

`isAdminAuthed()` is a pure signature-and-expiry check with no database read, and
it gates ~125 admin routes. Consequences:

- **`force-reset` does not log the target out.** It sets `must_reset_password`,
  which is read at exactly one place — the login handler. A user already holding
  a cookie keeps full access for up to 14 days. The endpoint's own success
  message and the UI confirm dialog both claim otherwise. **That message is
  currently false and should not be trusted in an incident.**
- **Deactivating or deleting a user does not log them out** either.

The fix is one change in the shared verifier: compare the token's `iat` against
`users.password_changed_at` (already added by migration 195, currently written
and never read). That gives real revocation to all ~125 call sites at once. It is
the single highest-value remaining piece of work.

### 4.2 The forced-rotation feature is not internally coherent

`must_reset_password` is written in two places, cleared in one, and read for
authorization in one. The gaps:

- A super admin setting a password via the users UI **never clears the flag**, so
  the password they hand the colleague cannot be used to sign in — and that is
  exactly the fallback used when email is broken.
- A user changing their own password in Settings also never clears it, so a
  force-reset user with a live session traps themselves in a permanent loop.

Both collapse into 4.1: the flag governs a security decision but lives outside
session validation.

**Serious option worth considering: delete this feature.** Signed sessions alone
achieve the stated goal — on deploy every existing cookie (raw `ADMIN_PASSWORD`)
stops verifying, so all four admins are logged out and each uses the existing
"forgot password" flow, which is confirmed working. That removes migration 195,
the force-reset endpoint, its UI, three schema-drift fallbacks, and every defect
in this section. With four accounts, all admins, enforcement is a Slack message.

### 4.3 No CSRF protection anywhere

`admin_session` is `SameSite=None; Secure` in production (required for the CRM
iframe), so it rides cross-site requests, and `/api/admin/*` is not matched by
middleware. A logged-in admin visiting any page lets that page POST to
`/api/admin/users` with `Content-Type: text/plain` — a CORS simple request, no
preflight — and the write lands before the blocked response matters.

This is **pre-existing**, not introduced here. But two comments added by this
branch (`session.ts`, `middleware.ts`) assert a middleware CSRF guard that does
not exist, which will mislead the next reader. `fix/security-hardening` has a
working implementation to lift.

### 4.4 Known defects in this branch, not yet fixed

Found by the final review, verified, deliberately left for a fresh pass:

- **`/api/admin/settings` PUT returns the full row** including
  `super_admin_otp_hash` — an unsalted SHA-256 of a six-digit OTP, crackable
  offline in under a second. GET was fixed in the same file and PUT was missed.
- **Username-enumeration oracle** in login: `.ilike('username', identifier)`
  treats `%` as a wildcard, multi-row makes `maybeSingle()` error, and the new
  503 branch is distinguishable from the 401. Introduced by this branch. Fix is
  `.eq()` — usernames are stored lowercased.
- **`internalAdminCookie()` throws** when `SESSION_SECRET` is unset and is called
  unguarded at the top of `cron/content-topics`, so a partial failure became a
  total one. Same pattern in `content/pages/queue`.
- **Rate-limiter sweep cannot cap.** It deletes only *expired* entries, so during
  a live window it frees nothing and every later request pays a full scan.
- **`passwordTooLong(body.password as string)`** in `users/[id]` throws a 500 on
  a non-string; the sibling route got the `typeof` guard and this one did not.
- **`role: 'viewer'` is enforced nowhere server-side** while the UI advertises it
  as "read-only access". A viewer can write to every admin route and read the
  Stripe / AI / Discord / SERP keys from settings. Pre-existing, but the signed
  token now carries `role`, which makes it *look* enforced.
- **Open redirect** on the login page: `returnUrl` is pushed unvalidated after a
  successful sign-in. Pre-existing, one-line fix.
- **Reset codes have no per-token attempt counter** — a wrong guess is a pure
  SELECT, so only a per-instance IP limiter bounds guessing.

### 4.5 Operational preconditions

1. Set **`SESSION_SECRET`** in Vercel (`openssl rand -hex 32`) **before** deploy.
   It appears nowhere on `main`, so it is certainly unset today. Without it,
   production cannot mint or verify sessions and nobody can sign in — deliberate,
   fail-closed, but it means the variable goes in first.
2. **Rotate `ADMIN_PASSWORD`** after deploy. It has been transmitted as the
   session cookie on every admin request for the life of the app.
3. Apply migrations **196** (the leak — safe and independent, can go first) and
   **195** (only if keeping forced rotation).
4. Verify one real client magic link immediately after deploy.

---

## 5. Honest assessment of this branch

Three review rounds ran against it. The defect rate did not converge: each fix
round introduced new defects, several of which are listed in 4.4 above and are
attributable to the fixes themselves rather than to `main`.

The **signed-session core is sound** — the Node and Edge HMAC implementations
were verified byte-compatible by direct test, and `tsc` and the production build
are clean. The **forced-rotation feature is where the complexity and most of the
defects live**, and it is the part with the weakest cost/benefit given four
accounts.

Recommended sequence if picking this up:

1. Ship **migration 196 alone**, today. It is independent of everything else,
   fixes the only confirmed live leak, and cannot break the dashboards.
2. Decide on 4.2 (keep forced rotation with the 4.1 fix, or cut it).
3. Fix 4.4, then re-review.
4. Treat 4.3 as its own piece of work, lifting from `fix/security-hardening`.

`fix/security-hardening` should be closed rather than merged — its architecture
is right and is what this branch is built on, but a full review found 15 defects
including four that made it a net downgrade from `main`.

---

## 6. Post-merge hardening (2026-09-01)

A max-effort review of the 2026-08-28 hardening commits and the `d0c53c3` merge
found that the branch's headline feature was wired into a path almost nothing used,
and that a few gaps reopened doors the same range had closed elsewhere. The
following are now fixed on this branch.

### 6.1 Session revocation now covers the whole admin surface

`getAdminSession()` correctly enforces `is_active` and the `password_changed_at`
cutoff, but it is async and does a DB read, so only **7 route files out of 124**
reached it. The other 117 gate on the synchronous `isAdminAuthed()`, and every
`/admin/*` page was gated by middleware's signature-only `verifyAdminSessionEdge()`.
Forced rotation and deactivation were therefore login-time-only controls: a stale
14-day cookie kept working against settings, uploads, sync triggers, billing and
logs.

A claim baked into the token cannot fix this — revocation is state that changes
*after* the token is minted. The fix is `lib/sessionRevocation.ts`, an Edge-safe
PostgREST check called from middleware, which already runs on every admin page and
every admin API route. One call site covers all of them, with no changes to the 117
handlers. Results are cached 30s per instance; a **definite** revocation fails
closed, an **indeterminate** one (Supabase unreachable) fails open, because
middleware sits in front of the entire admin UI and a database blip must not lock
every administrator out. A stale cached answer is preferred over failing open, so a
blip cannot un-revoke an evicted session.

### 6.2 A force-reset session could un-revoke itself

`/api/admin/users/me/password` gated on `isAdminAuthed`, looked the user up with no
`is_active` filter, then cleared `must_reset_password`, stamped a new
`password_changed_at`, and minted a fresh cookie. Anyone holding a stolen cookie
*plus* the current password could clear the forced rotation and walk away with a new
14-day session — defeating the exact eviction the flag exists to perform. Now gated
on `getAdminSession()` (every role may still change their own password), with an
`is_active` filter and `.maybeSingle()`.

### 6.3 Data exposure closed

- **`lib/mcp/tools/agency.ts`** did `select('*')` on `agency_settings` and redacted
  against a hand-written list in which only 2 of 9 names were real columns of that
  table. `super_admin_otp_hash` — an unsalted SHA-256 of six digits, reversible
  offline in under a second — plus `stripe_api_key`, `ai_api_key`, `serp_api_key`
  and both Meta tokens were returned in cleartext to any MCP token holder. Now
  driven off the shared `SECRET_FIELDS` constant, with the OTP columns dropped
  outright.
- **`connections/page.tsx`** passed the raw Ahrefs connector key into a client
  component, serializing it into the RSC flight payload in the page HTML — on the
  same page, in the same render, as the four `agency_settings` fields the masking
  commit had just fixed. Now passes `SECRET_MASK`.
- **`PUT /api/admin/settings`** — the route that writes every agency credential —
  was on the role-blind `isAdminAuthed`, so a read-only `viewer` could substitute
  the agency's Stripe and AI credentials and redirect every alert. Now
  `requireWriteAdmin`, the gate this branch already applied to lower-value actions.
- **`admin-login`** escaped backslash, `%` and `_` but not `*`, which PostgREST
  itself translates to `%` — leaving the username-enumeration oracle fully reachable
  and letting one account be probed through unlimited distinct rate-limit buckets.
  `*` is now escaped, and a multi-row match is treated as "no match" rather than a
  distinguishable 503, so no future gap in the escaping can reopen the oracle.

### 6.4 Crashes and broken features

- **Rate limiter, two bugs — both live now that the KV vars are set.** The Redis
  success path returned before `memTake`, so the in-memory map was permanently
  empty and the "fallback" was a cold counter that handed an already-blocked
  attacker a fresh full budget on the first Redis timeout. And an unconditional
  `PEXPIRE` re-armed the full TTL on every attempt including blocked ones, turning
  the Redis tier into a sliding block that never drains: combined with `ipLimiter`
  (keyed on IP alone and never reset), that locks every admin behind a shared office
  NAT out of admin-login indefinitely, since each retry pushes the expiry further
  out. Now `SET ... NX PX` + `INCR`, which fixes the window at first attempt, and
  the local map is mirrored so the fallback is warm.
- **`crypto.timingSafeEqual` on the super-admin OTP** had no length guard. It throws
  `RangeError` rather than returning false, and the OTP row is only cleared on
  success — so a malformed stored hash meant an unrecoverable 500 on every
  super-admin login. Now length-guarded like every other call site in the repo.
- **`isUnchangedSecret('')` meant no credential could ever be revoked.** Blank-and-
  save silently no-opped while the card's own `setIsConnected` flipped to "not
  connected" — the UI reported a disconnect that never happened while the live key
  stayed in the database and in use. No card offers a delete control, so blanking
  was the only revocation affordance, and it is exactly what you need during an
  incident. Empty now clears (persisted as null); only the mask means "unchanged".
- **SerpAPI "Test key"** posted `SECRET_MASK` straight through to serpapi.com, so a
  correctly configured key always reported invalid. The route now resolves the mask
  server-side.
- **The Ahrefs card could not save at all, in either direction.** It POSTed to
  `/api/admin/connections/new` (no such route file — that path is a *page*), and
  PATCHed `{ auth: ... }` when the connectors route only reads `auth_patch`, leaving
  the update empty and returning 400. Now matches the working DataForSEO pattern.
- **`/api/mcp` stamped `last_used_at` with an un-awaited supabase-js builder**,
  which is a lazy thenable and issues no HTTP request at all — the column has been
  silently null for every token. Now awaited with error logging.
- **The admin layout had no `redirect()`** when `getAdminSession()` returned null —
  the one place revocation fired UI-side. The shell rendered in full and the sidebar
  labelled the visitor "Super Admin / Master account".

### 6.5 Scope and durability

- **CSRF and revocation were scoped by URL prefix**, not by "does this route
  authenticate from a cookie", leaving `POST /api/upload` and `POST /api/sync/trigger`
  outside both. `multipart/form-data` is a CORS *simple* request, so `/api/upload`
  took no preflight and a hidden cross-origin form would post with the cookie
  attached. Both are now in `COOKIE_AUTHED_API_PREFIXES` and the matcher.
- **`frame-ancestors` sat on `source: '/admin'`** (exact path), so only the login
  page was clickjack-protected and every page holding data was framable by any
  origin. Extended to `/admin/:path*` with the identical allowlist — no effect on
  the CRM iframe.
- **`SESSION_SECRET` resolution treated Vercel Preview as production**, so previews
  without their own secret 503'd on login and redirect-looped. Widening the
  `ADMIN_PASSWORD` fallback to cover preview would have been the wrong repair —
  previews share the production Supabase project, so a forgeable preview session is
  a production data leak. The fallback is now strictly local-only, and the fix is
  operational: **set `SESSION_SECRET` for all three Vercel environments.**
- **MCP bearer tokens ignored every revocation control** — validated on
  `revoked_at IS NULL` alone, and nothing anywhere sets `revoked_at` on force-reset
  or deactivation. They now apply the same `is_active` and `password_changed_at`
  rules, with the token's `created_at` standing in for a session's `iat`.
- **The reset-attempt cap failed invisibly.** supabase-js *resolves* with
  `{data:null,error}` on a Postgres error rather than rejecting, so the
  `.then(null, () => {})` rejection handler was dead code: deploying ahead of
  migration 207 left the per-token brute-force cap silently inert with nothing in
  the logs. The error is now inspected and logged.

### 6.6 Migrations

- **207** renamed its `RETURNS TABLE` OUT columns while keeping `CREATE OR REPLACE`.
  Postgres cannot rename OUT parameters that way; on any database that took the
  earlier revision the migration would abort, discarding its own REVOKE and
  `service_role` GRANT. A `DROP FUNCTION IF EXISTS` now precedes it.
- **208 (new)** makes 196's lockdown durable. The merge falsified 196's premise —
  `set_content_posts_updated_at` *is* now defined by migrations 200 and 206, so the
  `search_path` pin never survived in either direction (skipped on fresh builds,
  reset by 206's `CREATE OR REPLACE` on production). And 196's REVOKE was a one-shot
  sweep, while Supabase's default ACLs re-grant `anon`/`authenticated` EXECUTE on
  every function created afterwards — which is why 207 had to hand-write its own
  REVOKE. 208 sets `ALTER DEFAULT PRIVILEGES`, re-runs the sweep, re-asserts the
  `service_role` grant, re-pins `search_path`, and raises a NOTICE/WARNING naming
  anything still reachable so a future regression is visible at apply time.

### 6.7 Still open

- **Denial-of-reset.** Because a wrong guess is now correctly chargeable, anyone who
  knows an admin's email can burn their live reset code with 5 unauthenticated
  POSTs. This bites hardest on force-reset accounts, which have no other way back
  in. Fixing it properly means not burning the code at the cap (just refusing
  further guesses on it) or rate-limiting the burn per account. Left as-is because
  the alternative — an uncapped 6-digit code — is worse, but it should be closed.
- **`accountKey` embeds the raw, unbounded, attacker-supplied email**; `MAX_KEYS`
  bounds entry count, not key size.
- **Cleanups**, none of them behavioural: the deploy-order fallback is hand-rolled
  at 7 sites with 4 different regexes; `admin_user_id` is still written at login and
  read nowhere; `me/password` pays a second full cost-12 bcrypt on the fallback
  path; `isAllowedOrigin` duplicates the CSP allowlist in `next.config.mjs`.

### 6.8 Verified unaffected

The magic-link client dashboards. No `/dashboard` page or `client_token` route calls
`/api/admin`, so neither the CSRF guard nor the revocation check can reach them;
they authenticate on a separate cookie validated against `clients.dashboard_token`
and read through `createAdminClient()` on the service-role key, which `GRANT`/
`REVOKE` on `anon` cannot affect. Migrations 196 and 208 both re-assert the
`service_role` grant explicitly. The CRM iframe is also unaffected: the CSRF guard
allows the same-origin iframe document and a `golaunchlocal.com` parent, and the
extended `frame-ancestors` value is identical to the one already on `/admin`.
