/**
 * Platform bot User-Agent — sent on all external server-side requests.
 * Clients can whitelist in Cloudflare: http.user_agent contains "GoLaunchLocal"
 */
export const PLATFORM_BOT_UA = 'GoLaunchLocal/1.0 (+https://golaunchlocal.com/bot)'

/**
 * Browser-signature variant. Keeps the "GoLaunchLocal" token (so a client's Cloudflare
 * UA-whitelist / Skip rule still matches: http.user_agent contains "GoLaunchLocal") but appends
 * a real Chrome signature so sites that naively block non-browser User-Agents let the request
 * through. Use for fetches to client sites that sit behind bot filters (sitemaps, WordPress REST).
 *
 * NOTE: this does NOT defeat IP-reputation blocks — e.g. Cloudflare Bot Fight Mode blocking
 * datacenter/serverless IPs returns 403 regardless of UA. Those still need the client to add a
 * Skip rule for "GoLaunchLocal" (which this UA keeps matching).
 */
export const BROWSER_BOT_UA = `${PLATFORM_BOT_UA} Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36`
