import { createAdminClient } from './supabase/server'
import type { AdminSession } from './auth'

export function logActivity(
  session: AdminSession | null,
  action: string,
  resourceType: string,
  opts?: {
    resourceId?:  string
    clientId?:    string
    clientName?:  string
    ip?:          string
    meta?:        Record<string, unknown>
  }
): Promise<void> {
  const userName = session?.isSuperAdmin
    ? 'Super Admin'
    : (session?.name ?? 'System')

  const meta: Record<string, unknown> = { ...(opts?.meta ?? {}) }
  if (opts?.ip) meta.ip = opts.ip

  // Fire-and-forget for most callers; a caller about to return can await it, so the row is not lost
  // when the function is frozen after the response.
  return Promise.resolve(
    createAdminClient()
      .from('activity_log')
      .insert({
        user_id:       session?.userId    ?? null,
        user_name:     userName,
        action,
        resource_type: resourceType,
        resource_id:   opts?.resourceId  ?? null,
        client_id:     opts?.clientId    ?? null,
        client_name:   opts?.clientName  ?? null,
        meta,
      })
  ).then(() => undefined, () => undefined)
}
