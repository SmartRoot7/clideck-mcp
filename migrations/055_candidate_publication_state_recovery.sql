BEGIN;

-- A candidate-publication retry reset this extracting source to approved,
-- scheduling a redundant acquisition whose HTTP 403 terminated the saved run.
-- Restore only this confirmed incident's untouched spans in a new version;
-- preserve the failed history, attempted spans and published revisions.
WITH affected AS (
  SELECT run.*
    FROM source_processing_runs run
    JOIN source_candidates source ON source.id=run.source_candidate_id
   WHERE run.id='3960f37e-c7c8-4359-9b5b-686427799c14'
     AND run.processing_version LIKE 'fragment-repair-054-%'
     AND run.status='failed' AND run.failure_code='SOURCE_HTTP_403'
     AND EXISTS (SELECT 1 FROM source_artifacts artifact
       WHERE artifact.id=run.source_artifact_id AND artifact.status='chunked')
     AND source.status<>'rejected'
     AND NOT EXISTS (
       SELECT 1 FROM source_processing_runs newer
        WHERE newer.source_candidate_id=run.source_candidate_id
          AND newer.created_at>run.created_at
     )
     AND EXISTS (
       SELECT 1 FROM source_fragments fragment
        WHERE fragment.processing_run_id=run.id
          AND fragment.status='failed' AND fragment.attempts=0
          AND fragment.disposition IS NULL
          AND fragment.updated_at=run.completed_at
     )
), recovery AS (
  INSERT INTO source_processing_runs (
    source_candidate_id,source_artifact_id,processing_version,status,
    converter_version,segmenter_version,extractor_version,prompt_version,
    model_profile,counters,started_at
  )
  SELECT source_candidate_id,source_artifact_id,
    'publication-repair-055-'||id::text,'extracting',
    converter_version,segmenter_version,extractor_version,prompt_version,
    model_profile,jsonb_build_object('repair_of_processing_run',id,
      'repair_reason','unattempted_fragments_failed_after_publication_reset'),now()
  FROM affected
  ON CONFLICT (source_candidate_id,processing_version) DO NOTHING
  RETURNING id,source_candidate_id,counters
), restored AS (
  INSERT INTO source_fragments (
    source_artifact_id,processing_run_id,ordinal,section_title,content,
    content_hash,source_locator,evidence_span_ids,status,attempts
  )
  SELECT fragment.source_artifact_id,recovery.id,fragment.ordinal,
    fragment.section_title,fragment.content,fragment.content_hash,
    fragment.source_locator,fragment.evidence_span_ids,'queued',0
  FROM recovery JOIN affected
    ON affected.id=(recovery.counters->>'repair_of_processing_run')::uuid
  JOIN source_fragments fragment ON fragment.processing_run_id=affected.id
  WHERE fragment.status='failed' AND fragment.attempts=0
    AND fragment.disposition IS NULL
    AND fragment.updated_at=affected.completed_at
  RETURNING processing_run_id
)
UPDATE source_candidates source
   SET status='prepared',completed_at=NULL,failure_code=NULL,
       failure_message=NULL,updated_at=now()
  FROM recovery
 WHERE source.id=recovery.source_candidate_id
   AND EXISTS (SELECT 1 FROM restored WHERE processing_run_id=recovery.id);

COMMIT;
