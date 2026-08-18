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
    // Clickjacking policy: only the app itself and the GoHighLevel CRM may frame us.
    // Applied to EVERY authenticated surface (previously only the exact /admin login
    // page carried it, leaving /admin/* and /dashboard/* framable by any site).
    const frameAncestors = {
      key: 'Content-Security-Policy',
      value: "frame-ancestors 'self' https://golaunchlocal.com https://*.golaunchlocal.com",
    }
    const noStore = { key: 'Cache-Control', value: 'no-store, no-cache, max-age=0, must-revalidate' }
    const noSniff = { key: 'X-Content-Type-Options', value: 'nosniff' }

    return [
      // Baseline hardening for all routes (nosniff + a default same-origin frame policy).
      {
        source: '/:path*',
        headers: [
          noSniff,
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self' https://golaunchlocal.com https://*.golaunchlocal.com" },
        ],
      },
      { source: '/admin',              headers: [noStore, frameAncestors] },
      { source: '/admin/:path*',       headers: [noStore, frameAncestors] },
      { source: '/dashboard',          headers: [noStore, frameAncestors] },
      { source: '/dashboard/:path*',   headers: [noStore, frameAncestors] },
    ]
  },
}

export default nextConfig
