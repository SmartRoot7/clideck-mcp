BEGIN;

-- RETURNS TABLE fields are PL/pgSQL OUT variables.  Qualify every demand
-- column that shares one of those names so an already-running demand can be
-- observed again without failing on an ambiguous discovery_task_id.
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
  document_role_value text;
BEGIN
  IF p_tool_name NOT IN (
    'query_network_knowledge',
    'get_network_workflow',
    'query_domain_knowledge',
    'review_network_change',
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
  IF coalesce(p_context->>'vendor_slug', '') !~
       '^[a-z0-9][a-z0-9-]{1,62}$'
     OR coalesce(p_context->>'operating_system_slug', '') !~
       '^[a-z0-9][a-z0-9-]{1,62}$' THEN
    RAISE EXCEPTION 'KNOWLEDGE_DEMAND_NETWORK_CONTEXT_INVALID';
  END IF;

  document_role_value := CASE
    WHEN p_tool_name = 'get_network_workflow' THEN 'configuration'
    WHEN p_tool_name = 'review_network_change' THEN 'configuration'
    WHEN p_tool_name = 'advise_network_upgrade' THEN 'upgrades'
    ELSE 'commands'
  END;

  INSERT INTO coverage_targets (
    vendor_slug,
    product_family,
    model,
    operating_system_slug,
    version_branch,
    document_role,
    priority,
    status,
    next_check_at
  )
  VALUES (
    p_context->>'vendor_slug',
    NULL,
    nullif(p_context->>'model', ''),
    p_context->>'operating_system_slug',
    nullif(p_context->>'version', ''),
    document_role_value,
    100,
    'queued',
    now()
  )
  ON CONFLICT (
    vendor_slug,
    product_family,
    model,
    operating_system_slug,
    version_branch,
    document_role
  )
  DO UPDATE SET
    priority = greatest(coverage_targets.priority, 100),
    status = CASE
      WHEN coverage_targets.status = 'paused'
        THEN coverage_targets.status
      ELSE 'queued'
    END,
    next_check_at = CASE
      WHEN coverage_targets.status = 'paused'
        THEN coverage_targets.next_check_at
      ELSE now()
    END,
    updated_at = now()
  RETURNING coverage_targets.id INTO target_id;

  INSERT INTO knowledge_demands AS stored_demand (
    demand_key,
    domain_id,
    tool_name,
    question,
    context,
    status,
    priority,
    coverage_target_id
  )
  VALUES (
    p_demand_key,
    'network',
    p_tool_name,
    p_question,
    p_context,
    'queued',
    120,
    target_id
  )
  ON CONFLICT (demand_key)
  DO UPDATE SET
    demand_count = stored_demand.demand_count + 1,
    question = excluded.question,
    context = excluded.context,
    status = CASE
      WHEN stored_demand.status IN ('discovering', 'acquiring', 'processing')
        THEN stored_demand.status
      ELSE 'queued'
    END,
    priority = 120,
    coverage_target_id = excluded.coverage_target_id,
    last_error_code = NULL,
    last_seen_at = now(),
    next_retry_at = now(),
    completed_at = NULL
  RETURNING
    stored_demand.id,
    (stored_demand.xmax = 0),
    stored_demand.status
  INTO current_demand_id, was_created, current_status;

  IF current_status IN ('discovering', 'acquiring', 'processing') THEN
    SELECT demand.discovery_task_id
    INTO current_task_id
    FROM knowledge_demands AS demand
    WHERE demand.id = current_demand_id;
    RETURN QUERY
    SELECT current_demand_id, current_task_id, was_created;
    RETURN;
  END IF;

  INSERT INTO pipeline_tasks (
    task_type,
    stage,
    priority,
    coverage_target_id,
    knowledge_demand_id,
    dedupe_key,
    payload,
    requested_reasoning_effort
  )
  VALUES (
    'source_discovery',
    'discover',
    120,
    target_id,
    current_demand_id,
    'demand:' || current_demand_id::text || ':discover',
    jsonb_build_object(
      'coverage_target',
      jsonb_build_object(
        'id', target_id,
        'vendor_slug', p_context->>'vendor_slug',
        'product_family', NULL,
        'model', nullif(p_context->>'model', ''),
        'operating_system_slug', p_context->>'operating_system_slug',
        'version_branch', nullif(p_context->>'version', ''),
        'document_role', document_role_value,
        'priority', 100
      ),
      'knowledge_demand',
      jsonb_build_object(
        'question', p_question,
        'tool_name', p_tool_name,
        'context', p_context
      ),
      'requirements',
      jsonb_build_object(
        'public_https_only', true,
        'official_vendor_sources_only', true,
        'no_authenticated_sources', true,
        'source_urls_are_internal', true
      )
    ),
    'low'
  )
  ON CONFLICT (dedupe_key)
    WHERE status IN ('queued', 'claimed', 'running')
  DO NOTHING
  RETURNING pipeline_tasks.id INTO current_task_id;

  IF current_task_id IS NULL THEN
    SELECT task.id
    INTO current_task_id
    FROM pipeline_tasks AS task
    WHERE task.dedupe_key =
          'demand:' || current_demand_id::text || ':discover'
      AND task.status IN ('queued', 'claimed', 'running')
    ORDER BY task.created_at DESC
    LIMIT 1;
  END IF;

  UPDATE knowledge_demands AS demand
  SET discovery_task_id = current_task_id,
      status = 'discovering',
      last_seen_at = now()
  WHERE demand.id = current_demand_id;

  IF current_task_id IS NOT NULL THEN
    INSERT INTO pipeline_events (
      pipeline_task_id,
      stage,
      event_type,
      message,
      metadata
    )
    VALUES (
      current_task_id,
      'discover',
      'queued',
      'Queued a highest-priority discovery for an unanswered MCP request.',
      jsonb_build_object(
        'knowledge_demand', true,
        'priority', 120
      )
    );
  END IF;

  RETURN QUERY
  SELECT current_demand_id, current_task_id, was_created;
END;
$$;

REVOKE ALL ON FUNCTION queue_network_knowledge_demand(
  text,
  text,
  jsonb,
  bytea
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION queue_network_knowledge_demand(
  text,
  text,
  jsonb,
  bytea
) TO clideck_mcp_api;

-- A late failure from an older linked task could overwrite a demand that had
-- already been resolved.  Restore only results whose exact revision remains
-- active; inactive or rolled-back knowledge is intentionally not revived.
UPDATE knowledge_demands AS demand
SET status = 'published',
    last_error_code = NULL,
    completed_at = coalesce(demand.completed_at, now()),
    last_seen_at = now()
WHERE demand.status <> 'published'
  AND demand.result_revision_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM active_knowledge_state AS active
    WHERE active.revision_id = demand.result_revision_id
  );

COMMIT;
