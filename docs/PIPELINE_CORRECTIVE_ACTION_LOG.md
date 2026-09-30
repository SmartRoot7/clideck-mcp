# Pipeline corrective action log

Read before pipeline changes/monitoring or production grant reconciliation.
Repeated soak failure requires a root-cause code/schema/grant/config correction;
a restart alone is not a fix. Add evidence → cause → minimal correction → deployed
SHA (or configuration-only status) → measured result, then restart the read-only
soak. A clean baseline is not a completed extended observation window.

## Handoff as of the documentation review, 2026-09-29

No production inspection or deployment was performed for this review. Latest
recorded application SHA (September 21): `b48d745f255fc706a6886ef38eba0e0ab3f0b92b`.
Verify live state before acting.

- **Open:** Cisco/Akamai 403 blocks intake; September 21 restored Linux downloads
  only. End-to-end publication and an extended soak are not established.
- **Grants:** September 21 narrow `source_collections` admin grants are now
  codified in `ops/sql/grants.sql`; preserve the exact columns below.
- **Configuration:** September 8 cluster `jit=off` resolved Overview timeouts;
  preserve/verify after restore or host migration.
- **Policy drift:** old docs claimed universal 0.90/0.95 publication thresholds;
  current Pipeline 2.0 core treats confidence/quality/rollback as metadata.
  Documentation now describes this accurately; no code/policy change was made.
  Preserve remaining core controls and resolve policy changes explicitly.
- **Capacity:** operator-selected 1–8 lanes, no smaller stage cap. Earlier `8/2`, calendar
  blockers and no-push notes below were superseded; they are not instructions.

Resolved incidents are condensed below. Full evidence/test counts and previous
soak snapshots remain at `git show c53a740:docs/PIPELINE_CORRECTIVE_ACTION_LOG.md`.

## 2026-09-29 — Configurable execution and obsolete local runtime

- Before deployment: production `b48d745` services healthy, enabled/8, no running
  agent tasks, one fresh executor heartbeat; PostgreSQL `jit=off` preserved.
- Cause: local unified pool was unregistered; two legacy standalone executors
  remained on Node 20 and configured Codex path no longer existed.
- Correction: versioned profiles/capacity with atomic reservations, model-scoped
  circuits and Fidelity identity; authenticated runtime catalog and dated official
  prices; pinned Node 24 launchd pool, retire legacy executors through the normal
  deployment workflow. Corrected ignored Codex path and env mode to `0600`.
- Deployment SHA and measured post-deploy result: pending release verification.
- Additional role check found missing admin column privileges for model retry
  and cold Fidelity-profile creation. Corrected only required UPDATE/INSERT
  columns; regression executes settings/retry/profile queries under the actual
  `clideck_mcp_admin` role rather than the fixture's PostgreSQL owner.

## 2026-09-21 — Temporary intake recovery without an application change

### Evidence and cause

- Discovery found URLs but its preflight rejected them: the 15:21 UTC hourly
  snapshot contained 209 completed searches, zero new sources, five duplicates,
  and 362 rejected URLs. Earlier failure aggregation identified HTTP 403.
- On two official Cisco documents, identical Node HTTPS requests returned
  Akamai 403 with either installed CliDeck User-Agent and HTTP 200 with
  `curl/8`. Official Linux documentation remained accessible with the installed
  downloader's User-Agent. The Cisco issue remains unresolved.
- The installed website-intake function initially rolled back with PostgreSQL
  42501 on `source_collections`: the admin role could read this table but lacked
  the insert/update privileges required by that function.

### Authorized operational correction

- After explicit user approval, granted `clideck_mcp_admin` column-level INSERT
  on `coverage_target_id, canonical_url, vendor_domain, collection_type, status,
  crawl_depth, link_limit, path_prefix, intake_job_id, next_scan_at`, and UPDATE
  on `link_limit, path_prefix, intake_job_id, status, next_scan_at, updated_at`.
  Verified that DELETE and UPDATE of `canonical_url` remain unavailable.
- Called the already-deployed `createWebsiteIntakeJob` with the configured admin
  actor for `https://docs.kernel.org/networking/index.html`. Its normal audit
  and scope checks remain intact. Job: `d06743cd-bff9-406a-a617-b19410751c5d`;
  collection: `33cee1ab-715a-4691-b31f-9ab867f1a974`, scoped to `/networking/`.
- No application code, deployment, restart, schema migration, commit or push.
  Production remains `b48d745f255fc706a6886ef38eba0e0ab3f0b92b`.
  Grants were applied operationally only; a future grant reconciliation must
  account for them rather than assuming the repository already contains them.

### Verification

- At 17:04:11 UTC the collection had discovered 219 new sources. Four acquisition
  tasks had completed successfully and queued conversion; 215 sources remained
  approved for acquisition. This verifies restored downloads, not completed
  analysis/publication or resolution of Cisco blocking.
- This timestamp starts the fresh read-only observation baseline; no extended
  soak is claimed. Source provenance, deduplication and publication checks were
  not bypassed. Earlier forced Linux searches yielded only duplicates/404 and
  were not considered a successful recovery.

## 2026-09-08 — PostgreSQL JIT delayed admin and demo Overview

- Evidence/cause: nine Overview 502s at the 10-second timeout; source-intake
  query took 25.350s with 1,241 JIT functions versus 1.990s without JIT.
- Correction: authorized cluster `jit=off` via configuration reload; no restart,
  application deploy, timeout increase or lane restriction. Stored in
  `postgresql.auto.conf`; reversal is `ALTER SYSTEM RESET jit` plus reload.
- Result: fresh connection inherited off; Overview 1.951s, public demo 200 in
  2.449s, stats 200 in 0.200s, eight executors enabled, zero service restarts.
  Application remained `b48d745f255fc706a6886ef38eba0e0ab3f0b92b`; baseline only.

## 2026-09-01 — Future refresh fallback repeated only eight targets

- Cause: 933 searches repeated eight of 325 targets; failed preflight moved
  their `next_check_at` only 30 minutes, always ahead of untouched future targets.
- Fix: due-work ordering retained; future-only fallback rotates least recently
  searched first. No calendar blocker/cooldown added.
- Deployed `d5a27589bb0c16554c69b0cdd5c09fca4bceed57`; DB/eval gates passed.
  First sample: 77 searches/77 distinct targets, 19 new sources, acquisition and
  conversion resumed, fresh eight-lane activity, no new circuit/failure.

## 2026-09-01 — Discovery web search was routed through a disabled host

- Cause: 2,206 nominal searches, no new source, 60.6M input tokens; standalone
  search needed the code-mode host that executor flags disabled.
- Fix: enable search, `code_mode` and `code_mode_host` together only for bounded
  web-research tasks; keep other capabilities/secrets isolated.
- Deployed `80bd108e157e19b6838b88d21b478122d515a05a`; first 75 searches inserted
  four sources, no missing-search-tool reports; one source reached analysis.
  DB/eval/smokes passed, all executors fresh, no circuit/service restart.

## 2026-09-01 — Identical source bytes exhausted acquisition retries

- Cause: two Arista URLs hit `source_candidates_content_hash_idx` five times;
  byte-identical content was mishandled as failure instead of a normal duplicate.
- Fix: content-hash advisory lock and duplicate cleanup; preserve uniqueness and
  parallelism for different content. Migration 040 retries only that constraint.
- Deployed `bea935bf9387a20093a3f37fda27c2aad12b915a`; both retries became
  `duplicate_reason=content_hash` on first attempt without new artifacts.
  DB/eval/smokes passed; no recurrence in the new baseline.

## 2026-09-01 — Acquisition run ID used one parameter as UUID and text

- Cause: two new sources exhausted retries on `42P08`; one SQL parameter had
  conflicting UUID-column and text-JSON typing after successful download.
- Fix: cast UUID once, then convert to text; exact failure migration retains
  terminal task history and requeues only affected sources.
- Deployed `74e5f65942c5d29acafe8acd0b20977373969694`; both acquired on first
  retry with matching task/JSON run IDs and queued conversion. DB/eval/smokes
  passed; 07:44:26Z baseline had fresh eight-lane work and no repeated `42P08`.

## 2026-09-01 — Calendar and stage caps idled all eight executors

- Cause: all 325 targets future-dated; single Discovery/claim, Review/Fidelity,
  Demand and buffer caps prevented work. Deploy restored old capacity; admin
  also allowed reducing the eight physical lanes.
- Fix: continuous eligible refresh, independent tasks on every free lane, fixed
  capacity, Pause/Resume only; lifecycle scripts no longer restore old caps.
- Deployed `0d4638cdab95e8af3785d852807cc97fb4c3a2ce`, then lifecycle correction
  `cdde88c0d42c4437da43219e6bf1654d98165ca2`. DB/eval/smokes passed; repeated
  06:23–06:26Z samples showed 8 running/0 standby with changing task IDs,
  healthy services and no open circuit. [Capacity policy](PIPELINE_CAPACITY_AUDIT.md).

## 2026-09-01 — Vendor-neutral knowledge broke the demo list contract

- Cause: intentional null `vendor_slug` violated the public/admin Zod schema,
  making `/public/v1/demo/knowledge?limit=3` return 500.
- Fix: nullable revision vendor matching the view; coverage remains vendor-scoped.
- Deployed `969342d29f70e526e9746d660b79aa50b3c4c209`; DB/eval/smokes passed.
  At 05:34:33Z the list returned 200 with intact vendor-neutral records.

## 2026-09-01 — Terminal discovery leases stranded coverage targets

- Cause: three `discovering` targets had no live task after fifth-attempt expiry.
- Fix: reset only orphaned discovery ownership to queued; preserve live owners.
- Deployed `0928c6233343671a12521ef4b8b94c691793915d`; all three completed fresh
  discovery, no stranded/overdue targets at 05:20:40Z; DB/eval/smokes passed.
  The original future-date restriction was later superseded by the capacity fix.

## 2026-08-31 — Scheduler settings lock must not block lease renewal

- Cause: scheduler held singleton settings row while heartbeat/mechanical claims
  unnecessarily waited for that same row, causing 10-second timeouts.
- Fix: read committed `enabled` without `FOR UPDATE` in those paths; retain
  scheduler serialization, task locks and pause semantics.
- Subsequent entry records deployment `29bdad5e783322725e618dcfe3be8953071d80fa`,
  204 DB tests/250 evals passed; heartbeats recovered, next independent lock
  failure required a fresh correction/window.

## 2026-08-31 — Periodic run reconciliation must not wait on active owners

- Cause: maintenance waited on terminal runs owned by an executor transaction.
- Fix: `FOR UPDATE OF run SKIP LOCKED`; next 30-second pass handles skipped rows.
- Deployed `da1216b87d5f1d70422d682c722e31396500a9fa`; 205 DB tests/250 evals
  passed; 09:11Z baseline clean, but the next check exposed missing intake grants.

## 2026-08-31 — Researcher terminal reconciliation intake grants

- Cause: five `42501` failures updating intake outcomes after lock waits cleared.
- Fix: researcher UPDATE only on `intake_job_sources.status/result/updated_at`
  and `intake_jobs.status/completed_at/updated_at`; privilege regressions deny
  unrelated configuration/ownership columns.
- Later entry identifies deployment `a7cf4a0` and confirms no repeated intake
  `42501`; its observation then exposed the demand replay/reservation defects.

## 2026-08-31 — Known-answer demand reconciliation role contract

- Cause: successful-answer hook lacked API grants on demands/queued diagnosis.
- Fix: exact result/state UPDATE columns and task SELECT/UPDATE columns in grants,
  with production-role integration tests; no general table writes.
- Deployed `566e0d49c4faf763ca6f7d74659dff80ccda6270`; 202 DB tests/250 evals,
  public requests and smokes passed. At 06:58:04Z no new permission/lease error.

## 2026-08-31 — Lost AI leases must stop their model process

- Cause: ignored heartbeat exceptions left a Codex child consuming a lane for
  25+ minutes after its lease exhausted; hundreds of stale-token errors followed.
- Fix: structured `should_stop=true, reason=lease_invalid`; stop child, keep
  executor loop, do not report through stale token. Submissions still assert lease.
- Deployed `501f5b24e1149e533fd35a8f05249862083ce477`; 06:48:41Z sample had
  eight fresh leases, growing knowledge and no new invalid-lease events.

## 2026-08-31 — Reprocess progress and executor reliability

- Causes: mechanical work tied to AI lanes; long OCR outlived leases; retryable DB
  failures killed worker; missing researcher reads/release grants; optional bad
  fields or 64-KiB limit rejected whole artifacts; unknown-context revisions
  broke reindex conservation; circuit cleanup locked rows in conflicting orders.
- Fixes: independent mechanical queues/lease renewal, resilient worker/rollback;
  exact grants checked before switch; 1-MiB researcher bridge; record-wise partial
  acceptance; context-eligible reindex with advancing cursor; deterministic stale
  circuit locks; narrow compensating-release privileges. Provenance/leases remain.
- Initial amended correction `f29766e98d5d58ae7b5da4bf54ccb98f00c71e97`; this
  entry did not record a final combined deployed SHA or extended-soak result.

## 2026-08-31 — Demand replay transaction and fragment reservation race

- Causes: replay lacked eleven relation reads/savepoint (`25P02`); mutable
  fragment status overruled valid reservation; losing circuit probe raised error;
  stale snapshot chose Terra for Low; checkpoint/audit used fast-read timeout.
- Fixes: exact reads and replay savepoint; task lease/reservation authority;
  probe loser remains queued; Terra constrained to eligible Medium tasks;
  release lock/checkpoint 60s, audit 30s, ordinary reads still 10s.
- Deployed `075d44db015fa078eb519e95f60cd91fad01d3e3`; 210 DB tests/250 evals
  and smokes passed; publication/QA resumed but continuation failure reset soak.

## 2026-08-31 — Exhausted continuation blocked every executor claim

- Cause: attempt-ten queued fragment tried attempt eleven, violating
  `source_fragments_attempts_check` on every claim.
- Fix: finite `FRAGMENT_ATTEMPTS_EXHAUSTED`, audited targeted-retry/run/job
  terminalization, claim-side exclusion; preserve the ten-attempt bound and data.
- Deployed `e6931101a09f7432aff9c79d9d52b78ac10c55b4`; 211 DB tests/250 evals
  and smokes passed; 10:49:35Z baseline had eight fresh leases and no recurrence.

## 2026-08-31 — Fidelity scheduler/submission lock inversion

- Cause: profile→candidate submission versus candidate→profile scheduler (`40P01`).
- Fix: consistent ordering and up to three whole-transaction transient retries;
  later hot-row corrections below further shortened/reordered profile updates.
- Deployed `09be91b386f1f77a38b8a97d6b765a92ac45f679`; 212 DB tests/250 evals
  passed; 11:28:28Z baseline clean, then separate profile contention appeared.

## 2026-08-31 — Fidelity profile hot row blocked submissions and heartbeats

- Cause: per-candidate shared-profile updates held the hot row for full batches;
  waiting task heartbeat locks timed out behind valid submissions.
- Fix: profile create-once/read committed, one aggregated counter update;
  heartbeat `SKIP LOCKED` with `task_update_in_progress, should_stop=false`.
- Deployed `9e232d573d984ee5b666ac9436b9b04f5e6c849e`; 213 DB tests/250 evals
  passed; 12:05:35Z baseline clean, followed by the source/profile inversion.

## 2026-08-31 — Final Fidelity source/profile lock order

- Cause: profile update followed by source event opposed scheduler source→profile;
  `ON CONFLICT DO NOTHING` uniqueness check can still wait on profile changes.
- Fix: complete task/source event before the final aggregated profile update.
- Deployed `c99298451d2942824ae7d63cec59c0c4034bff67`; 213 DB tests/250 evals
  and smokes passed; 12:19:23Z baseline eight running, no new tracked errors.

## 2026-08-31 — Terminal-run reconciliation raced active executors

- Cause: run failure cancelled fresh sibling Verify leases; late coordinator
  finish of already-terminal agent runs produced redundant failures.
- Fix: cancel queued/expired tasks only, preserve fresh tasks/fragments;
  terminal finish is idempotent with `already_terminal=true`.
- Deployed `43d75f4f552121971b5c7586f21601f44c655c78`; 214 DB tests/250 evals
  passed; 13:25:58Z baseline clean. The 72 queued-fragment backlog runs were
  legitimate, not orphans.

## 2026-08-31 — Completed work retained nonterminal run state

- Cause: 59 drained runs stayed extracting; eight verified candidates retained
  terminal publication reservations and could not republish.
- Fix: clear only terminal reservations; close runs only with no tasks,
  claimable fragments or unresolved candidates; preserve legitimate backlog.
- Deployed `606a02956f208e3f3b603175434dcca76785497c`; 215 DB tests/250 evals
  passed; 13:56:25Z all 59 closed, stale reservations/true orphans zero.

## 2026-08-31 — Compensating checkpoint used the fast-read timeout

- Cause: release 6960/7080 full snapshots used 10s instead of ordinary checkpoint
  60s; both timed out on the 121k-row active state.
- Fix: same `publicationSerializationTimeoutMs` on compensating checkpoint.
- Deployed `4d9c69abacf18de2862d427aa987174147582aa3`; 215 DB tests/250 evals
  and smokes passed; 15:07:19Z baseline clean. Live checkpoint-boundary observation
  was still pending; do not turn that baseline into a completed soak claim.

## 2026-08-31 — Analyze bypassed the Fidelity cap and blocked task events

- Cause: Analyze allocator created Verify tasks; strong source-row locks blocked
  event foreign-key reads and timed out submissions.
- Fix: explicit stage routing, `FOR NO KEY UPDATE` on source rows. The historical
  two-lane Fidelity restriction was subsequently removed; retain lock/routing fix.
- Deployed `756f86be2f821cc172b6dc86ac6b2b2c6e04f7d7`; 216 DB tests/250 evals
  passed; 15:47:46Z eight Analyze runs, zero tracked errors; checkpoint check pending.

## 2026-08-31 — Mechanical scheduler relocked an in-flight source

- Cause: redundant selection/lock delayed a 2,658-page guide's final chunk status;
  second attempt succeeded without lost/duplicated fragments.
- Fix: exclude sources/runs with live mechanical tasks and remove redundant outer
  source lock; keep `queueSourceWork` serialization.
- Deployed `8b5bce37e13cf23b72458a54d55d0c74d50be786`; 217 DB tests/250 evals
  passed; 16:05:10Z baseline clean. Large-task/checkpoint soak still pending.

## 2026-08-31 — Local admin Overview exceeded the database read timeout

- Cause: repeated scans of large candidate/task tables accumulated beyond 10s;
  service-only smoke missed authenticated Overview 502s.
- Fix: one reusable aggregate per large table; keep timeout and response contract.
- Deployed `69c2f6318ea54f907f8d28a0429869a87ceb364b`; 227 DB tests/250 evals
  passed; production Overview 200 in 2.18s, eight cards, no new timeout.
  September 8 later corrected separate JIT overhead.

## 2026-09-01 — Discovery telemetry gate opened a false AI circuit

- Cause: valid artifacts lacked an optional JSONL event; local
  `WEB_SEARCH_NOT_OBSERVED` rejection was misclassified as platform failure.
- Fix: remove telemetry gate/classification; keep real source/acquisition checks.
- Deployed `37e4f779681b040bfd5e8a2dc09810c34a186ae7`; 227 DB tests/250 evals
  passed; circuit cleared and 30→35 searches completed without that error.
  This proved search execution, not full pipeline recovery.

## 2026-09-01 — Terminal processing-run mismatch stranded Analyze backlog

- Cause: 7,636 queued fragments belonged to terminal runs, but scheduler selected
  only nonterminal run IDs and created no Analyze work for eight occupied lanes.
- Fix: prefer nonterminal run, otherwise newest terminal run with claimable
  queued fragments; preserve exact run scope and reservations.
- Deployed `0fcd81d0aa0d7dc73c64ab128c5a3ea2fd04e56a`; 228 DB tests/250 evals
  passed; eight concurrent Analyze tasks, backlog 7,636→7,599, growing QA/knowledge,
  healthy endpoints and no new journal error in the observation sample.
