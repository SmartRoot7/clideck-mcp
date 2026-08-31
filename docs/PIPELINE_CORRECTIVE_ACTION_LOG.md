# Pipeline Corrective Action Log

This document is the durable handoff for production pipeline corrections.
Read it before changing the scheduler, executor bridge, processing runs, or
production grants. A restart may load a deployed correction, but it is never
accepted as the correction itself.

## 2026-08-31 — Scheduler settings lock must not block lease renewal

### Evidence and cause

During the clean soak for commit
`566e0d49c4faf763ca6f7d74659dff80ccda6270`, production first recorded one
`Query read timeout` at `08:11:19Z`, then a corroborating burst at `08:23:00Z`:
five AI lease heartbeats and the deterministic worker all timed out together.
There were no PostgreSQL deadlocks, service restarts, stale running tasks, or
permission failures. All affected requests shared one point of contention.

The non-blocking scheduler advisory lock correctly allowed other claims to skip
an in-progress reconciliation, but the winning reconciliation also held a row
lock on the singleton `pipeline_settings` record for its full transaction.
Both AI heartbeat and mechanical claim transactions requested the same row lock
just to read `enabled`. Eight simultaneous executors therefore accumulated
behind an unrelated scheduler transaction until the 10-second client query
timeout expired.

### Minimal correction

- Keep the scheduler's advisory lock and settings-row lock unchanged; they
  still serialize the one expensive reconciliation and administrative setting
  changes.
- Read `pipeline_settings.enabled` without `FOR UPDATE` in AI heartbeats and
  mechanical claims. PostgreSQL can return the committed setting without
  waiting for the scheduler row lock.
- Keep the task-row lease lock unchanged. Pause remains safe: either heartbeat
  commits before pause requeues the task, or it observes the committed disabled
  state and requeues the task itself.
- Add a PostgreSQL integration regression that holds the settings row lock and
  requires an AI lease heartbeat to renew immediately, plus a source contract
  preventing both latency-sensitive paths from reacquiring that lock.

### Verification and deployment

- Required checks: `pnpm check`, full `pnpm test`, `pnpm eval`, `pnpm build`,
  and the deployment script's disposable PostgreSQL migration/integration
  preflight.
- Deploy only the clean local commit containing this correction through
  `ops/scripts/deploy-production.sh`; record the exact SHA and post-deploy clean
  baseline in the next log update.

## 2026-08-31 — Periodic run reconciliation must not wait on active owners

### Evidence and cause

Commit `29bdad5e783322725e618dcfe3be8953071d80fa` removed the settings-row
contention and passed 204 PostgreSQL-backed tests plus 250/250 product evals.
After the atomic production switch, heartbeat renewal remained healthy, but at
`08:49:00Z` the periodic worker maintenance hit a new `Query read timeout` in
`reconcileTerminalProcessingRunsWithClient`.

The catch-all maintenance pass and an executor failure transaction can select
the same terminal processing run. The failure transaction legitimately owns
that run row until it has cancelled downstream work and recorded the outcome.
The periodic pass had no `SKIP LOCKED`, so it waited on work that was already
being completed elsewhere and could exceed the client query timeout.

### Minimal correction

- Select terminal processing runs with `FOR UPDATE OF run SKIP LOCKED` before
  applying the idempotent terminalization update.
- A run already owned by another transaction is not an error and is left for
  that owner or the next 30-second maintenance pass.
- Downstream cancellation, intake completion, audit status, retry limits, and
  run identity checks remain unchanged.
- Add a PostgreSQL regression that locks one terminal run from a separate
  transaction and requires the periodic reconciler to return immediately
  without modifying it.

### Verification and deployment

- Run the full disposable PostgreSQL suite and product evaluation, deploy the
  clean local correction only through `ops/scripts/deploy-production.sh`, then
  begin a new two-hour soak from the first clean post-deploy snapshot.
- Deployed commit: `da1216b87d5f1d70422d682c722e31396500a9fa`.
- The disposable PostgreSQL suite passed all 205 tests, including both lock
  regressions, and product evaluation passed 250/250. At the clean baseline
  `2026-08-31T09:11:00Z`, health/readiness and all services were healthy, all
  eight executor cards were fresh, active knowledge was 118472, Fidelity QA
  had 1201 checks, one lease was live, stale running tasks were zero, service
  restart counters were zero, and no monitored error had appeared since the
  final service activation.

## 2026-08-31 — Researcher terminal reconciliation intake grants

### Evidence and cause

The first follow-up check on `da1216b87d5f1d70422d682c722e31396500a9fa`
showed five PostgreSQL `42501` failures between `09:11:59Z` and `09:12:01Z`.
Removing lock waits allowed terminal reconciliation to reach its next intended
step: updating the associated `intake_job_sources` and `intake_jobs` outcome.
The researcher role could read both tables but had no update privilege, so the
transaction rolled back and concurrent claims reported the same failure.

### Minimal correction

- Grant researcher column-level UPDATE only for
  `intake_job_sources.status/result/updated_at` and
  `intake_jobs.status/completed_at/updated_at`.
- Do not grant changes to job configuration, source identity, processing
  version, ownership, counters, timestamps unrelated to completion, or general
  table UPDATE.
- Extend both the source grant contract and the disposable PostgreSQL role test
  to require the six needed columns and reject two representative unrelated
  columns.

### Verification and deployment

- Run the complete disposable PostgreSQL suite and 250-case evaluation, deploy
  only through `ops/scripts/deploy-production.sh`, reinstall the launchd pool,
  and restart the two-hour soak from a genuinely clean snapshot.

## 2026-08-31 — Known-answer demand reconciliation role contract

### Evidence and cause

The first smoke test on corrective commit
`501f5b24e1149e533fd35a8f05249862083ce477` completed every public MCP request,
but API logs recorded two PostgreSQL `42501` failures on
`knowledge_demands`. The successful-answer learning hook updates an existing
demand and skips its now-redundant queued diagnosis. That code was added after
the API grant matrix and its two writes were never represented in
`ops/sql/grants.sql`.

### Minimal correction

- Grant the API role UPDATE only on the six `knowledge_demands` result/state
  columns used by the reconciliation query.
- Grant SELECT/UPDATE only on the exact `pipeline_tasks` columns needed to
  identify and skip a queued demand diagnosis. No general pipeline table write
  privilege is added.
- Extend the disposable PostgreSQL role contract with column-level privilege
  checks, so production grants are verified before a release can be switched.

### Verification and deployment

- Run the complete deploy preflight, including the role-sensitive integration
  suite and 250-case product evaluation.
- Re-run public knowledge and workflow requests after deployment and require no
  new `42501` or `permission denied` log entries.
- Deployed commit: `566e0d49c4faf763ca6f7d74659dff80ccda6270`.
- The disposable PostgreSQL suite passed all 202 integration/unit tests and the
  product evaluation passed 250/250. At `2026-08-31T06:58:04Z`, the public
  health/readiness and deployment smokes were clean, all eight executor cards
  were fresh, six useful leases were active, stale running leases were zero,
  QA had reached 881 checks, active knowledge was 118190, and the final-deploy
  journal contained no new `42501`, permission, or lease-invalid error.

## 2026-08-31 — Lost AI leases must stop their model process

### Evidence and cause

The clean soak beginning at `2026-08-31T06:12:25Z` exposed a control-plane
failure rather than a model failure. Production recorded hundreds of
`PIPELINE_LEASE_INVALID` heartbeat exceptions from all eight executors. One
local Codex child remained alive for more than 25 minutes after its database
task had already been marked `LEASE_ATTEMPTS_EXHAUSTED`; other executor cards
became stale and useful concurrency fell to one lane.

Losing a lease is a legitimate race during deployment, expiry reconciliation,
or task completion. The bug was that the heartbeat endpoint represented that
state as an exception while the coordinator deliberately discarded every
periodic heartbeat exception. The model process therefore kept consuming its
lane and retrying an irrevocably stale token every five seconds.

### Minimal correction

- A heartbeat with a stale task/token pair now returns the structured control
  result `should_stop=true`, `reason=lease_invalid` and records the executor as
  `standby/lease_lost`; it no longer emits an exception for this expected
  control outcome.
- The coordinator distinguishes an administrative pause from a lost lease.
  Either stops the child immediately, but a lost lease is not reported back
  through the stale token and does not terminate the long-lived executor loop.
- Strict lease assertions remain unchanged for artifact submissions and every
  other state-changing operation.
- Unit coverage checks the stop classification. PostgreSQL integration
  coverage checks the structured stale-lease response and executor heartbeat.

### Verification and deployment

- Pre-deploy checks: `pnpm check`, full `pnpm test`, `pnpm eval`, `pnpm build`,
  and the deployment script's disposable PostgreSQL migration/integration
  preflight.
- Deployed commit: `501f5b24e1149e533fd35a8f05249862083ce477`.
- At `2026-08-31T06:48:41Z`, all eight executor cards had fresh Luna leases,
  configured capacity was `8/2`, active knowledge had advanced to `118166`,
  and no new `PIPELINE_LEASE_INVALID` event was present after deployment.

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
