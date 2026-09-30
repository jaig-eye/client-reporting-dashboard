-- Which OpenAI image model draws featured images.
--
-- It was hard-coded to gpt-image-1, which OpenAI shuts down on 2026-10-23, and there was no way to
-- try another model without a deploy.
--
-- No DEFAULT. NULL means "the code's default" (DEFAULT_IMAGE_MODEL in src/lib/content/imageModels.ts),
-- so the default lives in one place and moving it needs no migration or backfill. The code reads
-- any value it does not offer - a retired model included - as that default too.

ALTER TABLE public.agency_settings
  ADD COLUMN IF NOT EXISTS image_model TEXT;

-- An earlier draft of this file set DEFAULT 'gpt-image-1'. Where that draft was run, IF NOT EXISTS
-- above leaves its default in place; this removes it. A no-op everywhere else.
ALTER TABLE public.agency_settings
  ALTER COLUMN image_model DROP DEFAULT;

COMMENT ON COLUMN public.agency_settings.image_model IS
  'OpenAI image model for featured images: gpt-image-2.5-flare | gpt-image-2.5-sunburst | gpt-image-2. NULL or anything else = DEFAULT_IMAGE_MODEL in src/lib/content/imageModels.ts.';
