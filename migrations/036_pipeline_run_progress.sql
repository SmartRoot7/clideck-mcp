BEGIN;

-- Reprocess starts at most eight runs. Give those runs the same number of
-- scheduler lanes as the executor pool so converted artifacts cannot wait
-- indefinitely behind the former four-source limit.
ALTER TABLE pipeline_settings
  ALTER COLUMN max_active_sources SET DEFAULT 8;

UPDATE pipeline_settings
SET max_active_sources = 8,
    updated_at = now(),
    updated_by = '036_pipeline_run_progress'
WHERE singleton
  AND max_active_sources < 8;

-- These partial indexes cover the scheduler's live-work existence checks.
-- Without them a free source lane can require scanning historical fragments
-- and tasks, eventually reaching the worker's bounded query timeout.
CREATE INDEX IF NOT EXISTS source_fragments_active_artifact_idx
  ON source_fragments (source_artifact_id)
  WHERE status IN ('queued', 'reserved', 'analyzing');

CREATE INDEX IF NOT EXISTS pipeline_tasks_source_live_idx
  ON pipeline_tasks (source_candidate_id, task_type)
  WHERE status IN ('queued', 'claimed', 'running');

CREATE INDEX IF NOT EXISTS knowledge_candidates_task_open_idx
  ON knowledge_candidates (pipeline_task_id, status)
  WHERE status IN (
    'analyzed', 'verified', 'deep_review', 'quarantined'
  );

COMMIT;
