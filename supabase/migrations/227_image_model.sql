-- Which OpenAI image model writes featured images.
--
-- It was hard-coded to gpt-image-1. That model has been disappointing on this content — flat,
-- over-lit, stock-looking — and there was no way to try another without a deploy.
--
-- Default stays gpt-image-1 so nothing changes for anyone who does not pick something else.
-- NULL means the same thing, so existing rows need no backfill.

ALTER TABLE public.agency_settings
  ADD COLUMN IF NOT EXISTS image_model TEXT DEFAULT 'gpt-image-1';

COMMENT ON COLUMN public.agency_settings.image_model IS
  'OpenAI image model for featured images: gpt-image-1 | dall-e-3. NULL = gpt-image-1.';
