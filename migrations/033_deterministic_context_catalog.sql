BEGIN;

-- Coverage targets are dynamic, while the original vendor/OS catalog seed was
-- a one-time snapshot. Register only exact scopes backed by acquired HTTPS
-- command references so deterministic publication can resolve them.
INSERT INTO vendors (slug, display_name)
SELECT DISTINCT
  target.vendor_slug,
  initcap(replace(target.vendor_slug, '-', ' '))
FROM coverage_targets target
JOIN source_candidates source
  ON source.coverage_target_id = target.id
JOIN source_artifacts artifact
  ON artifact.source_candidate_id = source.id
WHERE source.canonical_url LIKE 'https://%'
  AND source.document_type ~* '(command|cli)[ _-]?reference'
  AND artifact.status = 'chunked'
  AND artifact.extracted_text_path IS NOT NULL
ON CONFLICT (slug) DO NOTHING;

INSERT INTO operating_systems (
  vendor_id,
  slug,
  display_name,
  version_scheme
)
SELECT DISTINCT
  vendor.id,
  target.operating_system_slug,
  initcap(replace(target.operating_system_slug, '-', ' ')),
  'vendor'
FROM coverage_targets target
JOIN vendors vendor ON vendor.slug = target.vendor_slug
JOIN source_candidates source
  ON source.coverage_target_id = target.id
JOIN source_artifacts artifact
  ON artifact.source_candidate_id = source.id
WHERE source.document_type ~* '(command|cli)[ _-]?reference'
  AND source.canonical_url LIKE 'https://%'
  AND artifact.status = 'chunked'
  AND artifact.extracted_text_path IS NOT NULL
ON CONFLICT (vendor_id, slug) DO NOTHING;

CREATE OR REPLACE FUNCTION ensure_deterministic_coverage_context(
  p_vendor_slug text,
  p_operating_system_slug text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $$
DECLARE
  vendor_id_value uuid;
BEGIN
  IF p_vendor_slug !~ '^[a-z0-9][a-z0-9-]{1,62}$'
     OR p_operating_system_slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' THEN
    RAISE EXCEPTION 'DETERMINISTIC_CONTEXT_SLUG_INVALID';
  END IF;

  INSERT INTO vendors (slug, display_name)
  VALUES (
    p_vendor_slug,
    initcap(replace(p_vendor_slug, '-', ' '))
  )
  ON CONFLICT (slug) DO UPDATE SET slug = excluded.slug
  RETURNING id INTO vendor_id_value;

  INSERT INTO operating_systems (
    vendor_id,
    slug,
    display_name,
    version_scheme
  ) VALUES (
    vendor_id_value,
    p_operating_system_slug,
    initcap(replace(p_operating_system_slug, '-', ' ')),
    'vendor'
  )
  ON CONFLICT (vendor_id, slug) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION ensure_deterministic_coverage_context(text, text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ensure_deterministic_coverage_context(text, text)
TO clideck_mcp_worker;

CREATE TEMP TABLE repaired_context_candidates
ON COMMIT DROP
AS
SELECT candidate.id, candidate.deep_review_task_id
FROM knowledge_candidates candidate
JOIN pipeline_tasks origin ON origin.id = candidate.pipeline_task_id
JOIN source_candidates source
  ON source.id = origin.source_candidate_id
JOIN source_artifacts artifact
  ON artifact.source_candidate_id = source.id
JOIN vendors vendor
  ON vendor.slug = candidate.payload->>'vendor_slug'
JOIN operating_systems operating_system
  ON operating_system.vendor_id = vendor.id
 AND operating_system.slug = candidate.payload->>'operating_system_slug'
WHERE candidate.status = 'deep_review'
  AND candidate.resolution_attempts = 0
  AND candidate.revision_id IS NULL
  AND origin.dedupe_key LIKE
    'source:%:deterministic-command-backfill:v3'
  AND source.canonical_url LIKE 'https://%'
  AND source.document_type ~* '(command|cli)[ _-]?reference'
  AND artifact.status = 'chunked'
  AND artifact.extracted_text_path IS NOT NULL
  AND candidate.resolution_code = 'publication_preflight'
  AND candidate.resolution_reason IN (
    'Publication preflight rejected candidate: CANDIDATE_VENDOR_UNKNOWN',
    'Publication preflight rejected candidate: CANDIDATE_OS_UNKNOWN'
  );

-- A Deep Review batch can contain both affected and unrelated records.  Skip
-- the obsolete batch and release every reservation from it; only candidates
-- with the deterministic context failure are promoted back to Ready.
UPDATE pipeline_tasks task
SET status = 'skipped',
    claim_owner = NULL,
    lease_token_hash = NULL,
    lease_until = NULL,
    heartbeat_at = NULL,
    completed_at = now(),
    failure_code = 'CONTEXT_CATALOG_REPAIRED',
    failure_message =
      'Deterministic vendor/OS scope registered; publication can retry directly.',
    updated_at = now()
WHERE task.status IN ('queued', 'claimed', 'running')
  AND task.id IN (
    SELECT deep_review_task_id
    FROM repaired_context_candidates
    WHERE deep_review_task_id IS NOT NULL
  );

UPDATE knowledge_candidates candidate
SET deep_review_task_id = NULL,
    updated_at = now()
WHERE candidate.deep_review_task_id IN (
  SELECT deep_review_task_id
  FROM repaired_context_candidates
  WHERE deep_review_task_id IS NOT NULL
);

UPDATE knowledge_candidates candidate
SET status = 'verified',
    verification_task_id = NULL,
    deep_review_task_id = NULL,
    publication_task_id = NULL,
    resolution_code = NULL,
    resolution_reason = NULL,
    next_review_at = NULL,
    updated_at = now()
WHERE candidate.id IN (
  SELECT id FROM repaired_context_candidates
);

COMMIT;
