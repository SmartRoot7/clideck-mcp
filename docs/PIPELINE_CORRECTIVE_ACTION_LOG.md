# Pipeline Corrective Action Log

This document is the durable handoff for production pipeline corrections.
Read it before changing the scheduler, executor bridge, processing runs, or
production grants. A restart may load a deployed correction, but it is never
accepted as the correction itself.

## 2026-08-31 — Reprocess progress and executor reliability

### Why this work was required

The Pipeline 2.0 pilot exposed four independent failure modes:

1. Reprocess runs completed Convert but never received Chunk work because
   mechanical work was coupled to AI source lanes.
2. Long PDF/OCR work could outlive its mechanical lease, and a transient
   PostgreSQL timeout could terminate the server worker.
3. After the first correction, every executor claim intermittently returned
   `INTERNAL_ERROR`. The restricted researcher role lacked `SELECT` on the
   intake/run tables read by the new scheduler query; production logged
   PostgreSQL `42501 permission denied for table intake_job_sources`.
4. One malformed optional `capability_slug`, invalid fragment identifier, or
   an artifact larger than the public 64 KiB body limit could reject an entire
   otherwise useful Analyze batch.
5. The first corrective deploy safely stopped before switching because the
   applicability reindex still required one index row for every revision.
   Pipeline 2.0 intentionally allows knowledge with unknown vendor/OS and does
   not create a fake applicability row for it. Production had 119,863 network
   revisions: 119,842 indexed and exactly 21 with both vendor and OS unknown.
6. The first post-deploy startup exposed a circuit-lock deadlock under eight
   simultaneous claims. Each claim cleared stale probes and then locked every
   circuit row, allowing concurrent transactions to acquire tuples in opposite
   order. PostgreSQL rolled the claims back, but useful executor time was lost.
7. Once Verify reached the new compensating-deactivate path, researcher lacked
   the narrowly required release read/write grants. Submissions rolled back on
   `knowledge_revisions` with PostgreSQL `42501`; subsequent release tables
   would have failed for the same reason.

### Minimal correction

- Mechanical reprocess Convert/Chunk work is queued independently from AI
  source lanes. Lanes are used only after fragments exist.
- Mechanical tasks renew their leases while external conversion/OCR is active.
  The worker survives retryable database errors and destroys a connection when
  rollback itself fails.
- Production grants explicitly allow `clideck_mcp_researcher` to read
  `source_processing_runs`, `intake_jobs`, and `intake_job_sources`.
- The authenticated loopback researcher bridge accepts structured artifacts up
  to 1 MiB; public API and admin JSON limits are unchanged.
- Analyze artifacts are validated record by record. Valid candidates survive;
  foreign/malformed entries are discarded, and only an unhandled leased
  fragment receives `targeted_retry`. Optional capability slugs are normalized
  or omitted instead of rejecting technical evidence.
- Applicability conservation now compares the index only with revisions that
  have enough real context to be indexed. Unknown-context revisions remain
  published and searchable without a fabricated scope. Batch progress advances
  across omitted revisions, so an all-unknown final batch cannot stall resume.
- Each claim can still recover an abandoned circuit probe even if it did not
  win the non-blocking scheduler lock. Cleanup locks only stale circuit rows in
  deterministic order, while the following circuit read no longer locks the
  whole table for the claim lifetime. The conditional probe reservation remains
  the single atomic write. This removes the startup deadlock without changing
  cooldown or Luna/Terra behavior.
- Researcher receives only the revision/release privileges required to publish
  a Fidelity QA compensating delta; it still has no general schema privileges.
  The deploy preflight now applies `grants.sql` to its disposable PostgreSQL
  database before integration tests, and a role contract checks every required
  table and identity-sequence privilege so this class of failure is caught
  before production.

### Invariants preserved

- No GitHub push or other GitHub write.
- No weakening of provenance or source binding.
- A model cannot submit a fragment outside its lease.
- Public request-size limits remain unchanged.
- Production releases still use only `ops/scripts/deploy-production.sh`.

### Verification and deployment

- Initial scheduler/lease correction commit: replaced by the final amended
  local commit `f29766e98d5d58ae7b5da4bf54ccb98f00c71e97`.
- The grant/body-limit/partial-artifact correction is contained in the commit
  that adds this log entry. Its exact deployed SHA and post-deploy measurements
  belong in the deployment/soak report so this source file does not require a
  second documentation-only production release.
