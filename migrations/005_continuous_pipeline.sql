BEGIN;

ALTER TABLE knowledge_revisions
  ALTER COLUMN operating_system_id DROP NOT NULL;

ALTER TABLE knowledge_revisions
  ADD COLUMN risk_level text NOT NULL DEFAULT 'unknown' CHECK (
    risk_level IN (
      'safe_read_only',
      'changes_config',
      'credential_sensitive',
      'service_disruptive',
      'data_loss',
      'storage_wipe',
      'firmware_change',
      'boot_change',
      'factory_reset',
      'unknown'
    )
  );

CREATE INDEX knowledge_revisions_title_trgm_idx
  ON knowledge_revisions USING gin (lower(title) gin_trgm_ops);
CREATE INDEX knowledge_revisions_admin_list_idx
  ON knowledge_revisions (created_at DESC, id DESC);
CREATE INDEX release_items_revision_lookup_idx
  ON release_items (revision_id, release_id, knowledge_item_id);
CREATE INDEX import_items_run_status_idx
  ON import_items (import_run_id, status, created_at);

ALTER TABLE knowledge_public_trust
  DROP CONSTRAINT knowledge_public_trust_validation_level_check;
ALTER TABLE knowledge_public_trust
  ADD CONSTRAINT knowledge_public_trust_validation_level_check CHECK (
    validation_level IN (
      'legacy_migrated',
      'documentation_reviewed',
      'batfish_modeled',
      'runtime_lab_validated'
    )
  );

ALTER TABLE import_runs
  ADD COLUMN manifest_hash text CHECK (
    manifest_hash IS NULL OR manifest_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  ADD COLUMN records_imported integer NOT NULL DEFAULT 0 CHECK (
    records_imported >= 0
  ),
  ADD COLUMN records_published integer NOT NULL DEFAULT 0 CHECK (
    records_published >= 0
  ),
  ADD COLUMN records_failed integer NOT NULL DEFAULT 0 CHECK (
    records_failed >= 0
  ),
  ADD COLUMN last_legacy_key text;

ALTER TABLE import_items
  ADD COLUMN content_hash text CHECK (
    content_hash IS NULL OR content_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  ADD COLUMN knowledge_item_id uuid REFERENCES knowledge_items(id),
  ADD COLUMN revision_id uuid REFERENCES knowledge_revisions(id),
  ADD COLUMN transformed_at timestamptz,
  ADD COLUMN published_at timestamptz;

CREATE UNIQUE INDEX import_items_run_legacy_key_idx
  ON import_items (import_run_id, legacy_key)
  WHERE legacy_key IS NOT NULL;

CREATE TABLE coverage_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_slug text NOT NULL CHECK (
    vendor_slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'
  ),
  product_family text,
  model text,
  operating_system_slug text NOT NULL CHECK (
    operating_system_slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'
  ),
  version_branch text,
  document_role text NOT NULL CHECK (
    document_role IN (
      'commands',
      'configuration',
      'diagnostics',
      'upgrades',
      'security_advisories',
      'release_notes'
    )
  ),
  priority smallint NOT NULL DEFAULT 0 CHECK (priority BETWEEN -100 AND 100),
  status text NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'discovering', 'active', 'covered', 'paused', 'failed')
  ),
  coverage_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (
    coverage_percent BETWEEN 0 AND 100
  ),
  last_discovered_at timestamptz,
  last_completed_at timestamptz,
  next_check_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (
    vendor_slug,
    product_family,
    model,
    operating_system_slug,
    version_branch,
    document_role
  )
);
CREATE INDEX coverage_targets_scheduler_idx
  ON coverage_targets (
    status,
    priority DESC,
    next_check_at,
    updated_at
  );

CREATE TABLE source_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coverage_target_id uuid NOT NULL REFERENCES coverage_targets(id),
  canonical_url text NOT NULL,
  document_type text NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  document_version text,
  document_date date,
  status text NOT NULL DEFAULT 'discovered' CHECK (
    status IN (
      'discovered',
      'approved',
      'acquiring',
      'acquired',
      'converting',
      'converted',
      'chunking',
      'analyzing',
      'verifying',
      'publishing',
      'completed',
      'duplicate',
      'rejected',
      'failed'
    )
  ),
  discovered_by text NOT NULL,
  content_hash text CHECK (
    content_hash IS NULL OR content_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  failure_code text,
  failure_message text,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (canonical_url)
);
CREATE UNIQUE INDEX source_candidates_content_hash_idx
  ON source_candidates (content_hash)
  WHERE content_hash IS NOT NULL;
CREATE INDEX source_candidates_status_idx
  ON source_candidates (status, updated_at);

CREATE TABLE source_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_candidate_id uuid NOT NULL UNIQUE REFERENCES source_candidates(id),
  media_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 104857600),
  content_hash text NOT NULL UNIQUE CHECK (
    content_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  storage_path text NOT NULL,
  extracted_text_path text,
  page_count integer CHECK (page_count IS NULL OR page_count > 0),
  status text NOT NULL DEFAULT 'downloaded' CHECK (
    status IN ('downloaded', 'converted', 'chunked', 'purged', 'failed')
  ),
  acquired_at timestamptz NOT NULL DEFAULT now(),
  converted_at timestamptz,
  purge_after timestamptz NOT NULL DEFAULT now() + interval '30 days',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX source_artifacts_purge_idx
  ON source_artifacts (purge_after)
  WHERE status <> 'purged';

CREATE TABLE source_fragments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_artifact_id uuid NOT NULL REFERENCES source_artifacts(id),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  section_title text,
  source_locator text,
  content text NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 32768),
  content_hash text NOT NULL CHECK (
    content_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  status text NOT NULL DEFAULT 'queued' CHECK (
    status IN (
      'queued',
      'analyzing',
      'analyzed',
      'verified',
      'published',
      'rejected',
      'failed'
    )
  ),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_artifact_id, ordinal),
  UNIQUE (source_artifact_id, content_hash)
);
CREATE INDEX source_fragments_queue_idx
  ON source_fragments (source_artifact_id, status, ordinal);

CREATE TABLE pipeline_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT true,
  ai_model text NOT NULL DEFAULT 'gpt-5.6-luna',
  reasoning_effort text NOT NULL DEFAULT 'low' CHECK (
    reasoning_effort IN ('minimal', 'low', 'medium', 'high')
  ),
  max_concurrent_ai_runs smallint NOT NULL DEFAULT 1 CHECK (
    max_concurrent_ai_runs BETWEEN 1 AND 4
  ),
  active_source_id uuid REFERENCES source_candidates(id),
  paused_reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT 'migration'
);
INSERT INTO pipeline_settings (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE pipeline_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type text NOT NULL CHECK (
    task_type IN (
      'expert_research',
      'source_discovery',
      'source_acquisition',
      'source_conversion',
      'source_chunking',
      'fragment_analysis',
      'candidate_verification',
      'source_publication',
      'source_refresh'
    )
  ),
  stage text NOT NULL CHECK (
    stage IN (
      'discover',
      'acquire',
      'convert',
      'chunk',
      'analyze',
      'verify',
      'publish'
    )
  ),
  status text NOT NULL DEFAULT 'queued' CHECK (
    status IN (
      'queued',
      'claimed',
      'running',
      'completed',
      'failed',
      'cancelled',
      'skipped'
    )
  ),
  priority smallint NOT NULL DEFAULT 0 CHECK (priority BETWEEN -100 AND 100),
  coverage_target_id uuid REFERENCES coverage_targets(id),
  source_candidate_id uuid REFERENCES source_candidates(id),
  expert_task_id uuid REFERENCES expert_tasks(id),
  dedupe_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  claim_owner text,
  lease_token_hash bytea,
  lease_until timestamptz,
  heartbeat_at timestamptz,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
  failure_code text,
  failure_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (jsonb_typeof(payload) = 'object'),
  CHECK (result IS NULL OR jsonb_typeof(result) = 'object')
);
CREATE UNIQUE INDEX pipeline_tasks_active_dedupe_idx
  ON pipeline_tasks (dedupe_key)
  WHERE status IN ('queued', 'claimed', 'running');
CREATE INDEX pipeline_tasks_claim_idx
  ON pipeline_tasks (priority DESC, created_at)
  WHERE status = 'queued';
CREATE INDEX pipeline_tasks_lease_idx
  ON pipeline_tasks (lease_until)
  WHERE status IN ('claimed', 'running');

ALTER TABLE source_candidates
  ADD COLUMN discovery_pipeline_task_id uuid REFERENCES pipeline_tasks(id);

CREATE TABLE pipeline_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pipeline_task_id uuid REFERENCES pipeline_tasks(id) ON DELETE CASCADE,
  source_candidate_id uuid REFERENCES source_candidates(id),
  stage text NOT NULL CHECK (
    stage IN (
      'discover',
      'acquire',
      'convert',
      'chunk',
      'analyze',
      'verify',
      'publish',
      'system'
    )
  ),
  event_type text NOT NULL CHECK (
    event_type IN (
      'queued',
      'claimed',
      'started',
      'progress',
      'completed',
      'failed',
      'retried',
      'paused',
      'resumed',
      'skipped'
    )
  ),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 1000),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX pipeline_events_recent_idx
  ON pipeline_events (created_at DESC, id DESC);
CREATE INDEX pipeline_events_task_idx
  ON pipeline_events (pipeline_task_id, created_at, id);

CREATE TABLE knowledge_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_task_id uuid NOT NULL REFERENCES pipeline_tasks(id),
  source_fragment_id uuid REFERENCES source_fragments(id),
  stable_key text NOT NULL CHECK (
    stable_key ~ '^[a-z0-9][a-z0-9._-]{2,159}$'
  ),
  payload jsonb NOT NULL,
  content_hash text NOT NULL UNIQUE CHECK (
    content_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  status text NOT NULL DEFAULT 'analyzed' CHECK (
    status IN (
      'analyzed',
      'verified',
      'rejected',
      'conflict',
      'manual_review',
      'published'
    )
  ),
  dangerous boolean NOT NULL,
  confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  quality_score numeric(4,3) NOT NULL CHECK (quality_score BETWEEN 0 AND 1),
  revision_id uuid REFERENCES knowledge_revisions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(payload) = 'object')
);
CREATE INDEX knowledge_candidates_status_idx
  ON knowledge_candidates (status, dangerous, created_at);

CREATE TABLE candidate_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_candidate_id uuid NOT NULL REFERENCES knowledge_candidates(id),
  pipeline_task_id uuid NOT NULL REFERENCES pipeline_tasks(id),
  decision text NOT NULL CHECK (
    decision IN ('verified', 'rejected', 'conflict', 'manual_review')
  ),
  confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  quality_score numeric(4,3) NOT NULL CHECK (quality_score BETWEEN 0 AND 1),
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  verified_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(findings) = 'array')
);
CREATE INDEX candidate_verifications_candidate_idx
  ON candidate_verifications (knowledge_candidate_id, created_at DESC);

CREATE TABLE agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_task_id uuid REFERENCES pipeline_tasks(id),
  model text NOT NULL,
  reasoning_effort text NOT NULL,
  status text NOT NULL CHECK (
    status IN ('running', 'completed', 'failed', 'timed_out', 'cancelled')
  ),
  input_tokens bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  cached_input_tokens bigint NOT NULL DEFAULT 0 CHECK (
    cached_input_tokens >= 0
  ),
  output_tokens bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  reasoning_output_tokens bigint NOT NULL DEFAULT 0 CHECK (
    reasoning_output_tokens >= 0
  ),
  published_revisions integer NOT NULL DEFAULT 0 CHECK (
    published_revisions >= 0
  ),
  duration_ms bigint CHECK (duration_ms IS NULL OR duration_ms >= 0),
  error_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX agent_runs_recent_idx ON agent_runs (started_at DESC);

CREATE TABLE legacy_revision_metadata (
  revision_id uuid PRIMARY KEY REFERENCES knowledge_revisions(id)
    ON DELETE RESTRICT,
  legacy_key text NOT NULL UNIQUE,
  legacy_item_type text NOT NULL,
  source_trust text NOT NULL,
  lifecycle_status text NOT NULL,
  original_risk_level text NOT NULL,
  original_confidence numeric(8,6) NOT NULL CHECK (
    original_confidence BETWEEN 0 AND 1
  ),
  original_quality_score numeric(8,4),
  published_at timestamptz NOT NULL,
  provenance jsonb,
  payload_hash text NOT NULL CHECK (
    payload_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id text NOT NULL,
  actor_role text NOT NULL CHECK (actor_role IN ('admin', 'super_admin')),
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX admin_audit_events_recent_idx
  ON admin_audit_events (created_at DESC, id DESC);

INSERT INTO coverage_targets (
  vendor_slug,
  product_family,
  model,
  operating_system_slug,
  version_branch,
  document_role,
  priority
)
VALUES
  ('cisco', 'Catalyst 9000', 'Catalyst 9300', 'ios-xe', '17.15', 'commands', 100),
  ('cisco', 'Catalyst 9000', 'Catalyst 9300', 'ios-xe', '17.15', 'configuration', 98),
  ('cisco', 'Catalyst 9000', 'Catalyst 9300', 'ios-xe', '17.15', 'diagnostics', 96),
  ('cisco', 'Catalyst 9000', 'Catalyst 9300', 'ios-xe', '17.15', 'upgrades', 94),
  ('cisco', 'Nexus', NULL, 'nx-os', NULL, 'commands', 90),
  ('cisco', 'ASA', NULL, 'asa', NULL, 'commands', 88),
  ('cisco', 'IOS XR', NULL, 'ios-xr', NULL, 'commands', 86),
  ('dell', 'PowerSwitch', NULL, 'os10', NULL, 'commands', 82),
  ('dell', 'PowerSwitch', NULL, 'os9', NULL, 'commands', 80),
  ('arista', 'Switching', NULL, 'eos', NULL, 'commands', 78),
  ('juniper', 'Networking', NULL, 'junos', NULL, 'commands', 76),
  ('fortinet', 'FortiGate', NULL, 'fortios', NULL, 'commands', 72),
  ('sonic', 'SONiC', NULL, 'sonic', NULL, 'commands', 68),
  ('nokia', 'Service Router', NULL, 'sros', NULL, 'commands', 64),
  ('fs', 'Networking', NULL, 'fsos', NULL, 'commands', 60),
  ('lantronix', 'Console Managers', NULL, 'slc-os', NULL, 'commands', 56)
ON CONFLICT (
  vendor_slug,
  product_family,
  model,
  operating_system_slug,
  version_branch,
  document_role
) DO NOTHING;

DROP VIEW public_active_knowledge;

CREATE VIEW public_active_knowledge AS
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
  coalesce(kpt.validation_level, 'documentation_reviewed') AS validation_level,
  coalesce(kpt.independent_confirmations, 1) AS independent_confirmations,
  coalesce(
    kpt.confidence_explanation,
    'Verified structured knowledge with bounded applicability.'
  ) AS confidence_explanation,
  coalesce(kpt.next_review_at, kr.last_verified_at + 180) AS next_review_at,
  kpt.lab_validated_at
FROM active_release ar
JOIN release_items ri ON ri.release_id = ar.release_id
JOIN knowledge_items ki ON ki.id = ri.knowledge_item_id
JOIN knowledge_revisions kr ON kr.id = ri.revision_id
JOIN vendors v ON v.id = kr.vendor_id
LEFT JOIN platforms p ON p.id = kr.platform_id
LEFT JOIN operating_systems os ON os.id = kr.operating_system_id
LEFT JOIN knowledge_public_trust kpt ON kpt.revision_id = kr.id;

COMMIT;
