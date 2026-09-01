BEGIN;

-- These downloads reached the existing global content-identity constraint
-- before acquisition learned to classify identical bytes as a normal
-- duplicate. Retry only that exact bounded failure under the corrected path.
UPDATE source_candidates
SET status = 'approved',
    failure_code = NULL,
    failure_message = NULL,
    completed_at = NULL,
    updated_at = now()
WHERE status = 'failed'
  AND failure_code = 'PIPELINE_MECHANICAL_FAILURE'
  AND failure_message LIKE
    '%duplicate key value violates unique constraint "source_candidates_content_hash_idx"%';

COMMIT;
