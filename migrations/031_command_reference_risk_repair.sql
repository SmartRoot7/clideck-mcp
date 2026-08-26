BEGIN;

-- Supersede candidates created by the first backfill. Syntax-option
-- descriptions were temporarily passed to the command risk classifier as if
-- they were executable procedure steps, which made safe `show` and `display`
-- records look dangerous. Keep their immutable payloads for audit, remove
-- them from active review queues, and re-run extraction with the corrected
-- classifier.
CREATE TEMP TABLE superseded_command_candidates
ON COMMIT DROP
AS
SELECT
  candidate.id,
  candidate.verification_task_id,
  candidate.deep_review_task_id,
  candidate.publication_task_id
FROM knowledge_candidates candidate
JOIN pipeline_tasks origin ON origin.id = candidate.pipeline_task_id
WHERE origin.dedupe_key LIKE
    'source:%:deterministic-command-backfill:v2'
  AND candidate.status IN (
    'analyzed', 'verified', 'deep_review', 'quarantined'
  )
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(candidate.payload->'procedure') step
    WHERE step LIKE 'Syntax option:%'
  );

UPDATE pipeline_tasks task
SET status = 'skipped',
    claim_owner = NULL,
    lease_token_hash = NULL,
    lease_until = NULL,
    heartbeat_at = NULL,
    completed_at = now(),
    failure_code = 'SUPERSEDED_EXTRACTOR',
    failure_message =
      'Batch superseded by deterministic command-reference backfill v3.',
    updated_at = now()
WHERE task.status IN ('queued', 'claimed', 'running')
  AND task.id IN (
    SELECT verification_task_id
    FROM superseded_command_candidates
    WHERE verification_task_id IS NOT NULL
    UNION
    SELECT deep_review_task_id
    FROM superseded_command_candidates
    WHERE deep_review_task_id IS NOT NULL
    UNION
    SELECT publication_task_id
    FROM superseded_command_candidates
    WHERE publication_task_id IS NOT NULL
  );

UPDATE knowledge_candidates candidate
SET verification_task_id = NULL,
    updated_at = now()
WHERE candidate.verification_task_id IN (
    SELECT verification_task_id
    FROM superseded_command_candidates
    WHERE verification_task_id IS NOT NULL
  );

UPDATE knowledge_candidates candidate
SET deep_review_task_id = NULL,
    updated_at = now()
WHERE candidate.deep_review_task_id IN (
    SELECT deep_review_task_id
    FROM superseded_command_candidates
    WHERE deep_review_task_id IS NOT NULL
  );

UPDATE knowledge_candidates candidate
SET publication_task_id = NULL,
    updated_at = now()
WHERE candidate.publication_task_id IN (
    SELECT publication_task_id
    FROM superseded_command_candidates
    WHERE publication_task_id IS NOT NULL
  );

UPDATE knowledge_candidates candidate
SET status = 'rejected',
    verification_task_id = NULL,
    deep_review_task_id = NULL,
    publication_task_id = NULL,
    resolution_code = 'superseded_extractor',
    resolution_reason =
      'Superseded by deterministic command-reference backfill v3 after syntax-option risk classification repair.',
    updated_at = now()
WHERE candidate.id IN (
  SELECT id FROM superseded_command_candidates
);

INSERT INTO pipeline_tasks (
  task_type,
  stage,
  status,
  priority,
  coverage_target_id,
  source_candidate_id,
  knowledge_demand_id,
  dedupe_key,
  payload
)
SELECT
  'source_chunking',
  'chunk',
  'queued',
  100,
  source.coverage_target_id,
  source.id,
  source.knowledge_demand_id,
  'source:' || source.id::text || ':deterministic-command-backfill:v3',
  jsonb_build_object(
    'source_id', source.id,
    'canonical_url', source.canonical_url,
    'document_type', source.document_type,
    'title', source.title,
    'document_version', source.document_version,
    'document_date', source.document_date,
    'deterministic_backfill', true
  )
FROM source_candidates source
JOIN source_artifacts artifact
  ON artifact.source_candidate_id = source.id
WHERE source.document_type ~* '(command|cli)[ _-]?reference'
  AND artifact.status = 'chunked'
  AND artifact.extracted_text_path IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM source_fragments fragment
    WHERE fragment.source_artifact_id = artifact.id
  );

COMMIT;
