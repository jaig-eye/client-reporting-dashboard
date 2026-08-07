-- Per-notification-type Discord toggle configuration stored as JSONB.
-- Each key maps to { discord, ops, client } booleans.
-- Pre-seeded with defaults matching the current hardcoded behaviour (all enabled).
ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS notification_config jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE agency_settings SET notification_config = '{
  "uptime_down":             { "discord": true,  "ops": true,  "client": true  },
  "uptime_recovered":        { "discord": true,  "ops": true,  "client": true  },
  "ssl_expiry":              { "discord": true,  "ops": true,  "client": false },
  "sync_connector_error":    { "discord": true,  "ops": true,  "client": false },
  "content_monthly_review":  { "discord": true,  "ops": true,  "client": false },
  "content_mid_month_check": { "discord": true,  "ops": true,  "client": false },
  "content_bc_post_due":     { "discord": true,  "ops": true,  "client": false },
  "content_sa_auto_pushed":  { "discord": true,  "ops": true,  "client": false },
  "content_bc_sa_due":       { "discord": true,  "ops": true,  "client": false },
  "content_post_generated":  { "discord": true,  "ops": false, "client": true  },
  "content_post_published":  { "discord": true,  "ops": false, "client": true  },
  "content_sa_generated":    { "discord": true,  "ops": false, "client": true  },
  "ad_fuel_low":             { "discord": true,  "ops": false, "client": true  },
  "ad_fuel_paused":          { "discord": true,  "ops": false, "client": true  },
  "ad_fuel_resumed":         { "discord": true,  "ops": false, "client": true  },
  "bc_daily_sales":          { "discord": true,  "ops": false, "client": true  },
  "email_submitted":         { "discord": true,  "ops": true,  "client": true  },
  "email_reminder":          { "discord": true,  "ops": true,  "client": true  }
}'::jsonb;
