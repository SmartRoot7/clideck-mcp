BEGIN;

ALTER TABLE knowledge_items
  DROP CONSTRAINT knowledge_items_kind_check;
ALTER TABLE knowledge_items
  ADD CONSTRAINT knowledge_items_kind_check
  CHECK (kind IN (
    'command',
    'workflow',
    'diagnostic',
    'concept',
    'change',
    'upgrade'
  ));

CREATE TABLE device_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id uuid NOT NULL REFERENCES platforms(id) ON DELETE RESTRICT,
  slug text NOT NULL,
  display_name text NOT NULL,
  model_pattern text NOT NULL,
  support_level text NOT NULL DEFAULT 'recognized' CHECK (
    support_level IN ('recognized', 'deep')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform_id, slug)
);

CREATE TABLE knowledge_revision_contracts (
  revision_id uuid NOT NULL REFERENCES knowledge_revisions(id) ON DELETE RESTRICT,
  contract_type text NOT NULL CHECK (
    contract_type IN ('change', 'verification', 'upgrade')
  ),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (revision_id, contract_type),
  CHECK (jsonb_typeof(payload) = 'object')
);

CREATE TRIGGER knowledge_revision_contracts_immutable
  BEFORE UPDATE OR DELETE ON knowledge_revision_contracts
  FOR EACH ROW EXECUTE FUNCTION prevent_revision_mutation();

CREATE TABLE knowledge_validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id uuid NOT NULL REFERENCES knowledge_revisions(id) ON DELETE RESTRICT,
  validation_type text NOT NULL CHECK (
    validation_type IN (
      'documentation_reviewed',
      'batfish_modeled',
      'runtime_lab_validated'
    )
  ),
  status text NOT NULL CHECK (status IN ('passed', 'failed', 'expired')),
  fixture_key text NOT NULL,
  tool_version text NOT NULL,
  report_hash text NOT NULL CHECK (report_hash ~ '^sha256:[0-9a-f]{64}$'),
  commit_sha text NOT NULL CHECK (commit_sha ~ '^[0-9a-f]{40}$'),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 1000),
  internal_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  executed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (revision_id, validation_type, fixture_key, report_hash)
);

CREATE TABLE knowledge_public_trust (
  revision_id uuid PRIMARY KEY REFERENCES knowledge_revisions(id) ON DELETE RESTRICT,
  validation_level text NOT NULL CHECK (
    validation_level IN (
      'documentation_reviewed',
      'batfish_modeled',
      'runtime_lab_validated'
    )
  ),
  independent_confirmations smallint NOT NULL CHECK (
    independent_confirmations BETWEEN 1 AND 100
  ),
  confidence_explanation text NOT NULL CHECK (
    char_length(confidence_explanation) BETWEEN 10 AND 1000
  ),
  next_review_at date NOT NULL,
  lab_validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE task_public_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES expert_tasks(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (
    stage IN (
      'queued',
      'researching',
      'conflict_check',
      'validating',
      'publishing',
      'completed',
      'failed',
      'cancelled'
    )
  ),
  progress_percent smallint NOT NULL CHECK (
    progress_percent BETWEEN 0 AND 100
  ),
  public_message text NOT NULL CHECK (char_length(public_message) BETWEEN 1 AND 240),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_public_events_task_idx
  ON task_public_events (task_id, created_at, id);

CREATE TABLE public_usage_daily (
  day date NOT NULL,
  operation text NOT NULL CHECK (operation ~ '^[a-z0-9_]{3,80}$'),
  outcome text NOT NULL CHECK (
    outcome IN ('success', 'unknown', 'error', 'blocked', 'rate_limited')
  ),
  request_count bigint NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  total_duration_ms bigint NOT NULL DEFAULT 0 CHECK (total_duration_ms >= 0),
  PRIMARY KEY (day, operation, outcome)
);

CREATE TABLE product_eval_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  suite text NOT NULL CHECK (suite ~ '^[a-z0-9_-]{3,80}$'),
  commit_sha text CHECK (
    commit_sha IS NULL OR commit_sha ~ '^[0-9a-f]{40}$'
  ),
  report_hash text NOT NULL UNIQUE CHECK (
    report_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  case_count integer NOT NULL CHECK (case_count > 0),
  passed_count integer NOT NULL CHECK (
    passed_count BETWEEN 0 AND case_count
  ),
  failed_count integer NOT NULL CHECK (
    failed_count = case_count - passed_count
  ),
  dangerous_false_safe integer NOT NULL CHECK (dangerous_false_safe >= 0),
  p50_ms numeric(10,3) NOT NULL CHECK (p50_ms >= 0),
  p95_ms numeric(10,3) NOT NULL CHECK (p95_ms >= 0),
  max_ms numeric(10,3) NOT NULL CHECK (max_ms >= 0),
  executed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE snapshot_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consent_version text NOT NULL CHECK (consent_version = '2026-07-01'),
  snapshot_type text NOT NULL CHECK (
    snapshot_type IN ('show_version', 'config', 'log', 'topology', 'other')
  ),
  detected_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  sanitized_payload text NOT NULL CHECK (
    octet_length(sanitized_payload) BETWEEN 1 AND 16384
  ),
  content_hash text NOT NULL UNIQUE CHECK (
    content_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  status text NOT NULL DEFAULT 'quarantine' CHECK (
    status IN ('quarantine', 'accepted', 'rejected', 'expired')
  ),
  contributed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days'
);
CREATE INDEX snapshot_contributions_expiry_idx
  ON snapshot_contributions (expires_at)
  WHERE status = 'quarantine';

DROP VIEW public_active_knowledge;

CREATE VIEW public_active_knowledge AS
SELECT
  kr.id AS revision_id,
  ki.stable_key,
  ki.kind,
  v.slug AS vendor_slug,
  v.display_name AS vendor_name,
  p.slug AS platform_slug,
  p.display_name AS platform_name,
  os.slug AS operating_system_slug,
  os.display_name AS operating_system_name,
  kr.version_min,
  kr.version_max,
  kr.version_normalized_min,
  kr.version_normalized_max,
  kr.title,
  kr.summary,
  kr.question_patterns,
  kr.cli_mode,
  kr.command_text,
  kr.procedure_steps,
  kr.prerequisites,
  kr.risks,
  kr.verification_steps,
  kr.rollback_steps,
  kr.limitations,
  kr.dangerous,
  kr.confidence,
  kr.quality_score,
  kr.last_verified_at,
  kr.created_at AS revision_created_at,
  kr.search_document,
  coalesce(kpt.validation_level, 'documentation_reviewed') AS validation_level,
  coalesce(kpt.independent_confirmations, 1) AS independent_confirmations,
  coalesce(
    kpt.confidence_explanation,
    'Verified structured knowledge with bounded version applicability.'
  ) AS confidence_explanation,
  coalesce(kpt.next_review_at, kr.last_verified_at + 180) AS next_review_at,
  kpt.lab_validated_at
FROM active_release ar
JOIN release_items ri ON ri.release_id = ar.release_id
JOIN knowledge_items ki ON ki.id = ri.knowledge_item_id
JOIN knowledge_revisions kr ON kr.id = ri.revision_id
JOIN vendors v ON v.id = kr.vendor_id
LEFT JOIN platforms p ON p.id = kr.platform_id
JOIN operating_systems os ON os.id = kr.operating_system_id
LEFT JOIN knowledge_public_trust kpt ON kpt.revision_id = kr.id;

CREATE VIEW public_active_release_summary AS
SELECT
  r.sequence,
  r.created_at AS published_at
FROM active_release ar
JOIN releases r ON r.id = ar.release_id;

CREATE VIEW public_lab_validation_summary AS
SELECT
  revision_id,
  validation_type,
  status,
  executed_at,
  expires_at
FROM knowledge_validations;

CREATE VIEW public_latest_eval_result AS
SELECT
  suite,
  commit_sha,
  case_count,
  passed_count,
  failed_count,
  dangerous_false_safe,
  p50_ms,
  p95_ms,
  max_ms,
  executed_at
FROM product_eval_runs
ORDER BY executed_at DESC, id DESC
LIMIT 1;

COMMIT;
