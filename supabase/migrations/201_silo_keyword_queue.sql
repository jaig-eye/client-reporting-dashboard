-- ─────────────────────────────────────────────────────────────────────────────
-- Hub-less "keyword queue" silos + two-way silo/keyword provenance.
--
-- A silo no longer needs a hub page: hub_page_url has always been nullable and
-- the generator already skips the hub block when it is NULL. What was missing was
-- a durable QUEUE — a list of keywords with reliable used/unused state and a link
-- to the post each one produced.
--
-- Two keyword stores existed in parallel:
--   content_silos.cluster_keywords  JSONB  — what SiloManager edits & generateTopics reads
--   content_silo_keywords           TABLE  — what the optimization engine (165) writes
-- The table is the better queue (real FKs, per-row claims, and a target_post_id
-- column that no code has ever written to). This migration makes it the source of
-- truth and backfills the JSONB into it so nothing is lost.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Internal-link injection is now opt-out per silo. Clients on a platform where
--    link injection cannot work (see 202) can have it turned off outright.
ALTER TABLE content_silos
  ADD COLUMN IF NOT EXISTS inject_internal_links BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN content_silos.inject_internal_links IS
  'When false, the generator omits hub/sibling linking rules and the post-publish hub-page rewrite is skipped.';

-- 2. Queue state on each keyword. target_post_id already exists (165:23) but has
--    never been written; used_at is what makes "walk the unused ones" cheap.
ALTER TABLE content_silo_keywords
  ADD COLUMN IF NOT EXISTS used_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS target_topic_id UUID,
  ADD COLUMN IF NOT EXISTS sort_order      INT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_silo_keywords_target_topic_id_fkey') THEN
    ALTER TABLE content_silo_keywords
      ADD CONSTRAINT content_silo_keywords_target_topic_id_fkey
      FOREIGN KEY (target_topic_id) REFERENCES content_topics(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN content_silo_keywords.used_at IS
  'Claimed by the queue walker. NULL = still available. Cleared if the topic/post is later rejected.';

-- The queue walker''s hot path: next unused keyword for a silo, in order.
CREATE INDEX IF NOT EXISTS idx_silo_keywords_queue
  ON content_silo_keywords (silo_id, sort_order, created_at)
  WHERE used_at IS NULL;

-- target_topic_id needs its own index for two reasons. It carries an
-- ON DELETE SET NULL foreign key, and Postgres does NOT index the referencing
-- side automatically — so every content_topics DELETE would seq-scan this table
-- to find rows to null. It is also the sole lookup key for releaseKeywordsForTopics
-- and attachPostToKeyword, both on the rejection path.
CREATE INDEX IF NOT EXISTS idx_silo_keywords_target_topic
  ON content_silo_keywords (target_topic_id)
  WHERE target_topic_id IS NOT NULL;

-- 3. Provenance in the other direction: a topic/post knows which keyword spawned it.
ALTER TABLE content_topics
  ADD COLUMN IF NOT EXISTS silo_keyword_id UUID;
ALTER TABLE content_posts
  ADD COLUMN IF NOT EXISTS silo_keyword_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_topics_silo_keyword_id_fkey') THEN
    ALTER TABLE content_topics
      ADD CONSTRAINT content_topics_silo_keyword_id_fkey
      FOREIGN KEY (silo_keyword_id) REFERENCES content_silo_keywords(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_posts_silo_keyword_id_fkey') THEN
    ALTER TABLE content_posts
      ADD CONSTRAINT content_posts_silo_keyword_id_fkey
      FOREIGN KEY (silo_keyword_id) REFERENCES content_silo_keywords(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_content_topics_silo_keyword ON content_topics (silo_keyword_id);
CREATE INDEX IF NOT EXISTS idx_content_posts_silo_keyword  ON content_posts  (silo_keyword_id);

-- 4. Backfill cluster_keywords JSONB -> content_silo_keywords, preserving order and
--    the planned/published state. Skips keywords already present for that silo.
--
--    HUB-LESS SILOS ONLY. A silo with a hub page keeps using the hub-and-spoke
--    generator, which reads cluster_keywords and never consumes the queue. Giving
--    it queue rows would show a "3 of 5 keywords left" counter that generation
--    never decrements, and would gate its Generate button on a queue nothing
--    touches. hub_page_url IS NULL is the same condition the generator uses to
--    pick the queue path, so the two stay in agreement by construction.
--
--    selected = true because a backfilled keyword was authored by a human as
--    part of the plan; the optimisation engine's own unchosen candidates are
--    written with selected = false and must never be consumed automatically.
INSERT INTO content_silo_keywords (client_id, silo_id, keyword, keyword_type, sort_order, used_at, selected)
SELECT s.client_id,
       s.id,
       trim(k.value ->> 'keyword'),
       'supporting',
       k.ordinality::int,
       CASE WHEN k.value ->> 'status' = 'published' THEN now() ELSE NULL END,
       true
  FROM content_silos s
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.cluster_keywords, '[]'::jsonb)) WITH ORDINALITY AS k(value, ordinality)
 WHERE s.hub_page_url IS NULL
   AND COALESCE(trim(k.value ->> 'keyword'), '') <> ''
   AND NOT EXISTS (
     SELECT 1 FROM content_silo_keywords ck
      WHERE ck.silo_id = s.id
        AND lower(ck.keyword) = lower(trim(k.value ->> 'keyword'))
   );

-- 5. Mark keywords whose post already exists as used, linking them up.
UPDATE content_silo_keywords ck
   SET used_at        = COALESCE(ck.used_at, p.generated_at, now()),
       target_post_id = p.id
  FROM content_posts p
 WHERE p.silo_id = ck.silo_id
   AND ck.target_post_id IS NULL
   AND lower(COALESCE(p.target_keyword, '')) = lower(ck.keyword);
