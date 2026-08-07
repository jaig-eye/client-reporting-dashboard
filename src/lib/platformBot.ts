/**
 * Platform bot User-Agent — sent on all external server-side requests.
 * Clients can whitelist in Cloudflare: http.user_agent contains "GoLaunchLocal"
 */
export const PLATFORM_BOT_UA = 'GoLaunchLocal/1.0 (+https://golaunchlocal.com/bot)'
