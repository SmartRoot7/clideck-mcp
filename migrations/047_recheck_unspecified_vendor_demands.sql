BEGIN;

-- A replay must not turn the display label for an absent vendor into an
-- explicit catalog vendor. Recheck potentially affected completion metadata;
-- published knowledge revisions remain immutable and unchanged.
UPDATE knowledge_demands
SET status='queued', replay_status=NULL, replayed_at=NULL,
    result_revision_id=NULL, result_release_id=NULL, completed_at=NULL,
    last_error_code=NULL, next_retry_at=now(), last_seen_at=now()
WHERE status='published' AND context->>'vendor_slug'='not-specified'
  AND lower(context->>'vendor') IN ('not specified','not-specified')
  AND context->>'operating_system_slug'<>'not-specified';

COMMIT;
