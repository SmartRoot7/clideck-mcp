BEGIN;

-- The first deterministic command-reference extractor was intentionally
-- conservative and only ran while a source was initially chunked. Re-run the
-- improved extractor over immutable fragments so commands missed in already
-- processed official manuals can enter the streaming publication path. The
-- task does not reset fragment or source state and therefore cannot withdraw
-- or invalidate an existing release.
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
  'source:' || source.id::text || ':deterministic-command-backfill:v2',
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
