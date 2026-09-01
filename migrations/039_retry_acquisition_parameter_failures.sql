BEGIN;

-- Release cdde88c downloaded these sources successfully, then failed while
-- attaching the new processing-run UUID to the task payload because one SQL
-- parameter was inferred as both uuid and text. Return only that exact bounded
-- failure to normal acquisition; the terminal task remains as audit history.
UPDATE source_candidates
SET status = 'approved',
    failure_code = NULL,
    failure_message = NULL,
    completed_at = NULL,
    updated_at = now()
WHERE status = 'failed'
  AND failure_code = 'PIPELINE_MECHANICAL_FAILURE'
  AND failure_message LIKE
    '%inconsistent types deduced for parameter $2%';

COMMIT;
