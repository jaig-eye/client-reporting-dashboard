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
    // ── Clickjacking policy — TWO tiers, deliberately different ────────────────
    //
    // ADMIN is strict: it holds destructive actions, so only we (and our own CRM
    // domain) may frame it. This is the boundary that actually matters.
    //
    // CLIENT surfaces (/dashboard, /share) are deliberately LENIENT: clients open
    // these from magic links and we embed them as custom links inside GoHighLevel,
    // whose host domain varies (app.gohighlevel.com, *.leadconnectorhq.com,
    // *.msgsndr.com, or a white-labelled domain). Over-restricting here silently
    // breaks the client experience — a blank iframe with a console CSP error.
    // They are read-only reporting views, so the clickjacking risk is low.
    //
    // Override either list with a space-separated env var, e.g.
    //   FRAME_ANCESTORS_CLIENT="'self' https://app.mycrm.com https://*.mycrm.com"
    // Set FRAME_ANCESTORS_CLIENT="*" to allow any parent (fully restores the old
    // unrestricted behaviour).
    const ADMIN_FRAME_ANCESTORS = process.env.FRAME_ANCESTORS_ADMIN
      || "'self' https://golaunchlocal.com https://*.golaunchlocal.com"

    const CLIENT_FRAME_ANCESTORS = process.env.FRAME_ANCESTORS_CLIENT
      || [
        "'self'",
        'https://golaunchlocal.com', 'https://*.golaunchlocal.com',
        // GoHighLevel / LeadConnector host domains for embedded custom links
        'https://app.gohighlevel.com', 'https://*.gohighlevel.com',
        'https://*.leadconnectorhq.com', 'https://*.msgsndr.com',
      ].join(' ')

    const csp     = (value) => ({ key: 'Content-Security-Policy', value: `frame-ancestors ${value}` })
    const noStore = { key: 'Cache-Control', value: 'no-store, no-cache, max-age=0, must-revalidate' }
    const noSniff = { key: 'X-Content-Type-Options', value: 'nosniff' }

    return [
      // Baseline: nosniff everywhere. Intentionally NO frame-ancestors here — a global
      // frame rule would also hit /share/* (public ad-library links) and any future
      // embeddable surface.
      { source: '/:path*', headers: [noSniff] },

      // Admin — strict.
      { source: '/admin',            headers: [noStore, csp(ADMIN_FRAME_ANCESTORS)] },
      { source: '/admin/:path*',     headers: [noStore, csp(ADMIN_FRAME_ANCESTORS)] },

      // Client-facing — lenient, must keep working via magic link + inside the CRM iframe.
      { source: '/dashboard',        headers: [noStore, csp(CLIENT_FRAME_ANCESTORS)] },
      { source: '/dashboard/:path*', headers: [noStore, csp(CLIENT_FRAME_ANCESTORS)] },
      { source: '/share/:path*',     headers: [csp(CLIENT_FRAME_ANCESTORS)] },
      { source: '/access',           headers: [csp(CLIENT_FRAME_ANCESTORS)] },
    ]
  },
}

export default nextConfig
