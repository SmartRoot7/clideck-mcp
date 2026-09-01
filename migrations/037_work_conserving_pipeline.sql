BEGIN;

-- The production runtime has eight isolated Luna executors. Keep the stored
-- capacity settings aligned with that physical pool; stage-specific limits
-- must not leave an executor idle while useful work exists.
ALTER TABLE pipeline_settings
  ALTER COLUMN max_concurrent_ai_runs SET DEFAULT 8,
  ALTER COLUMN max_deep_review_runs SET DEFAULT 8,
  DROP CONSTRAINT IF EXISTS pipeline_settings_max_deep_review_runs_check;

UPDATE pipeline_settings
SET max_concurrent_ai_runs = 8,
    max_deep_review_runs = 8,
    max_active_sources = 8,
    updated_at = now(),
    updated_by = '037_work_conserving_pipeline'
WHERE singleton;

ALTER TABLE pipeline_settings
  ADD CONSTRAINT pipeline_settings_max_deep_review_runs_check CHECK (
    max_deep_review_runs BETWEEN 1 AND 8
  );

COMMIT;
