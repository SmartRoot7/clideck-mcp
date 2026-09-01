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

## 2026-08-31 — Demand replay transaction and fragment reservation race

### Evidence

- The first observation after deploying `a7cf4a0` confirmed that the new
  terminal-run grants were exact and that no new `42501` for
  `intake_job_sources` occurred.
- Diagnosis submissions then repeatedly failed with PostgreSQL `25P02`
  (`current transaction is aborted`). The deterministic replay reads eleven
  context/applicability tables for which `clideck_mcp_researcher` had no
  `SELECT` privilege. The intended catch converted the replay result to
  `unknown`, but PostgreSQL kept the surrounding transaction aborted.
- Analyze submissions also reported `PIPELINE_FRAGMENT_RESERVATION_INVALID`.
  A live task still owned both affected fragment reservations, but an earlier
  candidate publication had changed their summary status from `analyzing` to
  `published`. The lease and reservation were valid; the redundant status
  predicate rejected them.
- The first clean-start observation then recorded two simultaneous
  `AI_CIRCUIT_PROBE_NOT_AVAILABLE` tool errors. Both executors had selected
  work from the same expired circuit snapshot; one won the conditional probe
  update and the other correctly had no probe to run, but that ordinary race
  was still surfaced as an exception.
- After that loser path was corrected, a Low task hit
  `PIPELINE_TERRA_FALLBACK_NOT_ALLOWED`: another executor had closed its
  circuit after the claim transaction read the circuit snapshot but before it
  selected the now-eligible task. The stale in-memory row incorrectly selected
  Terra even though the current database state allowed normal Luna work.
- Nine minutes after the next deploy, release sequence 6720 reached the
  required 120-release checkpoint. Copying the full 118k active state into
  `release_items` exceeded the generic 10-second fast-read timeout. A
  concurrent Verify completion also exceeded that limit while inserting its
  audit event. The publication retry succeeded as a delta, demonstrating that
  the failure was bounded database serialization rather than invalid data.

### Cause

- Demand replay was added inside the Diagnosis write transaction without a
  savepoint and without extending the restricted researcher's read contract.
- Publication treated `source_fragments.status` as an unconditional aggregate
  output even while another valid extraction task owned the fragment. Analysis
  then treated that mutable summary status as a second lease check.
- The conditional circuit update was already the correct single-winner
  primitive, but the losing branch was classified as an internal error rather
  than an expected standby outcome.
- Fallback model selection also trusted the earlier circuit snapshot without
  first constraining the task class to the explicit Medium fallback allowlist.
- The generic 10-second client timeout was applied equally to latency-sensitive
  scheduler reads and intentionally serialized release checkpoints. Checkpoint
  work grows with active knowledge and cannot safely share the fast-read budget.

### Minimal correction

- Grant the researcher read-only access to exactly the context,
  applicability, trust, and active-knowledge relations used by deterministic
  replay. Wrap optional replay in a PostgreSQL savepoint so a future replay
  failure can safely fall back to `unknown` without poisoning Diagnosis.
- Treat `reservation_task_id` plus the already validated task lease as the
  authority for Analyze submission. Publication no longer changes a fragment
  that is actively reserved in `analyzing` state.
- A circuit probe loser leaves its selected task queued, records
  `standby/circuit_cooldown`, and returns `scoped_ai_circuit_open`; no failed
  researcher tool call is emitted.
- Terra is now constructed only when `supportsTerraFallback` is true. A stale
  Low-circuit snapshot therefore continues on Luna instead of throwing; the
  existing query still prevents work behind a currently open Low circuit.
- Keep the 10-second pool default. Only the release advisory lock and full
  checkpoint copy receive a 60-second query budget; pipeline audit insertion
  receives 30 seconds so it can wait for its parent-row transaction. Immutable
  checkpoint frequency and release serialization are unchanged.
- Coverage verifies the read contract and a valid reservation whose summary
  status was concurrently advanced. No provenance, publication, or lease-token
  invariant is weakened.

### Verification and deployment

- Deployed commit `075d44db015fa078eb519e95f60cd91fad01d3e3` after
  210/210 disposable PostgreSQL tests, 250/250 product evaluation cases, the
  full build, backup, and production smoke suite. The release immediately
  restored useful publication and QA progress, but its clean observation
  window exposed the independent exhausted-continuation defect documented
  below; the soak therefore restarted rather than being declared successful.

## 2026-08-31 — Exhausted continuation blocked every executor claim

### Evidence and cause

- Immediately after `075d44d`, the public service remained healthy and the
  deterministic worker published releases 6736–6738, but six executor
  heartbeats became stale while their local loops repeatedly received
  `INTERNAL_ERROR` from claim.
- The restricted researcher journal showed the same PostgreSQL `23514` on
  every affected claim: `source_fragments_attempts_check`. Fragment
  `ef9ead78-3f0d-4609-ad4e-c993ab85cdfd` was still queued with
  `continuation_required` after ten analysis attempts. Claim tried to advance
  it to attempt eleven although the schema deliberately caps attempts at ten.
- The failure occurred before a lease could be returned, so every free
  executor selected the same highest-priority, permanently unclaimable task.
  Restarting a service could not change that database invariant.

### Minimal correction

- Scheduler maintenance now marks a queued analysis task containing an
  exhausted reserved fragment as `FRAGMENT_ATTEMPTS_EXHAUSTED` exactly once.
- The fragment receives the auditable `targeted_retry`/failed disposition and
  the existing run-scoped reconciler closes its processing run, intake item,
  downstream tasks, reservations, and (when all items are terminal) intake
  job. No source data is deleted.
- Claim excludes an exhausted fragment task before taking its row lock. This
  closes the small race in which another executor misses the non-blocking
  scheduler lock while the maintenance owner is terminalizing the task.
- The ten-attempt bound is unchanged; the correction converts exhaustion into
  a finite, observable outcome instead of a constraint-error loop.
- PostgreSQL integration coverage constructs the full source/artifact/run/job
  relationship at attempt ten and verifies task, fragment, run, item, and job
  terminal states.

### Verification and deployment

- Deployed commit `e6931101a09f7432aff9c79d9d52b78ac10c55b4` through
  `ops/scripts/deploy-production.sh`. The disposable PostgreSQL suite passed
  211/211 tests, product evaluation passed 250/250, and the build plus all
  production smoke tests passed. The launchd pool was reinstalled normally.
- At the clean baseline `2026-08-31T10:49:35Z`, public health/readiness and
  Tailscale admin were healthy, Overview returned exactly eight ordered
  executor cards with settings `8/2`, all eight heartbeats and leases were
  fresh, stale running tasks were zero, and service restart counters were zero.
- The historical task was terminalized once with
  `FRAGMENT_ATTEMPTS_EXHAUSTED`; its fragment remained at ten attempts with an
  auditable `targeted_retry` disposition and its processing run closed failed.
  Active knowledge was 118855 and Fidelity QA was 1609. Since the new worker
  start, both worker and researcher journals contained zero level-40 events and
  zero matches for the prior permission, deadlock, lease, reservation,
  checkpoint-timeout, converter, applicability, circuit-race, or fragment
  attempts constraint failures.

## 2026-08-31 — Fidelity scheduler/submission lock inversion

### Evidence and cause

- Eighteen minutes into the `e693110` clean window, production recorded one
  PostgreSQL `40P01` while `submit_candidate_verification` performed its
  post-commit scheduler refill. PostgreSQL identified the conflicting unique
  index tuple in `pipeline_quality_profiles`.
- The main Verify transaction locked the shared Fidelity quality profile and
  then its candidate rows. Concurrent scheduler refill in `queueSourceWork`
  did the reverse: it selected candidate rows `FOR UPDATE` and then upserted
  the same quality profile. Those opposing orders form a deterministic
  deadlock cycle under eight-way concurrency.
- The Verify data transaction had already committed, so surfacing a later
  refill deadlock also misleadingly reported a useful submission as failed.
  All services stayed healthy, but one executor turn was wasted.

### Minimal correction

- Scheduler refill now acquires the Fidelity quality profile before selecting
  candidate rows, matching the submission path's `profile -> candidate` order.
- `ensurePipelineWork` retries its whole transaction up to three times only
  through the existing transient-database classifier (`40P01`, `40001`, and
  connection-class failures). PostgreSQL has already rolled back the complete
  failed transaction, so no partial scheduler writes are repeated.
- Unknown database errors are still surfaced, and no artifact, QA,
  publication, provenance, or lease rule changes.
- A deployment contract asserts both profile-before-candidate ordering and the
  bounded transaction retry wrapper.

### Verification and deployment

- Deployed commit `09be91b386f1f77a38b8a97d6b765a92ac45f679` through
  `ops/scripts/deploy-production.sh`. The disposable PostgreSQL suite passed
  212/212 tests, product evaluation passed 250/250, and the build plus all
  production smoke tests passed. The launchd pool was reinstalled normally.
- At the new clean baseline `2026-08-31T11:28:28Z`, public health/readiness and
  the production services were healthy with zero worker/researcher restarts.
  Overview returned exactly eight ordered executor cards; all eight heartbeat
  and lease timestamps were fresh, settings remained `8/2`, and stale running
  tasks were zero. Active knowledge was 119375 and Fidelity QA was 2087.
- Since the new worker start, worker and researcher journals contained zero
  `40P01`, zero level-40 events, and zero matches for the previously tracked
  permission, lease, reservation, converter, applicability, circuit, timeout,
  transaction, or fragment-attempt failures. The two-hour soak restarts from
  this baseline; absence of recurrence remains the acceptance condition.

## 2026-08-31 — Fidelity profile hot row blocked submissions and heartbeats

### Evidence and cause

- Eighteen minutes into the `09be91b` clean window, active knowledge had grown
  by 385 and Fidelity QA by 425, but six researcher calls failed in one burst.
  Five were `Query read timeout` and the final cleanup call observed
  `PIPELINE_LEASE_INVALID` after its competing transaction completed.
- Four concurrent Fidelity executors serialized on the single
  `pipeline_quality_profiles` row. Each submission acquired that row before
  processing as many as eight candidates and updated it once per candidate,
  keeping the hot lock for the entire transaction.
- The same transaction owns its `pipeline_tasks` row until atomic completion.
  Heartbeats used a waiting `FOR UPDATE`, so an ordinary in-progress submission
  could exhaust the generic ten-second query budget. The heartbeat failure then
  triggered a redundant task-failure report. This was lock contention, not a
  lost lease or invalid artifact.

### Minimal correction

- Scheduler and submission create the shared quality profile with `ON CONFLICT
  DO NOTHING` and read its committed counters without taking a row lock.
- A Fidelity submission accumulates checked/error counters in memory and
  performs one short atomic profile update after candidate decisions are
  stored. Candidate transactions and audit outcomes remain unchanged.
- AI heartbeat takes the owned task row with `FOR UPDATE SKIP LOCKED`. If an
  atomic submit/fail transaction currently owns it, a non-locking lease
  snapshot returns `task_update_in_progress` with `should_stop=false`; it does
  not wait, extend an already protected row, or misreport lease loss.
- Integration coverage holds the task row from another connection and requires
  the heartbeat to return the structured nonblocking result within one second.
  Deployment coverage requires the shared profile creation path to remain
  non-updating. Unknown failures and truly absent/expired leases still surface.

### Verification and deployment

- Deployed commit `9e232d573d984ee5b666ac9436b9b04f5e6c849e`
  through `ops/scripts/deploy-production.sh`. The disposable PostgreSQL suite
  passed 213/213 tests (including the held-task-row concurrency test), product
  evaluation passed 250/250, and the build plus production smoke suite passed.
  The launchd pool was reinstalled normally.
- At the new clean baseline `2026-08-31T12:05:35Z`, health/readiness and all
  production services were healthy with zero worker/researcher restarts.
  Overview returned eight ordered, fresh executor cards with settings `8/2`;
  seven held live work and the eighth was healthy standby, with zero stale
  running tasks. Active knowledge was 119888 and Fidelity QA was 2773.
- Since the new worker start, worker and researcher journals contained zero
  level-40 events and zero matches for the tracked query-timeout, lease,
  permission, deadlock, reservation, converter, applicability, circuit,
  transaction, and fragment-attempt failures. The clean two-hour soak restarts
  from this baseline.

## 2026-08-31 — Final Fidelity source/profile lock order

### Evidence and cause

- Two minutes after the `9e232d5` baseline, one Fidelity submission reported
  `40P01` from its completion event. PostgreSQL showed the exact cycle: the
  submission had updated `pipeline_quality_profiles` and then needed a source
  foreign-key lock for `pipeline_events`; the scheduler already held that
  `source_candidates` row and was checking the profile unique index with
  `ON CONFLICT DO NOTHING`.
- `DO NOTHING` avoids a profile row update, but PostgreSQL's uniqueness check
  can still wait for a transaction that changed the existing profile. The
  previous correction shortened the hot lock but left the two paths ordered
  `profile -> source` and `source -> profile`.

### Minimal correction

- Fidelity submission now completes its task and records the source event
  before issuing the one aggregated profile-counter update. That update is the
  final SQL operation in the transaction.
- Scheduler and submission therefore both use `source -> profile`; the profile
  lock is still acquired once and held only until commit. No event, QA outcome,
  counter, candidate, provenance, or publication behavior is removed.
- Deployment coverage asserts that `completeTask` precedes the profile update
  inside the Fidelity branch, preventing this exact inversion from returning.

### Verification and deployment

- Deployed commit `c99298451d2942824ae7d63cec59c0c4034bff67`
  through `ops/scripts/deploy-production.sh`. The disposable PostgreSQL suite
  passed 213/213 tests, product evaluation passed 250/250, and the build plus
  production smoke suite passed. The launchd pool was reinstalled normally.
- At the new clean baseline `2026-08-31T12:19:23Z`, public health/readiness and
  all production services were healthy with zero worker/researcher restarts.
  Overview returned eight ordered executor cards; all eight heartbeats were
  fresh and running Luna Analyze work, settings remained `8/2`, and stale
  running tasks were zero. Active knowledge was 120008 and Fidelity QA was
  2944.
- Since the new worker start, worker and researcher journals contained zero
  level-40 events and zero matches for the tracked deadlock, query-timeout,
  lease, permission, reservation, converter, applicability, circuit,
  transaction, and fragment-attempt failures. The two-hour soak restarts from
  this baseline.

## 2026-08-31 — Terminal-run reconciliation raced active executors

### Evidence and cause

- Forty-two minutes into the `c992984` clean window, throughput remained high
  (active knowledge +718 and Fidelity QA +774), but four researcher errors
  appeared in two related lifecycle races.
- A fragment exhausted its retry budget while a Verify task from the same
  processing run still held a fresh lease. Run reconciliation correctly marked
  the run failed, but its cleanup update also cancelled and locked every
  claimed/running task. The active Verify submission waited behind that update,
  exhausted the generic query timeout, and reported `Query read timeout`
  instead of a lifecycle result.
- Separately, a 30-minute Analyze run reported `AGENT_RUN_TIMEOUT` and returned
  its task to the queue. Maintenance then correctly marked the detached agent
  run `ORPHANED_AGENT_RUN`; the old coordinator's immediately following
  `finish-run` call treated that already-terminal row as an error. Its catch
  path redundantly called task failure and finish-run again, producing
  `AGENT_RUN_NOT_RUNNING` and `PIPELINE_LEASE_INVALID` noise after the task had
  already been safely reclaimed.

### Minimal correction

- Terminal-run cleanup now cancels queued tasks and only expired claimed/running
  tasks. A fresh lease remains owned by its executor, so an in-flight atomic
  submission is not blocked or invalidated by run reconciliation. Fragment
  cleanup likewise leaves a fragment attached to a fresh task lease alone.
- Agent-run result recording is idempotent for an agent run that maintenance
  has already placed in a terminal state. The late coordinator receives the
  existing terminal status with `already_terminal=true`; it does not enter the
  reporting-error catch path or repeat task failure.
- New integration coverage requires a fresh Verify lease to survive terminal
  run reconciliation while queued sibling work is cancelled, and requires a
  late timeout report for an orphan-reconciled agent run to succeed as a no-op.
  Missing or genuinely non-running agent-run IDs still fail normally.

### Verification and deployment

- Deployed commit `43d75f4f552121971b5c7586f21601f44c655c78` through
  `ops/scripts/deploy-production.sh`. The first preflight correctly stopped
  before production because the new fixture used the run-only status
  `extracting` on a legacy source row; changing that test fixture to the valid
  source status `analyzing` required no production-code change.
- The successful preflight passed 214/214 disposable PostgreSQL tests,
  250/250 product evaluations, the complete workspace suite and build. Backup,
  migration, applicability verification, atomic switch, production smoke tests
  and the normal launchd reinstall all completed successfully.
- At the new clean baseline `2026-08-31T13:25:58Z`, public health/readiness,
  Tailscale admin health and all eight systemd services were healthy with zero
  worker/researcher restarts. Overview returned exactly eight ordered executor
  cards; all eight heartbeats and leases were fresh on Luna Analyze work,
  settings remained `8/2`, and stale running tasks were zero. Active knowledge
  was 120939 and Fidelity QA was 3898.
- Worker and researcher journals since the new start contained zero warnings
  and zero matches for the tracked timeout, lease, permission, deadlock,
  transaction, reservation, converter, applicability, circuit and fragment
  failures. Seventy-two nonterminal run rows without a materialized task were
  inspected separately: they own queued fragments outside the eight active
  source lanes and are eligible scheduler backlog, not abandoned runs. All
  eight active lanes had live tasks. The two-hour soak restarts from this
  baseline.

## 2026-08-31 — Completed work retained nonterminal run state

### Evidence and cause

- The first post-deploy snapshot was otherwise clean: active knowledge grew by
  73, Fidelity QA by 159, all eight executors held fresh leases, and journals
  contained no warnings or tracked failures.
- Run-level reconciliation found 59 historical sources already marked
  `completed_with_exceptions` whose immutable processing runs still said
  `extracting`, despite having no live task, claimable fragment, or unresolved
  candidate. Source completion updated the legacy source row but had no
  symmetric run-state finalization path.
- Eight valid `verified` candidates from three historical runs still referenced
  publication tasks that were already `completed`. The publication scheduler
  correctly excludes reserved candidates, so those stale reservation IDs made
  the records permanently ineligible for a new publication batch.

### Minimal correction

- Regular source reconciliation now clears `publication_task_id` only when a
  candidate remains `verified` and its publication task is terminal. The
  candidate payload, provenance, revision and quality state are untouched; the
  ordinary scheduler simply gets another idempotent publication attempt.
- A processing run is marked `completed` when its source is terminal and it has
  no live/queued task, claimable fragment, or unresolved candidate. Backlog runs
  with queued fragments outside the eight active source lanes remain active.
- Integration coverage reproduces both historical states, requires the stale
  publication reservation to clear while the verified candidate keeps the run
  open, then requires the run to close only after that candidate is published.

### Verification and deployment

- Deployed commit `606a02956f208e3f3b603175434dcca76785497c`
  through `ops/scripts/deploy-production.sh`. The first preflight correctly
  stopped before production on an ambiguous `completed_at` reference in the
  new `UPDATE ... FROM`; qualifying it as `run.completed_at` was the only
  correction required.
- The successful preflight passed 215/215 disposable PostgreSQL tests,
  250/250 product evaluations, all workspace tests and the full build. Backup,
  migrations, applicability verification, atomic switch, smoke tests and the
  standard launchd reinstall completed successfully.
- At the new clean baseline `2026-08-31T13:56:25Z`, health/readiness, Tailscale
  admin health and all services were healthy. Overview contained eight ordered
  Luna cards with eight fresh leases, settings `8/2`, zero stale tasks and zero
  worker/researcher restarts. Active knowledge was 121208 and Fidelity QA was
  4200.
- The 59 drained historical runs closed, completed publication reservations
  fell to zero, and the stricter orphan query returned zero. Backlog runs with
  claimable queued fragments remained active as intended. Journals since the
  clean start contained zero warnings and zero tracked failures. The two-hour
  soak restarts from this baseline.

## 2026-08-31 — Compensating checkpoint used the fast-read timeout

### Evidence and cause

- During the `606a029` soak, Fidelity QA continued to advance and active
  knowledge grew, but `submit_candidate_verification` reported `Query read
  timeout` at 14:39:27Z and again at 14:49:03Z. Both stack traces ended at the
  full `release_items` snapshot inside `publishCompensatingChanges`.
- The failed releases consumed sequences 6960 and 7080, exactly the two
  checkpoint boundaries in that interval. Ordinary publication already gave
  this 121k-row snapshot the 60-second serialized-publication timeout, while
  the compensating path accidentally inherited the pool's 10-second
  interactive-read timeout. The preceding checkpoint at sequence 6840 had
  completed successfully through the correctly bounded path.

### Minimal correction

- The compensating checkpoint now uses the same explicit 60-second
  `publicationSerializationTimeoutMs` as an ordinary checkpoint. Release
  cadence, immutable history, Fidelity decisions, deactivation semantics and
  publication serialization are unchanged.
- Deployment-contract coverage now inspects the compensating function itself,
  so a timeout on some other `release_items` insert cannot satisfy the test.

### Verification and deployment

- Local `pnpm check`, all non-database workspace tests, the full build and the
  250/250 product evaluation against a disposable PostgreSQL 16 database pass.
- Deployed commit `4d9c69abacf18de2862d427aa987174147582aa3`
  exclusively through `ops/scripts/deploy-production.sh`. Its migrated
  PostgreSQL 16 preflight passed 215/215 integration tests, all workspace
  suites, 250/250 product evaluations and the production build. Backup,
  applicability verification, atomic switch and smoke tests completed, and
  the standard launchd pool was reinstalled.
- At the new clean baseline `2026-08-31T15:07:19Z`, public health/readiness,
  Tailscale admin health and all production services were healthy. Overview
  returned exactly eight fresh Luna executors with settings `8/2`; seven were
  extracting and one was in Deep Review. Active knowledge was 121984,
  Fidelity QA was 5200, stale tasks and terminal publication reservations were
  zero, and worker/researcher restart and post-baseline error counts were zero.
  The next two-hour soak explicitly waits for a compensating checkpoint
  boundary to verify the corrected long-query path under the live dataset.

## 2026-08-31 — Analyze bypassed the Fidelity cap and blocked task events

### Evidence and cause

- During the `4d9c69a` soak, Overview showed three to seven simultaneous
  Verify executors although the combined Fidelity/repair cap was two. The
  database confirmed six concurrent `candidate_verification` tasks at one
  snapshot.
- `queueSourceWork(..., 'analysis')` entered the Fidelity branch before it
  considered queued fragments. The weighted allocator therefore counted the
  returned task as Analyze while the function had actually created Verify,
  allowing every extraction lane to bypass the cap.
- At 15:13Z two researcher requests reached the HTTP timeout and a third
  submission timed out inserting its completion event. The scheduler held an
  unnecessarily strong `FOR UPDATE` lock on the shared source row while
  Fidelity submissions needed a foreign-key key-share lock to record
  `pipeline_events`. All affected tasks belonged to the same source.

### Minimal correction

- Analyze mode now enters only fragment extraction. Fidelity and legacy Verify
  can be created only by the allocator's bounded Verify/AI path, so their
  combined live count cannot be mislabeled as Analyze.
- Scheduler and source-reuse selections now use `FOR NO KEY UPDATE` for source
  rows. They still serialize every status/reservation change they make, while
  remaining compatible with the key-share lock required by source-linked
  event inserts.
- Deployment-contract coverage fixes both invariants: mode routing is explicit
  and no strong `FOR UPDATE OF source/sc` lock may return.

### Verification and deployment

- Local `pnpm check`, all non-database workspace tests, the full build and the
  250/250 product evaluation against a disposable PostgreSQL 16 database pass.
- Deployed commit `756f86be2f821cc172b6dc86ac6b2b2c6e04f7d7`
  exclusively through `ops/scripts/deploy-production.sh`. The production
  preflight passed 216/216 migrated PostgreSQL integration tests, the complete
  workspace suite, 250/250 product evaluations and the production build.
  Backup, migrations, applicability verification, atomic switch and smoke
  tests completed, and the standard launchd pool was reinstalled.
- At the new clean baseline `2026-08-31T15:47:46Z`, public health/readiness,
  Tailscale admin health and all production services were healthy with zero
  worker/researcher restarts. Overview returned exactly eight fresh Luna
  executors with settings `8/2`; all eight were performing Analyze after the
  pre-deploy Verify leases drained. The combined live Fidelity/repair count was
  zero (and had remained at two while Fidelity work existed), stale tasks,
  terminal publication reservations, true orphans and empty active lanes were
  all zero. Active knowledge was 122462 and Fidelity QA was 6510.
- Worker/researcher journals since the release switch contained no warnings or
  tracked timeout, lease, transaction, permission, converter, applicability or
  circuit failures. The next two-hour soak starts from this baseline and still
  waits for the next published checkpoint sequence divisible by 120 to verify
  the earlier compensating-checkpoint timeout correction on production data.

## 2026-08-31 — Mechanical scheduler relocked an in-flight source

### Evidence and cause

- After the Fidelity-cap deployment, a 2,658-page Arista guide completed its
  1,580-fragment insert and deterministic extraction, but the final
  `source_candidates` status update waited until the 10-second query timeout.
  The task safely retried and completed on its second attempt; fragments and
  candidates were not lost or duplicated.
- Both prepared-buffer and reprocess mechanical selectors considered a source
  in `chunking` even when its existing `source_chunking` task was already
  queued or running. The prepared-buffer selector also took a redundant
  `FOR NO KEY UPDATE` lock before `queueSourceWork` performed its own serialized
  selection. A no-op scheduler pass could therefore hold the source row for
  the full reconciliation transaction and block the worker's final status
  update.

### Minimal correction

- Both mechanical selectors now omit a source/run that already owns a queued,
  claimed or running acquisition, conversion or chunking task. The prepared
  selector no longer takes the redundant outer source lock; `queueSourceWork`
  remains the single serialization point for work that genuinely needs to be
  created.
- Task semantics, retries, source stages, lane limits and data writes are
  unchanged. A live mechanical task is simply no longer rediscovered as work
  to enqueue.
- Deployment-contract coverage requires both selectors to retain the live-task
  exclusion and prevents the redundant prepared-source lock from returning.

### Verification and deployment

- Local `pnpm check`, the complete non-database workspace suite (154 core,
  22 domain and 23 admin tests) and the production build pass. Product eval and
  migrated PostgreSQL integration coverage run again in the mandatory deploy
  preflight.
- Deployed commit `8b5bce37e13cf23b72458a54d55d0c74d50be786`
  exclusively through `ops/scripts/deploy-production.sh`. Its clean PostgreSQL
  16 preflight passed 217/217 integration tests, all workspace suites, 250/250
  product evaluations and the production build. Backup, migration,
  applicability verification, atomic switch, smoke tests and the standard
  launchd reinstall completed successfully.
- At the new clean baseline `2026-08-31T16:05:10Z`, public health/readiness,
  Tailscale admin health and all production services were healthy with zero
  worker/researcher restarts. Overview returned eight fresh Luna executors,
  all performing Analyze, with settings `8/2`. Active knowledge was 122750 and
  Fidelity QA was 6541; restricted live Fidelity/repair, stale tasks, terminal
  publication reservations, true orphans and empty active lanes were zero.
- No warning, timeout, lease, permission, transaction, converter,
  applicability or circuit failure appeared after the release switch. The
  two-hour soak restarts from this baseline; it explicitly watches subsequent
  large mechanical tasks for a repeated source-lock timeout and continues the
  pending checkpoint-boundary verification.

## 2026-08-31 — Local admin Overview exceeded the database read timeout

### Evidence and cause

- The authenticated Tailscale admin page completed its session request, but
  `/admin/api/v1/overview` repeatedly returned `502` after about ten seconds.
  The internal API request failed with `Query read timeout`; the admin and API
  services themselves remained active with zero restarts.
- The summary query calculated related counters with many independent scalar
  subqueries. At the current production size this repeatedly scanned
  `knowledge_candidates` (about 232,000 rows / 919 MiB), `pipeline_tasks`
  (about 205,000 rows / 894 MiB), and `agent_runs` for individual metrics.
  Correct individual aggregates completed normally, but the accumulated
  repeated reads exceeded the standard ten-second query budget.
- The previous smoke verification checked service and public endpoint health,
  but did not wait for the authenticated Overview payload. It therefore missed
  a real user-facing regression.

### Minimal correction

- The Overview summary now groups related metrics into one aggregate scan per
  large table and reuses those results in the final row. Response fields,
  definitions, authorization and the ten-second database timeout are unchanged.
- A read-only production `EXPLAIN ANALYZE` of the corrected summary against the
  live dataset completed in about 2.2 seconds with cold reads, below the
  existing timeout without increasing or bypassing it.

### Verification and deployment

- TypeScript and admin contract checks pass. Focused Overview snapshot and
  local-admin proxy tests pass; full tests, evaluation, build, production
  deployment and an authenticated Chrome verification are recorded after the
  release below.
