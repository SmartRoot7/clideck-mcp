-- Pair with service/lease health. Incomplete replays update last_seen_at:
-- use actual task completion and complete original-question replay instead.
-- This check never submits synthetic demands.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '8s';
WITH recent AS MATERIALIZED (
  SELECT task_type, knowledge_demand_id, queue_class, result
  FROM pipeline_tasks
  WHERE status = 'completed' AND completed_at >= now() - interval '30 minutes'
), sample_ids AS (
  (SELECT id FROM knowledge_demands WHERE status <> 'published'
   ORDER BY first_seen_at LIMIT 3)
  UNION
  (SELECT id FROM knowledge_demands WHERE status <> 'published'
   ORDER BY demand_count DESC, first_seen_at LIMIT 3)
  UNION
  SELECT id FROM knowledge_demands WHERE id IN (
    '7ddc8291-bf44-4f8e-80b2-4fd62a991638',
    'ae85265e-9d39-4024-ab60-66e6b13277bb'
  )
), samples AS (
  SELECT demand.id, left(demand.question,180) question, demand.status,
    demand.last_error_code, demand.replay_status, demand.demand_count,
    round(extract(epoch FROM now()-demand.first_seen_at)/3600,1) age_hours,
    (SELECT jsonb_build_object(
       'queued',count(*) FILTER (WHERE task.status='queued'),
       'active',count(*) FILTER (WHERE task.status IN ('claimed','running')),
       'latest_completed',max(task.completed_at))
     FROM pipeline_tasks task WHERE task.knowledge_demand_id=demand.id) work
  FROM knowledge_demands demand JOIN sample_ids sample ON sample.id=demand.id
), unfinished AS (
  SELECT source.id, source.knowledge_demand_id,
    count(*) FILTER (WHERE fragment.status='queued' AND fragment.reservation_task_id IS NULL) ready_fragments,
    min(fragment.updated_at) FILTER (WHERE fragment.status='queued' AND fragment.reservation_task_id IS NULL) oldest_ready_at
  FROM source_candidates source
  JOIN knowledge_demands demand ON demand.id=source.knowledge_demand_id AND demand.status<>'published'
  JOIN source_artifacts artifact ON artifact.source_candidate_id=source.id
  JOIN source_fragments fragment ON fragment.source_artifact_id=artifact.id
  WHERE source.status IN ('prepared','analyzing','verifying')
    AND NOT EXISTS (SELECT 1 FROM pipeline_tasks live WHERE live.source_candidate_id=source.id
      AND live.status IN ('queued','claimed','running'))
  GROUP BY source.id
  HAVING count(*) FILTER (WHERE fragment.status='queued' AND fragment.reservation_task_id IS NULL)>0
)
SELECT jsonb_build_object(
  'snapshot_utc',now(),
  'demands',(SELECT jsonb_agg(to_jsonb(s)) FROM (
    SELECT status,last_error_code,count(*) count,
      min(first_seen_at) oldest, count(*) FILTER (WHERE first_seen_at<now()-interval '1 day') older_than_day
    FROM knowledge_demands GROUP BY status,last_error_code) s),
  'real_closures_30m',(SELECT count(*) FROM knowledge_demands
    WHERE status='published' AND replay_status='complete' AND completed_at>=now()-interval '30 minutes'),
  'completed_work_30m',(SELECT jsonb_agg(to_jsonb(s)) FROM (
    SELECT task_type,queue_class,count(*) count,
      count(*) FILTER (WHERE knowledge_demand_id IS NOT NULL) demand_tasks
    FROM recent GROUP BY task_type,queue_class) s),
  'discovery_without_new_evidence_30m',(SELECT count(*) FROM recent
    WHERE knowledge_demand_id IS NOT NULL AND task_type='source_discovery'
      AND coalesce((result->>'inserted_sources')::int,0)=0
      AND coalesce((result->>'reused_fragments')::int,0)=0
      AND coalesce((result->>'reopened_candidates')::int,0)=0),
  'ready_sources_without_work',(SELECT count(*) FROM unfinished),
  'ready_source_sample',(SELECT jsonb_agg(to_jsonb(s)) FROM (
    SELECT * FROM unfinished ORDER BY ready_fragments DESC,id LIMIT 5) s),
  'question_sample',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM samples s)
);
COMMIT;
