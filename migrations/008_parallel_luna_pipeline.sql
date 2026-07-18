ALTER TABLE pipeline_settings
  ADD COLUMN control_generation bigint NOT NULL DEFAULT 0,
  ADD COLUMN pause_requested_at timestamptz;

UPDATE pipeline_settings
SET ai_model = 'gpt-5.6-luna',
    reasoning_effort = 'low',
    max_concurrent_ai_runs = 3,
    updated_at = now(),
    updated_by = '008_parallel_luna_pipeline'
WHERE singleton;

ALTER TABLE pipeline_settings
  ALTER COLUMN ai_model SET DEFAULT 'gpt-5.6-luna',
  ALTER COLUMN reasoning_effort SET DEFAULT 'low',
  ALTER COLUMN max_concurrent_ai_runs SET DEFAULT 3,
  ADD CONSTRAINT pipeline_settings_luna_model_check
    CHECK (ai_model = 'gpt-5.6-luna'),
  ADD CONSTRAINT pipeline_settings_luna_reasoning_check
    CHECK (reasoning_effort = 'low');

ALTER TABLE source_fragments
  DROP CONSTRAINT IF EXISTS source_fragments_status_check;

ALTER TABLE source_fragments
  ADD CONSTRAINT source_fragments_status_check CHECK (
    status IN (
      'queued',
      'reserved',
      'analyzing',
      'analyzed',
      'verified',
      'published',
      'rejected',
      'failed'
    )
  ),
  ADD COLUMN reservation_task_id uuid
    REFERENCES pipeline_tasks(id) ON DELETE SET NULL;

CREATE INDEX source_fragments_reservation_idx
  ON source_fragments (reservation_task_id)
  WHERE reservation_task_id IS NOT NULL;

ALTER TABLE knowledge_candidates
  ADD COLUMN verification_task_id uuid
    REFERENCES pipeline_tasks(id) ON DELETE SET NULL;

CREATE INDEX knowledge_candidates_verification_reservation_idx
  ON knowledge_candidates (verification_task_id)
  WHERE verification_task_id IS NOT NULL;

ALTER TABLE agent_runs
  ADD COLUMN executor_id text;

CREATE INDEX agent_runs_executor_recent_idx
  ON agent_runs (executor_id, started_at DESC);
