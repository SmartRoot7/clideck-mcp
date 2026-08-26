BEGIN;

-- Diagnosis is intentionally serialized system-wide. Preserve the oldest
-- highest-priority item and return every other demand to the durable queue.
WITH ranked AS (
  SELECT
    id,
    knowledge_demand_id,
    row_number() OVER (
      ORDER BY
        CASE status WHEN 'running' THEN 0 WHEN 'claimed' THEN 1 ELSE 2 END,
        priority DESC,
        created_at
    ) AS ordinal
  FROM pipeline_tasks
  WHERE task_type = 'demand_diagnosis'
    AND status IN ('queued', 'claimed', 'running')
), cancelled AS (
  UPDATE pipeline_tasks task
     SET status = 'cancelled',
         claim_owner = NULL,
         lease_token_hash = NULL,
         lease_until = NULL,
         heartbeat_at = NULL,
         failure_code = 'GLOBAL_DIAGNOSIS_CAP',
         failure_message = 'Diagnosis returned to the global serialized queue.',
         completed_at = now(),
         updated_at = now()
    FROM ranked
   WHERE ranked.id = task.id
     AND ranked.ordinal > 1
  RETURNING task.id, task.knowledge_demand_id
)
UPDATE knowledge_demands demand
   SET diagnosis_task_id = NULL,
       diagnosis_status = 'queued',
       status = CASE WHEN status = 'published' THEN status ELSE 'diagnosing' END,
       next_retry_at = now(),
       last_seen_at = now()
  FROM cancelled
 WHERE demand.id = cancelled.knowledge_demand_id
   AND demand.diagnosis_task_id = cancelled.id;

CREATE OR REPLACE FUNCTION enforce_single_active_demand_diagnosis()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.task_type = 'demand_diagnosis'
     AND NEW.status IN ('queued', 'claimed', 'running') THEN
    PERFORM pg_advisory_xact_lock(1129074037);
    IF EXISTS (
       SELECT 1
       FROM pipeline_tasks active
       WHERE active.task_type = 'demand_diagnosis'
         AND active.status IN ('queued', 'claimed', 'running')
         AND active.id IS DISTINCT FROM NEW.id
     ) THEN
      RETURN NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pipeline_tasks_single_diagnosis
  ON pipeline_tasks;
CREATE TRIGGER pipeline_tasks_single_diagnosis
BEFORE INSERT OR UPDATE OF task_type, status ON pipeline_tasks
FOR EACH ROW
EXECUTE FUNCTION enforce_single_active_demand_diagnosis();

REVOKE ALL ON FUNCTION enforce_single_active_demand_diagnosis()
FROM PUBLIC;

-- Old queued batches can survive a deployment. Apply the same eight-record
-- cap used by the scheduler without touching a currently leased artifact.
UPDATE pipeline_tasks
   SET payload = jsonb_set(
         payload,
         '{candidates}',
         jsonb_path_query_array(payload, '$.candidates[0 to 7]'),
         false
       ),
       updated_at = now()
 WHERE task_type = 'candidate_deep_review'
   AND status = 'queued'
   AND jsonb_typeof(payload->'candidates') = 'array'
   AND jsonb_array_length(payload->'candidates') > 8;

COMMIT;
