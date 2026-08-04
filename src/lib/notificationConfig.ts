// Per-notification-type configuration helper.
// Reads from agency_settings.notification_config (JSONB, migration 184).
// Falls back to { agency: true, email: false, manager: false, client: true } when a key is absent.

export interface NotifSettings {
  agency:  boolean  // agency-wide Discord ops channel
  email:   boolean  // global team email notification
  manager: boolean  // account manager email (per-client)
  client:  boolean  // per-client Discord channel
}

export type NotifConfig = Record<string, NotifSettings>

export function getNotif(config: NotifConfig | null | undefined, key: string): NotifSettings {
  const raw = (config ?? {})[key] as unknown as Record<string, boolean> | undefined
  if (!raw) return { agency: true, email: false, manager: false, client: true }

  // Migrate old schema { discord, ops, client } → new schema
  if ('discord' in raw || 'ops' in raw) {
    return {
      agency:  (raw.discord ?? true) && (raw.ops ?? true),
      email:   false,
      manager: false,
      client:  (raw.discord ?? true) && (raw.client ?? true),
    }
  }

  // Migrate transitional schema { email, manager, client } where "email" meant ops Discord
  if ('email' in raw && !('agency' in raw)) {
    return {
      agency:  raw.email   ?? true,
      email:   false,
      manager: raw.manager ?? false,
      client:  raw.client  ?? true,
    }
  }

  return {
    agency:  raw.agency  ?? true,
    email:   raw.email   ?? false,
    manager: raw.manager ?? false,
    client:  raw.client  ?? true,
  }
}
