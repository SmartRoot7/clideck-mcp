BEGIN;

ALTER TABLE pipeline_settings
  ADD COLUMN prepared_source_target smallint NOT NULL DEFAULT 8 CHECK (
    prepared_source_target BETWEEN 1 AND 32
  ),
  ADD COLUMN ai_circuit_open_until timestamptz,
  ADD COLUMN ai_circuit_reason text,
  ADD COLUMN ai_circuit_probe_executor_id text;

ALTER TABLE pipeline_settings
  DROP CONSTRAINT IF EXISTS pipeline_settings_max_deep_review_runs_check;

ALTER TABLE pipeline_settings
  ADD CONSTRAINT pipeline_settings_max_deep_review_runs_check CHECK (
    max_deep_review_runs BETWEEN 1 AND 4
  );

UPDATE pipeline_settings
SET max_deep_review_runs = max_concurrent_ai_runs,
    prepared_source_target = 8,
    updated_at = now(),
    updated_by = '017_streaming_publication'
WHERE singleton;

ALTER TABLE source_candidates
  DROP CONSTRAINT IF EXISTS source_candidates_status_check;

ALTER TABLE source_candidates
  ADD CONSTRAINT source_candidates_status_check CHECK (
    status IN (
      'discovered',
      'approved',
      'acquiring',
      'acquired',
      'converting',
      'converted',
      'chunking',
      'prepared',
      'analyzing',
      'verifying',
      'publishing',
      'completed',
      'completed_with_exceptions',
      'duplicate',
      'rejected',
      'failed'
    )
  );

ALTER TABLE pipeline_tasks
  DROP CONSTRAINT IF EXISTS pipeline_tasks_task_type_check;

ALTER TABLE pipeline_tasks
  ADD CONSTRAINT pipeline_tasks_task_type_check CHECK (
    task_type IN (
      'expert_research',
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
  ADD COLUMN available_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX pipeline_tasks_ready_queue_idx
  ON pipeline_tasks (priority DESC, available_at, created_at)
  WHERE status = 'queued';

ALTER TABLE knowledge_candidates
  ADD COLUMN publication_task_id uuid
    REFERENCES pipeline_tasks(id) ON DELETE SET NULL,
  ADD COLUMN resolution_code text CHECK (
    resolution_code IS NULL
    OR resolution_code ~ '^[a-z][a-z0-9_]{1,63}$'
  );

CREATE INDEX knowledge_candidates_publication_queue_idx
  ON knowledge_candidates (status, publication_task_id, updated_at)
  WHERE status = 'verified';

CREATE INDEX knowledge_candidates_publication_reservation_idx
  ON knowledge_candidates (publication_task_id)
  WHERE publication_task_id IS NOT NULL;

CREATE INDEX knowledge_candidates_deep_resolution_idx
  ON knowledge_candidates (
    status,
    resolution_attempts,
    resolution_code,
    next_review_at,
    created_at
  )
  WHERE status IN ('deep_review', 'quarantined');

-- The streaming publisher supersedes source-wide publication tasks. The
-- rollout pauses the pool before this migration, so every unfinished legacy
-- publication can be safely returned to the record-level queue.
UPDATE pipeline_tasks
SET status = 'skipped',
    claim_owner = NULL,
    lease_token_hash = NULL,
    lease_until = NULL,
    completed_at = now(),
    failure_code = 'STREAMING_PUBLICATION_SUPERSEDED',
    failure_message = 'Superseded by record-level streaming publication.',
    updated_at = now()
WHERE task_type = 'source_publication'
  AND status IN ('queued', 'claimed', 'running');

UPDATE source_candidates
SET status = 'verifying',
    updated_at = now()
WHERE status = 'publishing';

-- Recover sources previously marked failed after a mechanical chunk/fast-path
-- failure. Their immutable artifacts determine the safe restart point.
UPDATE source_candidates source
SET status = CASE artifact.status
      WHEN 'chunked' THEN 'prepared'
      WHEN 'converted' THEN 'converted'
      WHEN 'downloaded' THEN 'acquired'
      ELSE source.status
    END,
    failure_code = CASE
      WHEN artifact.status IN ('chunked', 'converted', 'downloaded')
        THEN NULL
      ELSE source.failure_code
    END,
    failure_message = CASE
      WHEN artifact.status IN ('chunked', 'converted', 'downloaded')
        THEN NULL
      ELSE source.failure_message
    END,
    updated_at = now()
FROM source_artifacts artifact
WHERE artifact.source_candidate_id = source.id
  AND source.status = 'failed'
  AND artifact.status IN ('chunked', 'converted', 'downloaded');

ALTER TABLE releases
  ADD COLUMN parent_release_id uuid REFERENCES releases(id),
  ADD COLUMN release_mode text NOT NULL DEFAULT 'snapshot' CHECK (
    release_mode IN ('snapshot', 'delta', 'checkpoint')
  ),
  ADD COLUMN item_count integer NOT NULL DEFAULT 0 CHECK (
    item_count >= 0
  );

UPDATE releases release
SET item_count = (
  SELECT count(*)::int
  FROM release_items item
  WHERE item.release_id = release.id
);

CREATE TABLE release_changes (
  release_id uuid NOT NULL REFERENCES releases(id) ON DELETE RESTRICT,
  knowledge_item_id uuid NOT NULL
    REFERENCES knowledge_items(id) ON DELETE RESTRICT,
  previous_revision_id uuid REFERENCES knowledge_revisions(id)
    ON DELETE RESTRICT,
  new_revision_id uuid NOT NULL REFERENCES knowledge_revisions(id)
    ON DELETE RESTRICT,
  PRIMARY KEY (release_id, knowledge_item_id),
  UNIQUE (release_id, new_revision_id)
);

CREATE INDEX release_changes_item_history_idx
  ON release_changes (knowledge_item_id, release_id);

CREATE TABLE active_knowledge_state (
  knowledge_item_id uuid PRIMARY KEY
    REFERENCES knowledge_items(id) ON DELETE RESTRICT,
  revision_id uuid NOT NULL REFERENCES knowledge_revisions(id)
    ON DELETE RESTRICT UNIQUE,
  activated_release_id uuid NOT NULL REFERENCES releases(id)
    ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO active_knowledge_state (
  knowledge_item_id,
  revision_id,
  activated_release_id
)
SELECT
  item.knowledge_item_id,
  item.revision_id,
  active.release_id
FROM active_release active
JOIN release_items item ON item.release_id = active.release_id
ON CONFLICT (knowledge_item_id) DO UPDATE SET
  revision_id = excluded.revision_id,
  activated_release_id = excluded.activated_release_id,
  updated_at = now();

CREATE INDEX active_knowledge_state_release_idx
  ON active_knowledge_state (activated_release_id);

ALTER TABLE agent_runs
  ADD COLUMN process_exit_code smallint,
  ADD COLUMN diagnostic_code text,
  ADD COLUMN diagnostic_fingerprint text CHECK (
    diagnostic_fingerprint IS NULL
    OR diagnostic_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  );

CREATE INDEX agent_runs_diagnostic_recent_idx
  ON agent_runs (diagnostic_code, diagnostic_fingerprint, completed_at DESC)
  WHERE status = 'failed';

CREATE OR REPLACE VIEW public_active_knowledge AS
SELECT
  kr.id AS revision_id,
  ki.stable_key,
  ki.kind,
  kr.created_by AS origin,
  kr.risk_level,
  v.slug AS vendor_slug,
  v.display_name AS vendor_name,
  p.slug AS platform_slug,
  p.display_name AS platform_name,
  os.slug AS operating_system_slug,
  coalesce(os.display_name, 'Not specified') AS operating_system_name,
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
  coalesce(
    current_validation.validation_level,
    CASE
      WHEN kpt.validation_level IN (
        'batfish_modeled',
        'runtime_lab_validated'
      )
        THEN 'documentation_reviewed'
      ELSE kpt.validation_level
    END,
    'documentation_reviewed'
  ) AS validation_level,
  coalesce(kpt.independent_confirmations, 1) AS independent_confirmations,
  coalesce(
    kpt.confidence_explanation,
    'Verified structured knowledge with bounded applicability.'
  ) AS confidence_explanation,
  coalesce(kpt.next_review_at, kr.last_verified_at + 180) AS next_review_at,
  current_validation.lab_validated_at
FROM active_knowledge_state active
JOIN knowledge_items ki ON ki.id = active.knowledge_item_id
JOIN knowledge_revisions kr ON kr.id = active.revision_id
JOIN vendors v ON v.id = kr.vendor_id
LEFT JOIN platforms p ON p.id = kr.platform_id
LEFT JOIN operating_systems os ON os.id = kr.operating_system_id
LEFT JOIN knowledge_public_trust kpt ON kpt.revision_id = kr.id
LEFT JOIN LATERAL current_knowledge_validation(kr.id)
  current_validation ON true
WHERE ki.domain_id = 'network'
  AND kr.domain_id = 'network';

CREATE OR REPLACE VIEW public_active_domain_knowledge AS
SELECT
  kr.id AS revision_id,
  ki.domain_id,
  dp.display_name AS domain_name,
  ki.stable_key,
  ki.kind AS record_type,
  kr.domain_schema_version,
  kr.domain_context,
  kr.domain_payload,
  kr.title,
  kr.summary,
  kr.question_patterns,
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
  coalesce(
    current_validation.validation_level,
    CASE
      WHEN kpt.validation_level IN (
        'batfish_modeled',
        'runtime_lab_validated'
      )
        THEN 'documentation_reviewed'
      ELSE kpt.validation_level
    END,
    'documentation_reviewed'
  ) AS validation_level,
  coalesce(kpt.independent_confirmations, 1) AS independent_confirmations,
  coalesce(
    kpt.confidence_explanation,
    'Verified structured knowledge with bounded applicability.'
  ) AS confidence_explanation,
  coalesce(kpt.next_review_at, kr.last_verified_at + 180) AS next_review_at,
  kr.revision_number,
  release.sequence AS release_sequence
FROM active_knowledge_state active
JOIN active_release active_release_row ON active_release_row.singleton
JOIN releases release ON release.id = active_release_row.release_id
JOIN knowledge_items ki ON ki.id = active.knowledge_item_id
JOIN knowledge_revisions kr ON kr.id = active.revision_id
JOIN domain_packs dp ON dp.id = ki.domain_id AND dp.enabled
LEFT JOIN knowledge_public_trust kpt ON kpt.revision_id = kr.id
LEFT JOIN LATERAL current_knowledge_validation(kr.id)
  current_validation ON true
WHERE ki.domain_id = kr.domain_id;

COMMIT;
