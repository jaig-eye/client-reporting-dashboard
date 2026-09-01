/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // 30s dynamic cache makes tab-switching instant (zero server round-trip).
    // 5-min unstable_cache + revalidateTag in sync cron ensures fresh metrics after each sync.
    staleTimes: { dynamic: 30, static: 180 },
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' }
    ]
  },

  // Disable caching for all admin and dashboard pages so Vercel's CDN never
  // serves a stale HTML response. API routes are unaffected (they set their
  // own Cache-Control or default to no-store already).
  async headers() {
    // Embed-SAFE security headers applied to every route. Deliberately NOTHING
    // that affects framing here (no X-Frame-Options, no frame-ancestors, no
    // script-src CSP) — the app is embedded in the CRM at golaunchlocal.com, and
    // the existing per-route frame-ancestors on /admin is left untouched. These
    // four only harden transport, MIME sniffing, referrer leakage, and unused
    // browser features, none of which can break the iframe or the app.
    const securityHeaders = [
      // Force HTTPS on this host for 180 days. No includeSubDomains / preload, so
      // it cannot affect any other subdomain you run off Vercel.
      { key: 'Strict-Transport-Security', value: 'max-age=15552000' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ]
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        source: '/admin',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, max-age=0, must-revalidate' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self' https://golaunchlocal.com https://*.golaunchlocal.com" },
        ],
      },
      {
        source: '/admin/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, max-age=0, must-revalidate' },
          // Same allowlist as the /admin block above, which only matched the exact
          // login path — so every page that actually holds data (/admin/dashboard,
          // /admin/clients/[id], /admin/connections, /admin/settings) shipped with
          // no frame-ancestors at all and could be framed by any origin. Identical
          // value, so the CRM iframe at golaunchlocal.com is unaffected.
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self' https://golaunchlocal.com https://*.golaunchlocal.com" },
        ],
      },
      {
        source: '/dashboard/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, max-age=0, must-revalidate' },
        ],
      },
      {
        source: '/dashboard',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, max-age=0, must-revalidate' },
        ],
      },
    ]
  },
}

export default nextConfig
