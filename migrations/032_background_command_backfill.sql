BEGIN;

-- Historical command-reference recovery is background work. Keep it below
-- streaming publication so newly verified command batches are released while
-- the remaining manuals continue to be scanned.
UPDATE pipeline_tasks
SET priority = 90,
    updated_at = now()
WHERE status = 'queued'
  AND dedupe_key LIKE
    'source:%:deterministic-command-backfill:v3';

COMMIT;
