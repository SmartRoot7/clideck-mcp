BEGIN;

ALTER TABLE pipeline_settings ADD COLUMN settings_version integer NOT NULL DEFAULT 1;
CREATE TABLE pipeline_execution_profiles (
  profile_id text PRIMARY KEY CHECK (profile_id IN ('luna', 'luna_high')),
  model text NOT NULL CHECK (length(model) BETWEEN 2 AND 120),
  reasoning_effort text NOT NULL CHECK (reasoning_effort IN ('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max')),
  fallback_model text,
  fallback_reasoning_effort text CHECK (fallback_reasoning_effort IN ('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max')),
  CHECK ((fallback_model IS NULL) = (fallback_reasoning_effort IS NULL))
);
INSERT INTO pipeline_execution_profiles VALUES
  ('luna', 'gpt-5.6-luna', 'low', NULL, NULL),
  ('luna_high', 'gpt-5.6-luna', 'medium', 'gpt-5.6-terra', 'medium');

ALTER TABLE pipeline_tasks ADD COLUMN execution_profile text
  CHECK (execution_profile IN ('luna', 'luna_high'));
CREATE FUNCTION assign_pipeline_execution_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.execution_profile := CASE
    WHEN NEW.task_type = 'demand_diagnosis'
      OR (NEW.task_type = 'candidate_deep_review' AND
        (NEW.requested_reasoning_effort = 'medium' OR NEW.payload->>'review_pass' = 'fallback_low'))
      THEN 'luna_high'
    ELSE 'luna' END;
  RETURN NEW;
END;
$$;
CREATE TRIGGER pipeline_task_execution_profile
BEFORE INSERT OR UPDATE OF task_type, requested_reasoning_effort, payload ON pipeline_tasks
FOR EACH ROW EXECUTE FUNCTION assign_pipeline_execution_profile();
UPDATE pipeline_tasks SET execution_profile = CASE
  WHEN task_type = 'demand_diagnosis' OR (task_type = 'candidate_deep_review' AND
    (requested_reasoning_effort = 'medium' OR payload->>'review_pass' = 'fallback_low'))
    THEN 'luna_high' ELSE 'luna' END;
ALTER TABLE agent_runs
  ADD COLUMN execution_profile text CHECK (execution_profile IN ('luna', 'luna_high')),
  ADD COLUMN settings_version integer,
  ADD COLUMN fallback_from_model text;
ALTER TABLE pipeline_quality_checks
  ADD COLUMN agent_run_id uuid REFERENCES agent_runs(id),
  ADD COLUMN extraction_model text,
  ADD COLUMN extraction_reasoning_effort text;

CREATE TABLE pipeline_model_circuits (
  execution_profile text NOT NULL REFERENCES pipeline_execution_profiles(profile_id),
  task_type text NOT NULL,
  model text NOT NULL,
  reasoning_effort text NOT NULL,
  diagnostic_fingerprint text NOT NULL,
  open_until timestamptz NOT NULL,
  probe_executor_id text,
  configuration_error boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (execution_profile, task_type, model, reasoning_effort)
);
INSERT INTO pipeline_model_circuits (
  execution_profile, task_type, model, reasoning_effort,
  diagnostic_fingerprint, open_until, probe_executor_id
)
SELECT CASE WHEN reasoning_effort = 'medium' OR task_type = 'demand_diagnosis'
  THEN 'luna_high' ELSE 'luna' END,
  task_type, 'gpt-5.6-luna', reasoning_effort,
  diagnostic_fingerprint, open_until, probe_executor_id
FROM pipeline_ai_circuits;

CREATE TABLE pipeline_runtime_catalog (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  protocol_version integer NOT NULL DEFAULT 2,
  cli_version text NOT NULL DEFAULT 'unknown',
  models jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(models) = 'array'),
  supports_structured_output boolean NOT NULL DEFAULT false,
  supports_web_research boolean NOT NULL DEFAULT false,
  error text,
  updated_at timestamptz,
  last_success_at timestamptz,
  refresh_requested_at timestamptz,
  publisher_id text
);
INSERT INTO pipeline_runtime_catalog (singleton) VALUES (true);
CREATE TABLE pipeline_model_pricing (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  prices jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(prices) = 'array'),
  source_url text NOT NULL DEFAULT 'https://learn.chatgpt.com/docs/pricing',
  updated_at timestamptz,
  checked_at timestamptz,
  error text
);
INSERT INTO pipeline_model_pricing (singleton) VALUES (true);
COMMIT;
