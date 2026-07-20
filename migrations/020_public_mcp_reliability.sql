BEGIN;

CREATE TABLE verification_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash bytea NOT NULL UNIQUE,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX verification_sessions_expiry_idx
  ON verification_sessions (expires_at);

ALTER TABLE expert_tasks
  ADD COLUMN idempotency_scope_hash bytea,
  ADD COLUMN idempotency_key_hash bytea;

CREATE UNIQUE INDEX expert_tasks_idempotency_idx
  ON expert_tasks (idempotency_scope_hash, idempotency_key_hash)
  WHERE idempotency_scope_hash IS NOT NULL
    AND idempotency_key_hash IS NOT NULL;

CREATE TABLE public_stats_cache (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  source_release_id uuid REFERENCES releases(id) ON DELETE SET NULL,
  refreshed_at timestamptz NOT NULL,
  refresh_duration_ms integer NOT NULL CHECK (refresh_duration_ms >= 0),
  refresh_error_code text
);

CREATE TABLE pipeline_reconciliation_snapshots (
  reconciliation_key text NOT NULL,
  candidate_id uuid NOT NULL REFERENCES knowledge_candidates(id)
    ON DELETE CASCADE,
  previous_status text NOT NULL,
  previous_resolution_code text,
  previous_resolution_reason text,
  previous_resolution_attempts smallint NOT NULL,
  previous_next_review_at timestamptz,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reconciliation_key, candidate_id)
);

ALTER TABLE knowledge_candidates
  ADD COLUMN deep_review_batch_limit smallint NOT NULL DEFAULT 20 CHECK (
    deep_review_batch_limit BETWEEN 1 AND 20
  ),
  ADD COLUMN technical_retry_count smallint NOT NULL DEFAULT 0 CHECK (
    technical_retry_count BETWEEN 0 AND 20
  ),
  ADD COLUMN last_technical_failure_code text;

CREATE INDEX knowledge_candidates_retry_batch_idx
  ON knowledge_candidates (
    status,
    deep_review_task_id,
    next_review_at,
    deep_review_batch_limit,
    created_at
  )
  WHERE status IN ('deep_review', 'quarantined');

COMMIT;
