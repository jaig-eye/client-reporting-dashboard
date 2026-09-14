// Screenshot pages in light and dark, at desktop and mobile widths, so UI work can be looked at
// before it is committed. See docs/FRONTEND-WORKFLOW.md.
//
// Usage (paths with or without the leading slash):
//   npm run design:shots -- dev/design
//   npm run design:shots -- dev/design admin/users
//
// In Git Bash, write paths WITHOUT the leading slash (or set MSYS_NO_PATHCONV=1). Git Bash rewrites an
// argument like /dev/design into a Windows path before the script ever sees it.
//
// Another host (a preview or staging deployment):
//   DESIGN_SHOTS_BASE_URL=https://staging.example npm run design:shots -- admin/content
//
// Signed in, through the real login route — staging with a test account only, never production:
//   DESIGN_SHOTS_EMAIL=test-admin@example.com DESIGN_SHOTS_PASSWORD=... npm run design:shots -- admin/dashboard
//
// A client dashboard, through the real magic link (dashboard token from `npm run local:seed`):
//   DESIGN_SHOTS_CLIENT_TOKEN=... npm run design:shots -- dashboard dashboard/meta-ads
//
// Output: .design-shots/<page>/<theme>-<viewport>.png — full-page captures, git-ignored.
// Exits non-zero if any page errored, returned 4xx/5xx, or redirected somewhere else (usually login).

import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE  = (process.env.DESIGN_SHOTS_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')
const OUT   = '.design-shots'
// Git Bash converts an argument starting with "/" into a Windows path ("/dev/design" arrives as
// "C:/Program Files/Git/dev/design"). A drive prefix therefore means the shell rewrote it, so refuse it
// with the fix instead of navigating somewhere nonsensical.
const rawPaths = process.argv.slice(2)
const mangled  = rawPaths.find(p => /^[A-Za-z]:[\/]/.test(p))
if (mangled) {
  console.error(`"${mangled}" looks like a path your shell rewrote. Pass it without the leading slash (dev/design), or set MSYS_NO_PATHCONV=1.`)
  process.exit(1)
}
const paths = rawPaths.map(p => (p.startsWith('/') ? p : `/${p}`))

if (paths.length === 0) {
  console.error('Usage: npm run design:shots -- /path [/path ...]')
  process.exit(1)
}

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile',  width: 390,  height: 844 },
]
const THEMES = ['light', 'dark']

const slug = p => p.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9]+/gi, '-') || 'root'

const browser = await chromium.launch()
const context = await browser.newContext()

// Sign in through the real login route. The session cookie lands in the browser context and every
// page below reuses it — there is deliberately no way to skip authentication.
if (process.env.DESIGN_SHOTS_EMAIL && process.env.DESIGN_SHOTS_PASSWORD) {
  const res = await context.request.post(`${BASE}/api/auth/admin-login`, {
    data: { email: process.env.DESIGN_SHOTS_EMAIL, password: process.env.DESIGN_SHOTS_PASSWORD },
  })
  if (!res.ok()) {
    console.error(`Sign-in failed: HTTP ${res.status()} ${(await res.text()).slice(0, 200)}`)
    await browser.close()
    process.exit(1)
  }
  console.log(`Signed in as ${process.env.DESIGN_SHOTS_EMAIL}`)
}

// A client's dashboard is reached the way a client reaches it: the magic link sets a client_token
// cookie. Pass that client's dashboard token to screenshot /dashboard pages.
if (process.env.DESIGN_SHOTS_CLIENT_TOKEN) {
  const token = encodeURIComponent(process.env.DESIGN_SHOTS_CLIENT_TOKEN)
  const res = await context.request.get(`${BASE}/api/auth/access?token=${token}`, { maxRedirects: 0 })
  if (!(await context.cookies(BASE)).some(c => c.name === 'client_token')) {
    console.error(`The client link did not start a session (HTTP ${res.status()}).`)
    await browser.close()
    process.exit(1)
  }
  console.log('Opened the client dashboard link')
}

let problems = 0

for (const path of paths) {
  const dir = join(OUT, slug(path))
  mkdirSync(dir, { recursive: true })

  for (const vp of VIEWPORTS) {
    const page = await context.newPage()
    await page.setViewportSize({ width: vp.width, height: vp.height })

    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

    // The first request to a route compiles it in development, which can take a while.
    const res = await page.goto(BASE + path, { waitUntil: 'load', timeout: 240_000 })
    const status = res ? res.status() : 0
    // Give client components time to mount and fetch. Pages that poll never go fully idle.
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})

    for (const theme of THEMES) {
      // Both, because the app decides the theme two ways: an explicit data-theme, and the
      // system preference for accounts set to "auto".
      await page.emulateMedia({ colorScheme: theme })
      await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme)
      await page.waitForTimeout(300)
      await page.screenshot({ path: join(dir, `${theme}-${vp.name}.png`), fullPage: true })
    }

    const landed = page.url().replace(BASE, '')
    const redirected = landed.split('?')[0] !== path.split('?')[0]
    const bad = status >= 400 || redirected || errors.length > 0
    if (bad) problems++

    console.log(
      `${bad ? 'CHECK' : 'ok   '} ${status} ${path} [${vp.name}]`
      + (redirected ? ` → landed on ${landed}` : '')
      + (errors.length ? ` — ${errors.length} console error(s)` : ''),
    )
    for (const e of [...new Set(errors)].slice(0, 3)) console.log(`        ${e.slice(0, 200)}`)

    await page.close()
  }
}

await browser.close()
console.log(`\nScreenshots saved to ${OUT}/${problems ? ` — ${problems} capture(s) need a look` : ''}`)
process.exit(problems ? 1 : 0)
