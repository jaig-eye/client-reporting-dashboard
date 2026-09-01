-- ─────────────────────────────────────────────────────────────────────────────
-- Stock-photo candidates offered alongside the AI-generated featured image.
--
-- The reviewer should not be forced to accept a generated image. During post
-- generation we also query Openverse (public CC-licensed image API, no key required)
-- using the SAME context the AI image prompt is built from, and store whatever clears
-- the relevance floor here. The review drawer shows them as a picker next to the
-- generated image; choosing one copies the file into our own `uploads` bucket rather
-- than hotlinking the provider's CDN.
--
-- Shape: an array of objects, each
--   { id, title, url, thumbnail, creator, license, licenseUrl, sourceUrl, provider,
--     width, height, attribution, relevance, matchedQuery }
-- See src/lib/content/stockImages.ts for how they are found and filtered.
--
-- Stored denormalised as JSONB rather than as its own table because these are
-- ephemeral suggestions scoped to one post, never queried across posts, and are
-- rewritten wholesale each time images are regenerated. license / licenseUrl /
-- attribution / sourceUrl are captured at query time precisely so a chosen image
-- keeps its provenance even if the upstream record later changes.
--
-- Empty array is the normal, expected result for specialised topics: relevance is
-- scored in code and anything weak is discarded, because returning nothing is better
-- than offering a confident but wrong photograph.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.content_posts
  ADD COLUMN IF NOT EXISTS image_candidates JSONB;

COMMENT ON COLUMN public.content_posts.image_candidates IS
  'Openverse stock-photo suggestions for the featured image, captured at generation time with their license and attribution. Reviewer-facing only; never auto-applied. NULL = never searched, [] = searched and nothing was relevant enough.';
