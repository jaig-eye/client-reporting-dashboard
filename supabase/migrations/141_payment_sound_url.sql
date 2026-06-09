-- Payment notification sound uploaded by the agency.
-- Stored as a public URL to an MP3/WAV in Supabase storage.
-- Played in the admin browser (via Supabase Realtime) whenever a Stripe
-- payment is successfully processed (INSERT on ad_fuel_ledger).

ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS payment_sound_url TEXT;

-- Enable Realtime for ad_fuel_ledger so the admin browser can subscribe
-- to INSERT events without polling.
ALTER PUBLICATION supabase_realtime ADD TABLE ad_fuel_ledger;
