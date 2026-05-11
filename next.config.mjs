/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable Next.js client-side router cache so every page navigation
  // fetches fresh server data instead of serving a 30-second stale snapshot.
  experimental: {
    staleTimes: { dynamic: 0, static: 0 },
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
