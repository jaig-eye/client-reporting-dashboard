// Which dashboard a client sees: the rebuilt per-channel pages, or the original Summary.
//
// The answer normally comes from clients.dashboard_v2 (set on the client record). While the rebuilt
// dashboard is being tested, a browser cookie can override it either way, so the new layout can be
// checked on any client without changing what that client sees. The override only affects the
// browser that set it, and every page still reads only the signed-in client's own data.
//
// Temporary: remove the cookie override once testing is finished.

export const DASHBOARD_V2_PREVIEW_COOKIE = 'dashboard_v2_preview'

type CookieReader = { get(name: string): { value: string } | undefined }

export function isDashboardV2(client: object, cookieStore: CookieReader): boolean {
  const override = cookieStore.get(DASHBOARD_V2_PREVIEW_COOKIE)?.value
  if (override === '1') return true
  if (override === '0') return false
  return !!(client as { dashboard_v2?: boolean | null }).dashboard_v2
}
