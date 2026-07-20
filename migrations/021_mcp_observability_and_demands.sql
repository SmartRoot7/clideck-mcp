BEGIN;

CREATE TABLE knowledge_demands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_key bytea NOT NULL UNIQUE,
  domain_id text NOT NULL DEFAULT 'network'
    REFERENCES domain_packs(id) ON DELETE RESTRICT,
  tool_name text NOT NULL CHECK (
    tool_name ~ '^[a-z][a-z0-9_]{2,63}$'
  ),
  question text NOT NULL CHECK (
    char_length(question) BETWEEN 3 AND 2_000
  ),
  context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(context) = 'object'
  ),
  status text NOT NULL DEFAULT 'queued' CHECK (
    status IN (
      'queued',
      'discovering',
      'acquiring',
      'processing',
      'published',
      'unresolved',
      'failed'
    )
  ),
  priority smallint NOT NULL DEFAULT 120 CHECK (
    priority BETWEEN 0 AND 200
  ),
  demand_count integer NOT NULL DEFAULT 1 CHECK (demand_count > 0),
  coverage_target_id uuid REFERENCES coverage_targets(id),
  discovery_task_id uuid REFERENCES pipeline_tasks(id) ON DELETE SET NULL,
  source_candidate_id uuid REFERENCES source_candidates(id) ON DELETE SET NULL,
  result_revision_id uuid REFERENCES knowledge_revisions(id),
  result_release_id uuid REFERENCES releases(id),
  last_error_code text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX knowledge_demands_queue_idx
  ON knowledge_demands (priority DESC, next_retry_at, first_seen_at)
  WHERE status IN ('queued', 'unresolved', 'failed');
CREATE INDEX knowledge_demands_recent_idx
  ON knowledge_demands (last_seen_at DESC);

ALTER TABLE pipeline_tasks
  DROP CONSTRAINT IF EXISTS pipeline_tasks_priority_check;

ALTER TABLE pipeline_tasks
  ADD CONSTRAINT pipeline_tasks_priority_check CHECK (
    priority BETWEEN -100 AND 200
  ),
  ADD COLUMN knowledge_demand_id uuid
    REFERENCES knowledge_demands(id) ON DELETE SET NULL;

ALTER TABLE source_candidates
  ADD COLUMN knowledge_demand_id uuid
    REFERENCES knowledge_demands(id) ON DELETE SET NULL;

CREATE INDEX pipeline_tasks_demand_idx
  ON pipeline_tasks (knowledge_demand_id, status, created_at)
  WHERE knowledge_demand_id IS NOT NULL;
CREATE INDEX source_candidates_demand_idx
  ON source_candidates (knowledge_demand_id, status, updated_at)
  WHERE knowledge_demand_id IS NOT NULL;

CREATE TABLE mcp_request_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id uuid NOT NULL,
  client_ip inet,
  actor_kind text NOT NULL CHECK (
    actor_kind IN ('anonymous', 'tenant')
  ),
  tool_name text NOT NULL CHECK (
    tool_name ~ '^[a-z][a-z0-9_]{2,63}$'
  ),
  request_payload jsonb NOT NULL CHECK (
    jsonb_typeof(request_payload) IN ('object', 'array')
  ),
  response_payload jsonb NOT NULL CHECK (
    jsonb_typeof(response_payload) IN ('object', 'array')
  ),
  question_preview text NOT NULL CHECK (
    char_length(question_preview) <= 1_000
  ),
  response_preview text NOT NULL CHECK (
    char_length(response_preview) <= 2_000
  ),
  outcome text NOT NULL CHECK (
    outcome IN ('success', 'unknown', 'blocked', 'error', 'rate_limited')
  ),
  error_code text,
  retryable boolean NOT NULL DEFAULT false,
  duration_ms integer NOT NULL CHECK (
    duration_ms BETWEEN 0 AND 2147483647
  ),
  knowledge_demand_id uuid
    REFERENCES knowledge_demands(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (octet_length(request_payload::text) <= 131072),
  CHECK (octet_length(response_payload::text) <= 262144)
);

CREATE INDEX mcp_request_logs_recent_idx
  ON mcp_request_logs (occurred_at DESC, id DESC);
CREATE INDEX mcp_request_logs_tool_recent_idx
  ON mcp_request_logs (tool_name, occurred_at DESC, id DESC);
CREATE INDEX mcp_request_logs_outcome_recent_idx
  ON mcp_request_logs (outcome, occurred_at DESC, id DESC);
CREATE INDEX mcp_request_logs_demand_idx
  ON mcp_request_logs (knowledge_demand_id)
  WHERE knowledge_demand_id IS NOT NULL;

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
  RETURNING id INTO target_id;

  INSERT INTO knowledge_demands (
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
    demand_count = knowledge_demands.demand_count + 1,
    question = excluded.question,
    context = excluded.context,
    status = CASE
      WHEN knowledge_demands.status IN ('discovering', 'acquiring', 'processing')
        THEN knowledge_demands.status
      ELSE 'queued'
    END,
    priority = 120,
    coverage_target_id = excluded.coverage_target_id,
    last_error_code = NULL,
    last_seen_at = now(),
    next_retry_at = now(),
    completed_at = NULL
  RETURNING id, (xmax = 0), status
  INTO current_demand_id, was_created, current_status;

  IF current_status IN ('discovering', 'acquiring', 'processing') THEN
    SELECT discovery_task_id
    INTO current_task_id
    FROM knowledge_demands
    WHERE id = current_demand_id;
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
  RETURNING id INTO current_task_id;

  IF current_task_id IS NULL THEN
    SELECT id
    INTO current_task_id
    FROM pipeline_tasks
    WHERE dedupe_key = 'demand:' || current_demand_id::text || ':discover'
      AND status IN ('queued', 'claimed', 'running')
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  UPDATE knowledge_demands
  SET discovery_task_id = current_task_id,
      status = 'discovering',
      last_seen_at = now()
  WHERE id = current_demand_id;

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

COMMIT;
