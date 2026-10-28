BEGIN;

-- Publication recounts each extractor's published history. Open-candidate and
-- pending-Fidelity indexes exclude these rows; a status-only scan repeats the
-- entire published history for every origin in a mixed publication batch.
CREATE INDEX knowledge_candidates_published_origin_idx
  ON knowledge_candidates (pipeline_task_id)
  WHERE status = 'published';

COMMIT;
