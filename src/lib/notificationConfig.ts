// Per-notification-type configuration helper.
// Reads from agency_settings.notification_config (JSONB, migration 184).
// Falls back to { discord: true, ops: true, client: true } when a key is absent
// so new notification types are automatically enabled until explicitly disabled.

export interface NotifSettings {
  discord: boolean  // master Discord toggle — if false, no Discord send for this type
  ops:     boolean  // send to agency ops channel
  client:  boolean  // send to per-client Discord channel
}

export type NotifConfig = Record<string, NotifSettings>

export function getNotif(config: NotifConfig | null | undefined, key: string): NotifSettings {
  return (config ?? {})[key] ?? { discord: true, ops: true, client: true }
}
