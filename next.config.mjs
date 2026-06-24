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
    return [
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
