BEGIN;

-- Fidelity must recover the extractor identity for an exact task and candidate
-- timestamp. A date-only index scans unrelated runs for every audit candidate.
CREATE INDEX agent_runs_task_history_idx
  ON agent_runs (pipeline_task_id, started_at DESC)
  INCLUDE (model, reasoning_effort);

COMMIT;
