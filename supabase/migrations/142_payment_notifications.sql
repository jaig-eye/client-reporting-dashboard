-- General payment notification table — written by the Stripe webhook for every
-- successful invoice payment, regardless of whether it is an Ad Fuel payment.
-- The PaymentNotifier in the admin browser subscribes to INSERT events via
-- Supabase Realtime and plays the agency's notification sound.

CREATE TABLE IF NOT EXISTS payment_notifications (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  stripe_event_id  TEXT UNIQUE,          -- deduplicate webhook replays
  amount           NUMERIC(12,2) NOT NULL,
  currency         TEXT    NOT NULL DEFAULT 'usd',
  description      TEXT,                 -- invoice number or description
  customer_email   TEXT,
  client_name      TEXT,                 -- matched client name if known
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_notifications_created
  ON payment_notifications(created_at DESC);

-- Enable Realtime so the admin browser can subscribe without polling
ALTER PUBLICATION supabase_realtime ADD TABLE payment_notifications;
