BEGIN;

-- Diagnosis may occupy every operator-enabled executor, while remaining unique
-- per demand. Never silently suppress the durable task insertion globally.
DROP TRIGGER IF EXISTS pipeline_tasks_single_diagnosis ON pipeline_tasks;
DROP FUNCTION IF EXISTS enforce_single_active_demand_diagnosis();
CREATE UNIQUE INDEX pipeline_tasks_live_diagnosis_per_demand_idx
  ON pipeline_tasks (knowledge_demand_id)
  WHERE task_type='demand_diagnosis' AND status IN ('queued','claimed','running');

UPDATE knowledge_demands demand
SET diagnosis_status='pending',diagnosis_task_id=NULL,next_retry_at=now()
WHERE diagnosis_status IN ('queued','running') AND status<>'published'
  AND NOT EXISTS (SELECT 1 FROM pipeline_tasks task
    WHERE task.knowledge_demand_id=demand.id AND task.task_type='demand_diagnosis'
      AND task.status IN ('queued','claimed','running'));

ALTER TABLE mcp_request_logs ADD COLUMN learning_recovery_checked_at timestamptz;
CREATE INDEX mcp_request_logs_learning_recovery_idx ON mcp_request_logs (occurred_at DESC)
  WHERE outcome='unknown' AND knowledge_demand_id IS NULL AND learning_recovery_checked_at IS NULL;

CREATE OR REPLACE FUNCTION queue_network_knowledge_demand(
  p_tool_name text,
  p_question text,
  p_context jsonb,
  p_demand_key bytea
)
RETURNS TABLE (
  demand_id uuid,
  discovery_task_id uuid,
  created boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_id uuid;
  current_demand_id uuid;
  current_task_id uuid;
  was_created boolean := false;
  current_status text;
  current_diagnosis_status text;
  document_role_value text;
BEGIN
  IF p_tool_name NOT IN (
    'query_network_knowledge', 'get_network_workflow',
    'query_domain_knowledge', 'review_network_change',
    'advise_network_upgrade'
  ) THEN
    RAISE EXCEPTION 'KNOWLEDGE_DEMAND_TOOL_INVALID';
  END IF;
  IF char_length(p_question) NOT BETWEEN 3 AND 2000 THEN
    RAISE EXCEPTION 'KNOWLEDGE_DEMAND_QUESTION_INVALID';
  END IF;
  IF jsonb_typeof(p_context) <> 'object' THEN
    RAISE EXCEPTION 'KNOWLEDGE_DEMAND_CONTEXT_INVALID';
  END IF;
  IF p_context->>'learning_context_required' = 'true' THEN
    INSERT INTO knowledge_demands AS stored (demand_key,tool_name,question,context,status,priority,diagnosis_status,last_error_code)
    VALUES (p_demand_key,p_tool_name,p_question,p_context,'unresolved',160,'pending','CONTEXT_REQUIRED')
    ON CONFLICT (demand_key) DO UPDATE SET demand_count=stored.demand_count+1,last_seen_at=now(),context=excluded.context
    RETURNING stored.id,(stored.xmax=0) INTO current_demand_id,was_created;
    RETURN QUERY SELECT current_demand_id,NULL::uuid,was_created;
    RETURN;
  END IF;
  IF coalesce(p_context->>'vendor_slug', '') !~
       '^[a-z0-9][a-z0-9-]{1,62}$'
     OR coalesce(p_context->>'operating_system_slug', '') !~
       '^[a-z0-9][a-z0-9-]{1,62}$' THEN
    RAISE EXCEPTION 'KNOWLEDGE_DEMAND_NETWORK_CONTEXT_INVALID';
  END IF;

  document_role_value := CASE
    WHEN p_tool_name IN ('get_network_workflow', 'review_network_change')
      THEN 'configuration'
    WHEN p_tool_name = 'advise_network_upgrade' THEN 'upgrades'
    ELSE 'commands'
  END;

  INSERT INTO coverage_targets (
    vendor_slug, product_family, model, operating_system_slug,
    version_branch, document_role, priority, status, next_check_at
  ) VALUES (
    p_context->>'vendor_slug', NULL, nullif(p_context->>'model', ''),
    p_context->>'operating_system_slug', nullif(p_context->>'version', ''),
    document_role_value, 100, 'active', now() + interval '1 day'
  )
  ON CONFLICT (
    vendor_slug, product_family, model, operating_system_slug,
    version_branch, document_role
  ) DO UPDATE SET
    priority = greatest(coverage_targets.priority, 100),
    updated_at = now()
  RETURNING coverage_targets.id INTO target_id;

  INSERT INTO knowledge_demands AS stored_demand (
    demand_key, domain_id, tool_name, question, context, status,
    priority, coverage_target_id, diagnosis_status
  ) VALUES (
    p_demand_key, 'network', p_tool_name, p_question, p_context,
    'diagnosing', 160, target_id, 'queued'
  )
  ON CONFLICT (demand_key) DO UPDATE SET
    demand_count = stored_demand.demand_count + 1,
    question = excluded.question,
    context = excluded.context,
    status = CASE
      WHEN p_context ? 'feedback_reason' THEN 'diagnosing'
      WHEN stored_demand.diagnosis_status = 'completed'
        AND stored_demand.status <> 'published' THEN 'queued'
      WHEN stored_demand.status IN (
        'diagnosing', 'discovering', 'acquiring', 'processing'
      ) THEN stored_demand.status
      ELSE 'diagnosing'
    END,
    priority = greatest(stored_demand.priority, excluded.priority),
    coverage_target_id = excluded.coverage_target_id,
    diagnosis_status = CASE
      WHEN p_context ? 'feedback_reason' AND stored_demand.diagnosis_status NOT IN ('queued','running') THEN 'pending'
      WHEN stored_demand.diagnosis_status IN ('queued', 'running')
        THEN stored_demand.diagnosis_status
      WHEN stored_demand.diagnosis_status = 'completed'
        AND stored_demand.status <> 'published'
        THEN 'completed'
      ELSE 'queued'
    END,
    last_error_code = NULL,
    last_seen_at = now(),
    next_retry_at = now(),
    completed_at = NULL
  RETURNING
    stored_demand.id,
    (stored_demand.xmax = 0),
    stored_demand.status,
    stored_demand.diagnosis_status
  INTO
    current_demand_id,
    was_created,
    current_status,
    current_diagnosis_status;

  SELECT task.id INTO current_task_id
  FROM pipeline_tasks task
  WHERE task.knowledge_demand_id = current_demand_id
    AND task.task_type = 'demand_diagnosis'
    AND task.status IN ('queued', 'claimed', 'running')
  ORDER BY task.created_at DESC
  LIMIT 1;

  IF current_task_id IS NULL AND current_status = 'diagnosing' THEN
    INSERT INTO pipeline_tasks (
      task_type, stage, priority, coverage_target_id,
      knowledge_demand_id, dedupe_key, payload,
      requested_reasoning_effort, queue_class
    ) VALUES (
      'demand_diagnosis', 'diagnose', 170, target_id,
      current_demand_id,
      'demand:' || current_demand_id::text || ':diagnose:demand-v1',
      jsonb_build_object(
        'knowledge_demand', jsonb_build_object(
          'question', p_question,
          'tool_name', p_tool_name,
          'context', p_context
        ),
        'diagnosis_version', 'demand-v1'
      ),
      'medium',
      'demand'
    )
    ON CONFLICT (dedupe_key)
      WHERE status IN ('queued', 'claimed', 'running')
    DO NOTHING
    RETURNING pipeline_tasks.id INTO current_task_id;
  END IF;

  UPDATE knowledge_demands demand
  SET diagnosis_task_id = coalesce(current_task_id, diagnosis_task_id),
      diagnosis_status = CASE
        WHEN current_task_id IS NULL THEN diagnosis_status
        ELSE 'queued'
      END,
      status = CASE
        WHEN current_task_id IS NULL THEN CASE
          WHEN diagnosis_status = 'completed' AND status = 'diagnosing'
            THEN 'queued'
          ELSE status
        END
        ELSE 'diagnosing'
      END,
      last_seen_at = now()
  WHERE demand.id = current_demand_id;

  IF NOT was_created THEN
    UPDATE demand_topics topic
    SET request_count = least(2147483647, topic.request_count + 1),
        priority_score = least(
          1000,
          greatest(topic.priority_score, 1 + ln(2 + topic.request_count))
        ),
        updated_at = now()
    FROM knowledge_demand_topic_memberships membership
    WHERE membership.knowledge_demand_id = current_demand_id
      AND membership.demand_topic_id = topic.id;
  END IF;

  IF current_task_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pipeline_events event
    WHERE event.pipeline_task_id = current_task_id
      AND event.event_type = 'queued'
  ) THEN
    INSERT INTO pipeline_events (
      pipeline_task_id, stage, event_type, message, metadata
    ) VALUES (
      current_task_id, 'diagnose', 'queued',
      'Queued Medium diagnosis for an incomplete MCP answer.',
      jsonb_build_object('knowledge_demand', true, 'queue_class', 'demand')
    );
  END IF;

  RETURN QUERY SELECT current_demand_id, current_task_id, was_created;
END;
$$;

CREATE OR REPLACE FUNCTION queue_network_knowledge_gap(
  p_tool_name text,
  p_question text,
  p_context jsonb,
  p_demand_key bytea
)
RETURNS TABLE (
  demand_id uuid,
  discovery_task_id uuid,
  created boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_demand_id uuid;
  current_task_id uuid;
  was_created boolean;
BEGIN
  SELECT queued.demand_id, queued.discovery_task_id, queued.created
  INTO current_demand_id, current_task_id, was_created
  FROM queue_network_knowledge_demand(
    p_tool_name, p_question, p_context, p_demand_key
  ) queued;

  UPDATE knowledge_demands
  SET demand_kind = 'specificity_gap',
      priority = greatest(priority, 160)
  WHERE id = current_demand_id;

  UPDATE pipeline_tasks
  SET priority = greatest(priority, 170)
  WHERE id = current_task_id
    AND task_type = 'demand_diagnosis';

  RETURN QUERY SELECT current_demand_id, current_task_id, was_created;
END;
$$;


COMMIT;
