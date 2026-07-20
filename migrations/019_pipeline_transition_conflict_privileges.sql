BEGIN;

-- PostgreSQL reads the explicit conflict target when evaluating
-- ON CONFLICT (dedupe_key) DO NOTHING. Keep the worker roles least-privileged:
-- they may inspect only the deduplication key, not transition payloads.
GRANT SELECT (dedupe_key) ON pipeline_transition_events TO
  clideck_mcp_worker,
  clideck_mcp_researcher;

COMMIT;
