BEGIN;

ANALYZE release_items;
ANALYZE knowledge_items;
ANALYZE knowledge_revisions;
ANALYZE knowledge_candidates;
ANALYZE pipeline_tasks;
ANALYZE agent_runs;
ANALYZE candidate_verifications;

COMMIT;
