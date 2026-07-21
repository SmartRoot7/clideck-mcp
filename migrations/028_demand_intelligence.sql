BEGIN;

ALTER TABLE pipeline_tasks
  DROP CONSTRAINT IF EXISTS pipeline_tasks_task_type_check,
  DROP CONSTRAINT IF EXISTS pipeline_tasks_stage_check,
  DROP CONSTRAINT IF EXISTS pipeline_tasks_requested_reasoning_effort_check,
  DROP CONSTRAINT IF EXISTS pipeline_tasks_check;

ALTER TABLE pipeline_tasks
  ADD CONSTRAINT pipeline_tasks_task_type_check CHECK (
    task_type IN (
      'expert_research',
      'demand_diagnosis',
      'source_discovery',
      'source_acquisition',
      'source_conversion',
      'source_chunking',
      'fragment_analysis',
      'candidate_verification',
      'candidate_deep_review',
      'candidate_publication',
      'source_publication',
      'source_refresh'
    )
  ),
  ADD CONSTRAINT pipeline_tasks_stage_check CHECK (
    stage IN (
      'diagnose', 'discover', 'acquire', 'convert', 'chunk', 'analyze',
      'verify', 'deep_review', 'publish'
    )
  ),
  ADD CONSTRAINT pipeline_tasks_requested_reasoning_effort_check CHECK (
    requested_reasoning_effort = 'low'
    OR (
      task_type IN ('candidate_deep_review', 'demand_diagnosis')
      AND requested_reasoning_effort = 'medium'
    )
  ),
  ADD COLUMN queue_class text NOT NULL DEFAULT 'baseline' CHECK (
    queue_class IN ('baseline', 'demand')
  );

UPDATE pipeline_tasks
SET queue_class = 'demand'
WHERE knowledge_demand_id IS NOT NULL;

CREATE INDEX pipeline_tasks_class_claim_idx
  ON pipeline_tasks (
    queue_class, status, available_at, priority DESC, created_at
  );

ALTER TABLE pipeline_events
  DROP CONSTRAINT IF EXISTS pipeline_events_stage_check;
ALTER TABLE pipeline_events
  ADD CONSTRAINT pipeline_events_stage_check CHECK (
    stage IN (
      'diagnose', 'discover', 'acquire', 'convert', 'chunk', 'analyze',
      'verify', 'deep_review', 'publish', 'system'
    )
  );

ALTER TABLE pipeline_ai_circuits
  DROP CONSTRAINT IF EXISTS pipeline_ai_circuits_task_type_check;
ALTER TABLE pipeline_ai_circuits
  ADD CONSTRAINT pipeline_ai_circuits_task_type_check CHECK (
    task_type IN (
      'expert_research',
      'demand_diagnosis',
      'source_discovery',
      'fragment_analysis',
      'candidate_verification',
      'candidate_deep_review',
      'source_refresh'
    )
  );

CREATE TABLE demand_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_key text NOT NULL UNIQUE CHECK (
    topic_key ~ '^sha256:[0-9a-f]{64}$'
  ),
  topic_slug text NOT NULL CHECK (
    topic_slug ~ '^[a-z0-9][a-z0-9-]{1,159}$'
  ),
  domain_id text NOT NULL DEFAULT 'network'
    REFERENCES domain_packs(id) ON DELETE RESTRICT,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(scope) = 'object'
  ),
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count > 0),
  unique_demand_count integer NOT NULL DEFAULT 1 CHECK (
    unique_demand_count > 0
  ),
  priority_score numeric(8,3) NOT NULL DEFAULT 1 CHECK (
    priority_score BETWEEN 0 AND 1000
  ),
  state text NOT NULL DEFAULT 'active' CHECK (
    state IN ('active', 'cooldown', 'resolved', 'exhausted')
  ),
  last_served_at timestamptz,
  next_eligible_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX demand_topics_schedule_idx
  ON demand_topics (
    state, next_eligible_at, last_served_at NULLS FIRST,
    priority_score DESC, created_at
  );

CREATE TABLE knowledge_demand_topic_memberships (
  knowledge_demand_id uuid NOT NULL
    REFERENCES knowledge_demands(id) ON DELETE CASCADE,
  demand_topic_id uuid NOT NULL
    REFERENCES demand_topics(id) ON DELETE CASCADE,
  missing_capabilities text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (knowledge_demand_id, demand_topic_id)
);
CREATE INDEX knowledge_demand_topic_memberships_topic_idx
  ON knowledge_demand_topic_memberships (
    demand_topic_id, knowledge_demand_id
  );

CREATE TABLE knowledge_demand_diagnostics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_demand_id uuid NOT NULL
    REFERENCES knowledge_demands(id) ON DELETE CASCADE,
  pipeline_task_id uuid NOT NULL UNIQUE
    REFERENCES pipeline_tasks(id) ON DELETE CASCADE,
  diagnosis_version text NOT NULL DEFAULT 'demand-v1' CHECK (
    diagnosis_version ~ '^[a-z0-9][a-z0-9._-]{1,63}$'
  ),
  status text NOT NULL CHECK (
    status IN ('completed', 'failed')
  ),
  failure_class text CHECK (
    failure_class IS NULL OR failure_class IN (
      'context_resolution',
      'retrieval_relevance',
      'missing_knowledge',
      'version_scope',
      'incomplete_workflow',
      'tool_error'
    )
  ),
  answer_status text CHECK (
    answer_status IS NULL OR answer_status IN (
      'complete', 'partial', 'unknown'
    )
  ),
  canonical_context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(canonical_context) = 'object'
  ),
  subquestions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(subquestions) = 'array'
  ),
  existing_coverage jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(existing_coverage) = 'object'
  ),
  missing_capabilities text[] NOT NULL DEFAULT '{}',
  search_expansions text[] NOT NULL DEFAULT '{}',
  document_roles text[] NOT NULL DEFAULT '{}',
  recommended_action text CHECK (
    recommended_action IS NULL OR recommended_action IN (
      'reuse_existing', 'add_alias', 'targeted_discovery',
      'repair_search', 'explicit_reject'
    )
  ),
  reasoning_summary text,
  replay_result jsonb,
  artifact_hash text NOT NULL CHECK (
    artifact_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_demand_diagnostics_demand_idx
  ON knowledge_demand_diagnostics (
    knowledge_demand_id, created_at DESC
  );

ALTER TABLE knowledge_demands
  DROP CONSTRAINT IF EXISTS knowledge_demands_status_check;
ALTER TABLE knowledge_demands
  ADD CONSTRAINT knowledge_demands_status_check CHECK (
    status IN (
      'queued', 'diagnosing', 'discovering', 'acquiring', 'processing',
      'published', 'unresolved', 'failed'
    )
  ),
  ADD COLUMN diagnosis_task_id uuid
    REFERENCES pipeline_tasks(id) ON DELETE SET NULL,
  ADD COLUMN diagnosis_status text NOT NULL DEFAULT 'pending' CHECK (
    diagnosis_status IN ('pending', 'queued', 'running', 'completed', 'failed')
  ),
  ADD COLUMN diagnosis_version text NOT NULL DEFAULT 'demand-v1',
  ADD COLUMN canonical_context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(canonical_context) = 'object'
  ),
  ADD COLUMN replay_status text CHECK (
    replay_status IS NULL OR replay_status IN (
      'complete', 'partial', 'unknown', 'failed'
    )
  ),
  ADD COLUMN replayed_at timestamptz;

ALTER TABLE source_candidates
  ADD COLUMN priority_topic_id uuid
    REFERENCES demand_topics(id) ON DELETE SET NULL;
CREATE INDEX source_candidates_priority_topic_idx
  ON source_candidates (priority_topic_id, status, updated_at);

INSERT INTO software_family_aliases (family_id, alias)
SELECT family.id, alias.value
FROM software_families family
CROSS JOIN (VALUES
  ('ONIE Rescue'),
  ('ONIE Installer'),
  ('ONIE Recovery')
) alias(value)
WHERE family.slug = 'onie'
ON CONFLICT (family_id, normalized_alias) DO NOTHING;

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
    'diagnosing', 120, target_id, 'queued'
  )
  ON CONFLICT (demand_key) DO UPDATE SET
    demand_count = stored_demand.demand_count + 1,
    question = excluded.question,
    context = excluded.context,
    status = CASE
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
      'demand_diagnosis', 'diagnose', 110, target_id,
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
      priority = 90
  WHERE id = current_demand_id;

  UPDATE pipeline_tasks
  SET priority = least(priority, 105)
  WHERE id = current_task_id
    AND task_type = 'demand_diagnosis';

  RETURN QUERY SELECT current_demand_id, current_task_id, was_created;
END;
$$;

-- Replace unfinished pre-diagnosis discovery work with one Medium diagnosis.
UPDATE pipeline_tasks task
SET status = 'skipped',
    completed_at = now(),
    failure_code = 'DEMAND_DIAGNOSIS_SUPERSEDED_DISCOVERY',
    failure_message = 'Demand Intelligence diagnoses the gap before discovery.',
    updated_at = now()
FROM knowledge_demands demand
WHERE task.knowledge_demand_id = demand.id
  AND demand.status <> 'published'
  AND task.task_type IN ('source_discovery', 'source_refresh')
  AND task.status = 'queued';

WITH queued AS (
  INSERT INTO pipeline_tasks (
    task_type, stage, priority, coverage_target_id,
    knowledge_demand_id, dedupe_key, payload,
    requested_reasoning_effort, queue_class
  )
  SELECT
    'demand_diagnosis', 'diagnose', 110, demand.coverage_target_id,
    demand.id,
    'demand:' || demand.id::text || ':diagnose:demand-v1',
    jsonb_build_object(
      'knowledge_demand', jsonb_build_object(
        'question', demand.question,
        'tool_name', demand.tool_name,
        'context', demand.context
      ),
      'diagnosis_version', 'demand-v1'
    ),
    'medium', 'demand'
  FROM knowledge_demands demand
  WHERE demand.status <> 'published'
    AND NOT EXISTS (
      SELECT 1 FROM pipeline_tasks active
      WHERE active.knowledge_demand_id = demand.id
        AND active.task_type = 'demand_diagnosis'
        AND active.status IN ('queued', 'claimed', 'running')
    )
  ON CONFLICT (dedupe_key)
    WHERE status IN ('queued', 'claimed', 'running')
  DO NOTHING
  RETURNING id, knowledge_demand_id
)
UPDATE knowledge_demands demand
SET status = 'diagnosing',
    diagnosis_status = 'queued',
    diagnosis_task_id = queued.id,
    last_error_code = NULL,
    next_retry_at = now(),
    last_seen_at = now()
FROM queued
WHERE demand.id = queued.knowledge_demand_id;

REVOKE ALL ON FUNCTION queue_network_knowledge_demand(
  text, text, jsonb, bytea
) FROM PUBLIC;
REVOKE ALL ON FUNCTION queue_network_knowledge_gap(
  text, text, jsonb, bytea
) FROM PUBLIC;

COMMIT;
