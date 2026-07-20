BEGIN;

-- A single Codex failure must not idle unrelated useful work.  Circuits are
-- isolated by the exact Luna work class and reasoning level that failed.  A
-- later successful probe removes only its own circuit.
CREATE TABLE pipeline_ai_circuits (
  task_type text NOT NULL CHECK (
    task_type IN (
      'expert_research',
      'source_discovery',
      'fragment_analysis',
      'candidate_verification',
      'candidate_deep_review',
      'source_refresh'
    )
  ),
  reasoning_effort text NOT NULL CHECK (
    reasoning_effort IN ('low', 'medium')
  ),
  diagnostic_fingerprint text NOT NULL CHECK (
    diagnostic_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  open_until timestamptz NOT NULL,
  probe_executor_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_type, reasoning_effort)
);

CREATE INDEX pipeline_ai_circuits_open_idx
  ON pipeline_ai_circuits (open_until);

-- Preserve an in-flight legacy circuit through the migration.  The scope is
-- recovered from the latest matching failed run whenever possible; the
-- fallback is Deep Medium because that was the only pre-scoped circuit user.
INSERT INTO pipeline_ai_circuits (
  task_type,
  reasoning_effort,
  diagnostic_fingerprint,
  open_until,
  probe_executor_id
)
SELECT
  coalesce(latest.task_type, 'candidate_deep_review'),
  coalesce(latest.reasoning_effort, 'medium'),
  settings.ai_circuit_reason,
  settings.ai_circuit_open_until,
  settings.ai_circuit_probe_executor_id
FROM pipeline_settings settings
LEFT JOIN LATERAL (
  SELECT
    task.task_type,
    run.reasoning_effort
  FROM agent_runs run
  JOIN pipeline_tasks task ON task.id = run.pipeline_task_id
  WHERE run.status = 'failed'
    AND run.diagnostic_code = 'CODEX_PROCESS_FAILED'
    AND run.diagnostic_fingerprint = settings.ai_circuit_reason
  ORDER BY run.completed_at DESC NULLS LAST
  LIMIT 1
) latest ON true
WHERE settings.singleton
  AND settings.ai_circuit_reason IS NOT NULL
  AND settings.ai_circuit_open_until > now()
ON CONFLICT (task_type, reasoning_effort)
DO UPDATE SET
  diagnostic_fingerprint = excluded.diagnostic_fingerprint,
  open_until = greatest(
    pipeline_ai_circuits.open_until,
    excluded.open_until
  ),
  probe_executor_id = excluded.probe_executor_id,
  updated_at = now();

-- The legacy columns remain additive for rollback compatibility, but no
-- longer control new claims after this point.
UPDATE pipeline_settings
SET ai_circuit_open_until = NULL,
    ai_circuit_reason = NULL,
    ai_circuit_probe_executor_id = NULL,
    updated_at = now(),
    updated_by = '023_scoped_ai_circuits'
WHERE singleton;

COMMIT;
