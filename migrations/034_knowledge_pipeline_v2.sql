BEGIN;

-- Pipeline 2.0 keeps the original source rows as stable identities while
-- moving mutable processing state into immutable, versioned runs.
ALTER TABLE source_candidates
  ALTER COLUMN coverage_target_id DROP NOT NULL,
  ALTER COLUMN canonical_url DROP NOT NULL,
  ADD COLUMN source_kind text NOT NULL DEFAULT 'official_web' CHECK (
    source_kind IN (
      'official_web', 'admin_web', 'admin_document', 'pasted_text',
      'field_log'
    )
  ),
  ADD COLUMN source_ref text,
  ADD COLUMN display_locator text,
  ADD COLUMN declared_vendor text,
  ADD COLUMN declared_operating_system text,
  ADD COLUMN declared_model text;

UPDATE source_candidates
SET source_ref = 'src_' || replace(id::text, '-', ''),
    display_locator = coalesce(canonical_url, title)
WHERE source_ref IS NULL OR display_locator IS NULL;

ALTER TABLE source_candidates
  ALTER COLUMN source_ref SET DEFAULT (
    'src_' || replace(gen_random_uuid()::text, '-', '')
  ),
  ALTER COLUMN source_ref SET NOT NULL,
  ALTER COLUMN display_locator SET DEFAULT 'Unspecified source',
  ALTER COLUMN display_locator SET NOT NULL,
  ADD CONSTRAINT source_candidates_source_ref_key UNIQUE (source_ref),
  ADD CONSTRAINT source_candidates_source_ref_check CHECK (
    source_ref ~ '^src_[a-z0-9_-]{12,96}$'
  );

ALTER TABLE source_artifacts
  DROP CONSTRAINT IF EXISTS source_artifacts_source_candidate_id_key,
  DROP CONSTRAINT IF EXISTS source_artifacts_content_hash_key,
  ALTER COLUMN purge_after DROP NOT NULL;

UPDATE source_artifacts
SET purge_after = NULL
WHERE status <> 'purged';

CREATE UNIQUE INDEX source_artifacts_source_content_idx
  ON source_artifacts (source_candidate_id, content_hash);
CREATE INDEX source_artifacts_content_lookup_idx
  ON source_artifacts (content_hash, acquired_at DESC);

CREATE TABLE source_processing_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_candidate_id uuid NOT NULL REFERENCES source_candidates(id)
    ON DELETE RESTRICT,
  source_artifact_id uuid REFERENCES source_artifacts(id) ON DELETE RESTRICT,
  processing_version text NOT NULL CHECK (
    processing_version ~ '^[a-z0-9][a-z0-9._-]{1,63}$'
  ),
  converter_version text NOT NULL DEFAULT 'legacy-v1',
  segmenter_version text NOT NULL DEFAULT 'legacy-v1',
  extractor_version text NOT NULL DEFAULT 'legacy-v1',
  prompt_version text NOT NULL DEFAULT 'legacy-v1',
  model_profile text NOT NULL DEFAULT 'legacy-v1',
  status text NOT NULL DEFAULT 'queued' CHECK (
    status IN (
      'queued', 'acquiring', 'converting', 'segmenting', 'extracting',
      'auditing', 'repairing', 'reconciling', 'normalizing', 'publishing',
      'completed', 'completed_with_repairs', 'paused', 'cancelled',
      'failed', 'unavailable'
    )
  ),
  page_count integer CHECK (page_count IS NULL OR page_count > 0),
  next_page integer NOT NULL DEFAULT 1 CHECK (next_page > 0),
  converted_output_path text,
  counters jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(counters) = 'object'
  ),
  failure_code text,
  failure_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_candidate_id, processing_version)
);
CREATE INDEX source_processing_runs_queue_idx
  ON source_processing_runs (status, created_at);
CREATE INDEX source_processing_runs_artifact_idx
  ON source_processing_runs (source_artifact_id, created_at DESC);

INSERT INTO source_processing_runs (
  source_candidate_id,
  source_artifact_id,
  processing_version,
  status,
  page_count,
  converted_output_path,
  started_at,
  completed_at,
  created_at,
  updated_at
)
SELECT
  source.id,
  artifact.id,
  'legacy-' || replace(source.id::text, '-', ''),
  CASE
    WHEN source.status IN ('completed', 'completed_with_exceptions', 'duplicate')
      THEN 'completed'
    WHEN source.status IN ('failed', 'rejected') THEN 'failed'
    WHEN source.status IN ('verifying', 'publishing') THEN 'auditing'
    WHEN source.status IN ('prepared', 'analyzing') THEN 'extracting'
    WHEN source.status IN ('chunking', 'converted') THEN 'segmenting'
    WHEN source.status IN ('converting', 'acquired') THEN 'converting'
    WHEN source.status IN ('acquiring', 'approved') THEN 'acquiring'
    ELSE 'queued'
  END,
  artifact.page_count,
  artifact.extracted_text_path,
  coalesce(artifact.acquired_at, source.discovered_at),
  source.completed_at,
  source.discovered_at,
  source.updated_at
FROM source_candidates source
LEFT JOIN LATERAL (
  SELECT current_artifact.*
  FROM source_artifacts current_artifact
  WHERE current_artifact.source_candidate_id = source.id
  ORDER BY current_artifact.acquired_at DESC, current_artifact.id
  LIMIT 1
) artifact ON true
ON CONFLICT (source_candidate_id, processing_version) DO NOTHING;

ALTER TABLE pipeline_tasks
  ADD COLUMN processing_run_id uuid REFERENCES source_processing_runs(id)
    ON DELETE SET NULL;
CREATE INDEX pipeline_tasks_processing_run_idx
  ON pipeline_tasks (processing_run_id, status, created_at);

UPDATE pipeline_tasks task
SET processing_run_id = run.id
FROM source_processing_runs run
WHERE task.source_candidate_id = run.source_candidate_id
  AND task.processing_run_id IS NULL
  AND run.processing_version =
    'legacy-' || replace(run.source_candidate_id::text, '-', '');

ALTER TABLE source_fragments
  DROP CONSTRAINT IF EXISTS source_fragments_source_artifact_id_ordinal_key,
  DROP CONSTRAINT IF EXISTS source_fragments_source_artifact_id_content_hash_key,
  ADD COLUMN processing_run_id uuid REFERENCES source_processing_runs(id)
    ON DELETE RESTRICT,
  ADD COLUMN disposition text CHECK (
    disposition IS NULL OR disposition IN (
      'knowledge_extracted', 'non_knowledge', 'continuation_required',
      'targeted_retry'
    )
  ),
  ADD COLUMN disposition_reason text CHECK (
    disposition_reason IS NULL OR disposition_reason IN (
      'navigation_or_toc', 'legal_or_copyright', 'part_inventory',
      'physical_installation', 'general_safety', 'other_non_operational',
      'knowledge_extracted', 'boundary_continuation', 'targeted_retry'
    )
  ),
  ADD COLUMN disposition_detail text,
  ADD COLUMN evidence_span_ids text[] NOT NULL DEFAULT '{}';

UPDATE source_fragments fragment
SET processing_run_id = run.id
FROM source_processing_runs run
WHERE run.source_artifact_id = fragment.source_artifact_id
  AND fragment.processing_run_id IS NULL;

-- Keep this nullable during the dual-write release. New pipeline paths always
-- bind fragments to a run, while legacy writers can continue until the
-- compatibility window closes in a later migration.
CREATE UNIQUE INDEX source_fragments_run_ordinal_idx
  ON source_fragments (processing_run_id, ordinal);
CREATE UNIQUE INDEX source_fragments_run_content_idx
  ON source_fragments (processing_run_id, content_hash);
CREATE INDEX source_fragments_open_disposition_idx
  ON source_fragments (processing_run_id, ordinal)
  WHERE disposition IN ('continuation_required', 'targeted_retry')
     OR disposition IS NULL;

ALTER TABLE knowledge_candidates
  ADD COLUMN processing_run_id uuid REFERENCES source_processing_runs(id)
    ON DELETE SET NULL,
  ADD COLUMN fidelity_status text NOT NULL DEFAULT 'pending' CHECK (
    fidelity_status IN (
      'pending', 'checking', 'passed', 'sampled_out', 'repair', 'excluded',
      'unavailable'
    )
  ),
  ADD COLUMN fidelity_task_id uuid REFERENCES pipeline_tasks(id)
    ON DELETE SET NULL,
  ADD COLUMN fidelity_checked_at timestamptz,
  ADD COLUMN exclusion_status text CHECK (
    exclusion_status IS NULL OR exclusion_status IN (
      'unsupported', 'hallucinated', 'non_knowledge', 'superseded',
      'operator_excluded'
    )
  ),
  ADD COLUMN excluded_at timestamptz,
  ADD COLUMN excluded_by text;

UPDATE knowledge_candidates candidate
SET processing_run_id = fragment.processing_run_id
FROM source_fragments fragment
WHERE candidate.source_fragment_id = fragment.id
  AND candidate.processing_run_id IS NULL;

CREATE INDEX knowledge_candidates_processing_run_idx
  ON knowledge_candidates (processing_run_id, status, created_at);
CREATE INDEX knowledge_candidates_fidelity_pending_idx
  ON knowledge_candidates (processing_run_id, created_at)
  WHERE fidelity_status = 'pending' AND fidelity_task_id IS NULL;

UPDATE knowledge_candidates
SET fidelity_status = 'unavailable'
WHERE status = 'published';

CREATE TABLE knowledge_candidate_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_candidate_id uuid NOT NULL REFERENCES knowledge_candidates(id)
    ON DELETE RESTRICT,
  processing_run_id uuid NOT NULL REFERENCES source_processing_runs(id)
    ON DELETE RESTRICT,
  source_fragment_id uuid REFERENCES source_fragments(id) ON DELETE RESTRICT,
  occurrence_kind text NOT NULL CHECK (
    occurrence_kind IN ('created', 'exact_duplicate', 'semantic_match')
  ),
  content_hash text NOT NULL CHECK (
    content_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (knowledge_candidate_id, processing_run_id, source_fragment_id)
);
CREATE INDEX knowledge_candidate_occurrences_run_idx
  ON knowledge_candidate_occurrences (processing_run_id, created_at);

INSERT INTO knowledge_candidate_occurrences (
  knowledge_candidate_id,
  processing_run_id,
  source_fragment_id,
  occurrence_kind,
  content_hash
)
SELECT id, processing_run_id, source_fragment_id, 'created', content_hash
FROM knowledge_candidates
WHERE processing_run_id IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE TABLE pipeline_quality_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage text NOT NULL CHECK (
    stage IN ('convert', 'segment', 'extract_fidelity', 'normalize_deduplicate')
  ),
  profile_key text NOT NULL,
  converter_version text,
  layout_profile text,
  extractor_version text,
  prompt_version text,
  model text,
  checked_count bigint NOT NULL DEFAULT 0 CHECK (checked_count >= 0),
  material_error_count bigint NOT NULL DEFAULT 0 CHECK (
    material_error_count >= 0
  ),
  sample_percent smallint NOT NULL DEFAULT 100 CHECK (
    sample_percent BETWEEN 1 AND 100
  ),
  forced_full_batches_remaining smallint NOT NULL DEFAULT 0 CHECK (
    forced_full_batches_remaining BETWEEN 0 AND 20
  ),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stage, profile_key)
);

CREATE TABLE pipeline_quality_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES pipeline_quality_profiles(id)
    ON DELETE RESTRICT,
  processing_run_id uuid REFERENCES source_processing_runs(id)
    ON DELETE SET NULL,
  pipeline_task_id uuid REFERENCES pipeline_tasks(id) ON DELETE SET NULL,
  stage text NOT NULL CHECK (
    stage IN ('convert', 'segment', 'extract_fidelity', 'normalize_deduplicate')
  ),
  status text NOT NULL CHECK (
    status IN ('passed', 'repair', 'excluded', 'unavailable')
  ),
  error_categories text[] NOT NULL DEFAULT '{}',
  material_error boolean NOT NULL DEFAULT false,
  coverage_count integer NOT NULL DEFAULT 0 CHECK (coverage_count >= 0),
  input_tokens bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  model text,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(findings) = 'array'
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pipeline_quality_checks_recent_idx
  ON pipeline_quality_checks (created_at DESC, stage, status);
CREATE INDEX pipeline_quality_checks_run_idx
  ON pipeline_quality_checks (processing_run_id, created_at);

ALTER TABLE candidate_verifications
  DROP CONSTRAINT IF EXISTS candidate_verifications_review_type_check;
ALTER TABLE candidate_verifications
  ADD CONSTRAINT candidate_verifications_review_type_check CHECK (
    review_type IN (
      'standard', 'fidelity', 'deep_low', 'deep_medium', 'human'
    )
  );

CREATE TABLE intake_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL CHECK (
    job_type IN ('website', 'paste_text', 'files', 'logs', 'reprocess')
  ),
  status text NOT NULL DEFAULT 'queued' CHECK (
    status IN (
      'queued', 'running', 'paused', 'completed', 'completed_with_errors',
      'cancelled', 'failed'
    )
  ),
  created_by text NOT NULL,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(configuration) = 'object'
  ),
  counters jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(counters) = 'object'
  ),
  failure_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX intake_jobs_single_global_reprocess_idx
  ON intake_jobs ((job_type))
  WHERE job_type = 'reprocess'
    AND status IN ('queued', 'running', 'paused');

CREATE TABLE intake_job_sources (
  intake_job_id uuid NOT NULL REFERENCES intake_jobs(id) ON DELETE RESTRICT,
  source_candidate_id uuid NOT NULL REFERENCES source_candidates(id)
    ON DELETE RESTRICT,
  processing_version text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (
    status IN (
      'queued', 'running', 'completed', 'unavailable', 'legacy_only',
      'cancelled', 'failed'
    )
  ),
  result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(result) = 'object'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (intake_job_id, source_candidate_id),
  UNIQUE (source_candidate_id, processing_version)
);

CREATE TABLE source_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_job_id uuid NOT NULL REFERENCES intake_jobs(id) ON DELETE RESTRICT,
  upload_ref text NOT NULL UNIQUE,
  original_name text NOT NULL CHECK (char_length(original_name) BETWEEN 1 AND 500),
  media_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 104857600),
  original_content_hash text NOT NULL CHECK (
    original_content_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  sanitized_content_hash text CHECK (
    sanitized_content_hash IS NULL OR
    sanitized_content_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  staging_path text,
  status text NOT NULL DEFAULT 'staged' CHECK (
    status IN ('staged', 'sanitizing', 'accepted', 'rejected', 'failed')
  ),
  failure_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE source_collections
  ALTER COLUMN coverage_target_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS source_collections_crawl_depth_check,
  DROP CONSTRAINT IF EXISTS source_collections_link_limit_check,
  ALTER COLUMN crawl_depth SET DEFAULT 100,
  ALTER COLUMN link_limit TYPE integer,
  ALTER COLUMN link_limit SET DEFAULT 5000,
  ADD CONSTRAINT source_collections_crawl_depth_check CHECK (
    crawl_depth BETWEEN 0 AND 100
  ),
  ADD CONSTRAINT source_collections_link_limit_check CHECK (
    link_limit BETWEEN 1 AND 50000
  ),
  ADD COLUMN path_prefix text NOT NULL DEFAULT '/',
  ADD COLUMN intake_job_id uuid REFERENCES intake_jobs(id) ON DELETE SET NULL,
  ADD COLUMN pages_seen integer NOT NULL DEFAULT 0 CHECK (pages_seen >= 0),
  ADD COLUMN pages_accepted integer NOT NULL DEFAULT 0 CHECK (pages_accepted >= 0),
  ADD COLUMN checkpoint_at timestamptz;

CREATE TABLE source_collection_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_collection_id uuid NOT NULL REFERENCES source_collections(id)
    ON DELETE CASCADE,
  requested_url text NOT NULL,
  canonical_url text,
  depth integer NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'queued' CHECK (
    status IN (
      'queued', 'fetching', 'accepted', 'duplicate', 'out_of_scope',
      'unsafe', 'temporary_failure', 'permanent_failure'
    )
  ),
  http_status smallint,
  media_type text,
  content_hash text CHECK (
    content_hash IS NULL OR content_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
  available_at timestamptz NOT NULL DEFAULT now(),
  failure_message text,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_collection_id, requested_url)
);
CREATE INDEX source_collection_pages_frontier_idx
  ON source_collection_pages (
    source_collection_id, status, available_at, depth, discovered_at
  );
CREATE INDEX source_collection_pages_hash_idx
  ON source_collection_pages (source_collection_id, content_hash)
  WHERE content_hash IS NOT NULL;

ALTER TABLE pipeline_settings
  DROP CONSTRAINT IF EXISTS pipeline_settings_max_concurrent_ai_runs_check,
  DROP CONSTRAINT IF EXISTS pipeline_settings_max_deep_review_runs_check;

UPDATE pipeline_settings
SET max_deep_review_runs = least(max_deep_review_runs, 2),
    updated_at = now(),
    updated_by = '034_knowledge_pipeline_v2'
WHERE singleton;

ALTER TABLE pipeline_settings
  ADD CONSTRAINT pipeline_settings_max_concurrent_ai_runs_check CHECK (
    max_concurrent_ai_runs BETWEEN 1 AND 8
  ),
  ADD CONSTRAINT pipeline_settings_max_deep_review_runs_check CHECK (
    max_deep_review_runs BETWEEN 1 AND 2
  );

ALTER TABLE knowledge_revisions
  DROP CONSTRAINT IF EXISTS knowledge_revisions_network_vendor_check;
ALTER TABLE source_documents
  DROP CONSTRAINT IF EXISTS source_documents_network_vendor_check,
  ADD COLUMN source_ref text,
  ADD COLUMN source_kind text CHECK (
    source_kind IS NULL OR source_kind IN (
      'official_web', 'admin_web', 'admin_document', 'pasted_text',
      'field_log'
    )
  );

ALTER TABLE release_changes
  ALTER COLUMN new_revision_id DROP NOT NULL,
  ADD COLUMN change_kind text NOT NULL DEFAULT 'upsert' CHECK (
    change_kind IN ('upsert', 'deactivate')
  ),
  ADD CONSTRAINT release_changes_shape_check CHECK (
    (change_kind = 'upsert' AND new_revision_id IS NOT NULL)
    OR (
      change_kind = 'deactivate'
      AND new_revision_id IS NULL
      AND previous_revision_id IS NOT NULL
    )
  );

ALTER TABLE release_changes
  DROP CONSTRAINT IF EXISTS release_changes_release_id_new_revision_id_key;
CREATE UNIQUE INDEX release_changes_release_new_revision_idx
  ON release_changes (release_id, new_revision_id)
  WHERE new_revision_id IS NOT NULL;

-- Existing network rows remain visible when future knowledge has incomplete
-- context. Unknown context is represented by NULL, never catalog placeholders.
CREATE OR REPLACE VIEW public_active_knowledge AS
SELECT
  kr.id AS revision_id,
  ki.stable_key,
  ki.kind,
  kr.created_by AS origin,
  kr.risk_level,
  v.slug AS vendor_slug,
  coalesce(v.display_name, 'Not specified') AS vendor_name,
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
      WHEN kpt.validation_level IN ('batfish_modeled', 'runtime_lab_validated')
        THEN 'documentation_reviewed'
      ELSE kpt.validation_level
    END,
    'documentation_reviewed'
  ) AS validation_level,
  coalesce(kpt.independent_confirmations, 1) AS independent_confirmations,
  coalesce(
    kpt.confidence_explanation,
    'Source-backed structured knowledge with explicit provenance.'
  ) AS confidence_explanation,
  coalesce(kpt.next_review_at, kr.last_verified_at + 180) AS next_review_at,
  current_validation.lab_validated_at
FROM active_knowledge_state active
JOIN knowledge_items ki ON ki.id = active.knowledge_item_id
JOIN knowledge_revisions kr ON kr.id = active.revision_id
LEFT JOIN vendors v ON v.id = kr.vendor_id
LEFT JOIN platforms p ON p.id = kr.platform_id
LEFT JOIN operating_systems os ON os.id = kr.operating_system_id
LEFT JOIN knowledge_public_trust kpt ON kpt.revision_id = kr.id
LEFT JOIN LATERAL current_knowledge_validation(kr.id)
  current_validation ON true
WHERE ki.domain_id = 'network'
  AND kr.domain_id = 'network';

GRANT SELECT ON
  source_processing_runs,
  knowledge_candidate_occurrences,
  pipeline_quality_profiles,
  pipeline_quality_checks,
  intake_jobs,
  intake_job_sources,
  source_uploads,
  source_collection_pages
TO clideck_mcp_admin, clideck_mcp_backup;

GRANT SELECT, INSERT, UPDATE ON
  source_processing_runs,
  knowledge_candidate_occurrences,
  pipeline_quality_profiles,
  pipeline_quality_checks,
  intake_jobs,
  intake_job_sources,
  source_uploads,
  source_collection_pages
TO clideck_mcp_worker;

GRANT SELECT, INSERT, UPDATE ON
  source_processing_runs,
  knowledge_candidate_occurrences,
  pipeline_quality_profiles,
  pipeline_quality_checks
TO clideck_mcp_researcher;

GRANT INSERT, UPDATE ON
  intake_jobs,
  intake_job_sources,
  source_uploads,
  source_collection_pages,
  source_processing_runs
TO clideck_mcp_admin;

GRANT SELECT ON source_candidates, source_artifacts TO clideck_mcp_api;

COMMIT;
