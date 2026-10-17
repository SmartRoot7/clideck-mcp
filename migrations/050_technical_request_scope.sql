BEGIN;
-- The initial technical completion key omitted legacy model/runtime constraints.
-- Re-review completed bindings with the corrected private request scope. Public
-- knowledge revisions and provenance remain immutable and active as evidence.
UPDATE knowledge_demands
SET status='queued',replay_status=NULL,replayed_at=NULL,
    result_revision_id=NULL,result_release_id=NULL,completed_at=NULL,
    last_error_code=NULL,next_retry_at=now()
WHERE domain_id='technical-operations' AND status='published';
COMMIT;
