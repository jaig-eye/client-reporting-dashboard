// Per-notification-type configuration helper.
// Reads from agency_settings.notification_config (JSONB, migration 184).
// Falls back to { email: true, manager: false, client: true } when a key is absent.

export interface NotifSettings {
  email:   boolean  // global team email notification
  manager: boolean  // account manager email (per-client)
  client:  boolean  // per-client Discord channel
}

export type NotifConfig = Record<string, NotifSettings>

export function getNotif(config: NotifConfig | null | undefined, key: string): NotifSettings {
  const raw = (config ?? {})[key] as unknown as Record<string, boolean> | undefined
  if (!raw) return { email: true, manager: false, client: true }

  // Migrate old schema { discord, ops, client } → new schema { email, manager, client }
  if ('discord' in raw || 'ops' in raw) {
    return {
      email:   (raw.discord ?? true) && (raw.ops ?? true),
      manager: false,
      client:  (raw.discord ?? true) && (raw.client ?? true),
    }
  }

  return {
    email:   raw.email   ?? true,
    manager: raw.manager ?? false,
    client:  raw.client  ?? true,
  }
}
