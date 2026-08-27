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
