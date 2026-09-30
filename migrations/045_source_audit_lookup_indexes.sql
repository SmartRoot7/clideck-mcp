BEGIN;

-- Audit joins include completed extraction tasks and published candidates.
-- Live-task/open-candidate indexes cannot serve these history lookups.
CREATE INDEX pipeline_tasks_source_history_idx
  ON pipeline_tasks (source_candidate_id, id)
  WHERE source_candidate_id IS NOT NULL;

CREATE INDEX knowledge_candidates_fidelity_origin_idx
  ON knowledge_candidates (pipeline_task_id, created_at)
  WHERE status IN ('verified', 'published')
    AND fidelity_status = 'pending' AND fidelity_task_id IS NULL;

COMMIT;
