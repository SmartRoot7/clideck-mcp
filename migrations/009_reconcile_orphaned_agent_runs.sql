UPDATE agent_runs run
SET status = 'failed',
    error_code = 'ORPHANED_AGENT_RUN',
    completed_at = now()
WHERE run.status = 'running'
  AND run.started_at < now() - interval '15 minutes'
  AND NOT EXISTS (
    SELECT 1
    FROM pipeline_tasks task
    WHERE task.id = run.pipeline_task_id
      AND task.status IN ('claimed', 'running')
  );
