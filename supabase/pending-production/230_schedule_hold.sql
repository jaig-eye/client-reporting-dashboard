-- Hold a client's automatic planning after its schedule changes.
--
-- The topic cron fills every publish date of the CURRENT schedule that has nothing on it. Topics
-- planned under the old schedule sit on the old dates, so the moment a schedule changed (weekly on
-- Mondays to monthly, say) every new date read as empty and the cron planned it, on top of the old
-- plan: the client was planned twice. Saving a schedule change that leaves planned topics on dates
-- the new schedule doesn't use now sets this, the cron leaves the client's dates alone while it is
-- set, and pressing Regenerate plan (a person, on purpose) plans the new dates and clears it.
--
-- NULL: planning runs as usual. A timestamp: when the change was saved.

ALTER TABLE public.content_settings
  ADD COLUMN IF NOT EXISTS schedule_hold_since TIMESTAMPTZ;

COMMENT ON COLUMN public.content_settings.schedule_hold_since IS
  'Set when a schedule change left planned topics on dates the new schedule does not use. The topic cron skips the client until Regenerate plan clears it. NULL = planning as usual.';

-- Monthly now means the first of the client's publish weekday (the first Monday, say), not the same
-- calendar day each month. That moves every monthly client's dates the moment it deploys, with no
-- settings save to set the hold, so set it here for each monthly client (its own schedule, or the
-- agency default when it has none) with blog topics planned on a date the new rule doesn't use.
-- extract(dow) counts from Sunday = 0, as schedule_day_of_week does.
WITH global_default AS (
  SELECT schedule_frequency, schedule_day_of_week
  FROM public.content_settings
  WHERE client_id IS NULL
  ORDER BY updated_at DESC
  LIMIT 1
)
UPDATE public.content_settings cs
SET schedule_hold_since = now()
WHERE cs.client_id IS NOT NULL
  AND cs.schedule_hold_since IS NULL
  AND COALESCE(cs.schedule_frequency, (SELECT schedule_frequency FROM global_default)) = 'monthly'
  AND EXISTS (
    SELECT 1
    FROM public.content_topics t
    WHERE t.client_id = cs.client_id
      AND t.target_publish_date > current_date
      AND t.status IN ('pending', 'approved', 'generating', 'generated', 'scheduled')
      AND (t.content_type IS NULL OR t.content_type <> 'service_area')
      AND NOT (
        extract(dow FROM t.target_publish_date) = COALESCE(cs.schedule_day_of_week, (SELECT schedule_day_of_week FROM global_default), 1)
        AND extract(day FROM t.target_publish_date) <= 7
      )
  );
