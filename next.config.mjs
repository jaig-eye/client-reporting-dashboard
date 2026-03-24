/** @type {import('next').NextConfig} */
const nextConfig = {
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
