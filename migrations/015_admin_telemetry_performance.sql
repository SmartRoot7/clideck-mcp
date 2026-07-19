BEGIN;

CREATE INDEX IF NOT EXISTS knowledge_revisions_created_at_idx
  ON knowledge_revisions (created_at);

CREATE INDEX IF NOT EXISTS knowledge_candidates_published_updated_idx
  ON knowledge_candidates (updated_at)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS pipeline_tasks_completed_at_idx
  ON pipeline_tasks (completed_at)
  WHERE status = 'completed';

CREATE INDEX IF NOT EXISTS agent_runs_started_at_idx
  ON agent_runs (started_at);

CREATE INDEX IF NOT EXISTS candidate_verifications_created_at_idx
  ON candidate_verifications (created_at);

COMMIT;
