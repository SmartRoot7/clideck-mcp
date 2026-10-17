BEGIN;
ALTER TABLE pipeline_tasks DROP CONSTRAINT pipeline_tasks_task_type_check;
ALTER TABLE pipeline_tasks ADD CONSTRAINT pipeline_tasks_task_type_check CHECK (task_type IN (
 'expert_research','demand_diagnosis','source_discovery','source_acquisition','source_conversion','source_chunking',
 'fragment_analysis','candidate_verification','candidate_deep_review','candidate_publication','source_publication','source_refresh',
 'technical_answer','technical_answer_review','technical_answer_publication'));
ALTER TABLE pipeline_tasks DROP CONSTRAINT pipeline_tasks_requested_reasoning_effort_check;
ALTER TABLE pipeline_tasks ADD CONSTRAINT pipeline_tasks_requested_reasoning_effort_check CHECK (requested_reasoning_effort IN ('low','medium') AND (task_type IN ('candidate_deep_review','demand_diagnosis','technical_answer_review') OR requested_reasoning_effort='low'));
CREATE OR REPLACE FUNCTION assign_pipeline_execution_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.execution_profile := CASE WHEN NEW.task_type IN ('demand_diagnosis','technical_answer_review')
 OR (NEW.task_type='candidate_deep_review' AND (NEW.requested_reasoning_effort='medium' OR NEW.payload->>'review_pass'='fallback_low'))
 THEN 'luna_high' ELSE 'luna' END;
 RETURN NEW;
END; $$;

-- The application registry supplies the canonical manifest below.
INSERT INTO domain_packs (id,manifest_schema_version,pack_version,display_name,description,manifest)
VALUES ('technical-operations','1','1.0.0','Technical Operations',
 'Source-backed working technical diagnostics and workflows.', '{"schema_version":"1","id":"technical-operations","version":"1.0.0","display_name":"Technical Operations","description":"Source-backed macOS/Linux, Node/Python, developer-tool and API diagnostics and workflows. Operating-system and component versions remain separate.","core_compatibility":{"minimum":"1.0.0","maximum":"1.0.0"},"context_dimensions":[{"key":"operating_system","display_name":"Operating system","description":"Operating system explicitly supported by source evidence.","value_type":"string","required":false},{"key":"operating_system_version","display_name":"Operating system version","description":"Documented OS version, separate from a runtime or library version.","value_type":"string","required":false},{"key":"component","display_name":"Component","description":"Primary runtime, library, developer tool or API.","value_type":"string","required":false},{"key":"component_version","display_name":"Component version","description":"Component version explicitly supported by source evidence.","value_type":"string","required":false},{"key":"shell_environment","display_name":"Shell","description":"Requested command environment.","value_type":"string","required":false}],"record_types":[{"id":"command","display_name":"command","description":"Source-backed technical command."},{"id":"workflow","display_name":"workflow","description":"Source-backed technical workflow."},{"id":"diagnostic","display_name":"diagnostic","description":"Source-backed technical diagnostic."},{"id":"concept","display_name":"concept","description":"Source-backed technical concept."},{"id":"change","display_name":"change","description":"Source-backed technical change."},{"id":"upgrade","display_name":"upgrade","description":"Source-backed technical upgrade."}],"capabilities":{"search":true,"workflows":true,"continuous_learning":true,"artifacts":false,"spatial":false,"relations":false,"lab_validation":false}}'::jsonb);
ALTER TABLE knowledge_demands ADD COLUMN technical_answer_key uuid NOT NULL DEFAULT gen_random_uuid();
CREATE TABLE technical_demand_answers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), demand_id uuid NOT NULL REFERENCES knowledge_demands(id) ON DELETE CASCADE,
 question_key text NOT NULL, feedback_hash text NOT NULL, requested_context jsonb NOT NULL,
 evidence_hash text NOT NULL, evidence_refs jsonb NOT NULL, policy_version text NOT NULL,
 status text NOT NULL DEFAULT 'drafting' CHECK(status IN ('drafting','review_queued','publication_queued','published','unresolved','failed','superseded')),
 answer_status text NOT NULL DEFAULT 'unknown' CHECK(answer_status IN ('unknown','partial','complete')),
 candidate jsonb, required_capabilities text[] NOT NULL DEFAULT '{}', covered_capabilities text[] NOT NULL DEFAULT '{}',
 missing_capabilities text[] NOT NULL DEFAULT '{}', missing_context text[] NOT NULL DEFAULT '{}', next_searches text[] NOT NULL DEFAULT '{}', reason text,
 draft_task_id uuid REFERENCES pipeline_tasks(id), review_task_id uuid REFERENCES pipeline_tasks(id), publication_task_id uuid REFERENCES pipeline_tasks(id),
 revision_id uuid REFERENCES knowledge_revisions(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(demand_id,evidence_hash)
);
CREATE INDEX technical_demand_answers_exact_idx ON technical_demand_answers(question_key,feedback_hash,updated_at DESC) WHERE status='published';
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
  learning_domain text := coalesce(p_context->>'learning_domain_id','network');
BEGIN
  IF learning_domain NOT IN ('network','technical-operations') THEN RAISE EXCEPTION 'KNOWLEDGE_DEMAND_DOMAIN_INVALID'; END IF;
  IF learning_domain='technical-operations' THEN
    p_context := (p_context - 'learning_context_required') || jsonb_build_object(
      'vendor_slug','technical-operations',
      'operating_system_slug',coalesce(nullif(regexp_replace(lower(coalesce(p_context->>'operating_system',p_context->'raw_context'->>'operating_system','technical')), '[^a-z0-9-]', '-', 'g'),''),'technical'));
  END IF;
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
    p_demand_key, learning_domain, p_tool_name, p_question, p_context,
    'diagnosing', 160, target_id, 'queued'
  )
  ON CONFLICT (demand_key) DO UPDATE SET
    demand_count = stored_demand.demand_count + 1,
    domain_id = excluded.domain_id,
    technical_answer_key = CASE WHEN learning_domain='technical-operations' AND stored_demand.question IS DISTINCT FROM excluded.question THEN gen_random_uuid() ELSE stored_demand.technical_answer_key END,
    question = excluded.question,
    context = CASE WHEN learning_domain='technical-operations' AND NOT (p_context ? 'feedback_reason') AND stored_demand.context ? 'feedback_reason'
      THEN excluded.context || jsonb_build_object('feedback_reason',stored_demand.context->'feedback_reason',
        'reported_revision_refs',stored_demand.context->'reported_revision_refs',
        'technical_feedback_hash',stored_demand.context->'technical_feedback_hash')
      ELSE excluded.context END,
    status = CASE
      WHEN learning_domain='technical-operations' AND stored_demand.last_error_code='CONTEXT_REQUIRED' AND NOT (p_context ? 'feedback_reason') THEN 'unresolved'
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
    last_error_code = CASE WHEN learning_domain='technical-operations' AND stored_demand.last_error_code='CONTEXT_REQUIRED' AND NOT (p_context ? 'feedback_reason') THEN stored_demand.last_error_code ELSE NULL END,
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
-- Reclassify existing unresolved software questions only; immutable revisions stay unchanged.
UPDATE knowledge_demands SET domain_id='technical-operations',
 context=(context-'learning_context_required') || '{"learning_domain_id":"technical-operations"}'::jsonb,
 last_error_code=NULL,next_retry_at=now()
WHERE status<>'published' AND domain_id='network' AND (
 id IN ('7ddc8291-bf44-4f8e-80b2-4fd62a991638','ae85265e-9d39-4024-ab60-66e6b13277bb')
 OR lower(coalesce(context->>'operating_system',context->>'operating_system_slug','')) IN ('macos','darwin')
 OR (coalesce(context->>'platform_slug','') IN ('','not-specified') AND question ~* '\m(huggingface_hub|node\.js|pnpm|pip3|docker|python3)\M'
   AND question !~* '\m(bgp|ospf|evpn|vxlan|macsec|junos|catalyst|arista)\M'));
COMMIT;
