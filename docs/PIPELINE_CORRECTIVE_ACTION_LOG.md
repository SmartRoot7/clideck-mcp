# Pipeline corrective action log

Read before pipeline changes/monitoring or production grant reconciliation.
Repeated soak failure requires a root-cause code/schema/grant/config correction;
a restart alone is not a fix. Add evidence → cause → minimal correction → deployed
SHA (or configuration-only status) → measured result, then restart the read-only
soak. A clean baseline is not a completed extended observation window.

## Handoff as of production verification, 2026-10-01

Live application: `bb8b234a10e2b3e64bc3f2c8ab4e6bbf841d4f93` on
`100.116.82.78`, deployed through `ops/scripts/deploy-production.sh`.
Pipeline enabled, capacity 8. At the later learning audit, operator settings
version 8 used `gpt-6-luna` low/medium, High fallback `gpt-5.6-terra` medium.

- **Executor recovery:** October 1 expired-lease/scheduler correction is deployed.
  At 17:12 UTC all eight lanes were healthy and running with zero expired leases;
  137 AI runs had completed successfully. API/admin/MCP acceptance passed.
  The read-only window restarts at 17:12 UTC; this is a short acceptance baseline,
  not an extended soak or validation of the entire knowledge base.
- **Open:** Cisco/Akamai 403 blocks intake; September 21 restored Linux downloads
  only. One public Junos answer is verified below; an extended soak is not established.
- **Learning audit baseline:** 15/20 unknown questions lost diagnosis tasks; a global
  migration-029 trigger silently blocks concurrent inserts while reconciliation
  omits orphan `queued` demands. EVPN falsely closed with OSPF; terminal sources
  strand Fidelity backlog; public stats remain stale since August 30. Corrections
  are implemented below. All 20 later requests retained diagnosis tasks;
  one new public answer is confirmed, 19 gaps remain open; see final acceptance
  below. The entire knowledge base and an extended soak are not yet verified.
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


## 2026-10-01 — Expired leases stranded all executor capacity

- Evidence at 16:28–16:32 UTC on `df46aa3`: eight tasks still `running` with
  leases expired at 05:00–05:05 UTC, zero valid AI runs, all eight fresh executor
  heartbeats reporting `standby/capacity_reached`; five ready tasks waited.
  Fidelity's extractor-history query ran for minutes while holding the scheduler
  transaction. Its EXPLAIN scanned the date-only agent-run index and filtered by
  task for each candidate; no task/history index existed. Recovery was in that
  same transaction, so a preparation timeout rolled it back.
- Additional evidence: collection `8f891ef7-9308-4382-b403-dab54264b49f` had a
  200-page budget already consumed and a 200-item cursor; it repeatedly logged
  zero pages and immediately rescheduled itself. The local launchd pool was
  pinned to Node 20 because installation inherited the shell's Node executable.
- Correction: migration 048 indexes exact task/started-at history; materialize
  and lock at most 80 audit candidates before evidence/history joins. Commit
  expired-lease recovery independently, using its own advisory lock and
  SKIP LOCKED, and count only valid leases against executor capacity. Bound
  scheduler/recovery statements on the server below the existing 10-second
  client deadline. A finished collection budget clears its cursor; each later
  scan gets its own budget while preserving lifetime counters and existing
  refresh policy. Deployment/launchd installation require and pin Node 24.
  Models, selected capacity, source policy, immutable knowledge, lease retry
  limits, circuits and operator Pause/Resume are preserved.
- Validation: 48 targeted tests passed on a fresh disposable PostgreSQL database;
  the 17 recovery/urgent tests passed again after adding exact extractor-history
  coverage. Type checks passed. Tests demonstrate recovery surviving preparation
  failure, independent scheduler/row locks, live-lease preservation and finite
  retry exhaustion, collection scan completion/renewal, and original extractor
  model/effort selection. Node 20 installation fails before changing launchd.
- Deployment: clean `main` commit `bb8b234a10e2b3e64bc3f2c8ab4e6bbf841d4f93`
  verified through `ops/scripts/deploy-production.sh`. All 348 tests, 250/250
  evaluation fixtures, type checks and local/Linux builds passed. Full backup,
  migration 048, grants, reconciliation/statistics, atomic switch and public
  protocol smokes completed; the script restored the selected executor pool.
  Backup: `/var/backups/clideck-mcp/deploy-20261001T164555Z-bb8b234`.
  API/admin/researcher started at 17:02:56 UTC, worker at 17:02:57 UTC; all
  remain active with zero automatic restarts. Launchd now pins bundled Node
  24.19.0. Enabled capacity 8, settings version 8 and both model profiles remain
  unchanged; the model catalog is fresh with no catalog/pricing error or circuit.
- Production-scale history acceptance: read-only EXPLAIN ANALYZE of the bounded
  preparation query (without FOR UPDATE) measured 1.755 ms for two candidates
  and 84.458 ms for a source with 4,581 pending candidates, materializing only
  80 before history joins. Both plans use `agent_runs_task_history_idx`; exact
  history lookup measured 0.103/0.098 ms. Lock/recovery behavior is covered by
  the integration regressions. These are individual samples, not a latency SLA.
- Live acceptance, 17:03–17:14 UTC: eight fresh, healthy running executor
  heartbeats and eight valid leases, zero expired leases. Every lane completed
  work; at 17:12:16 UTC 137 AI runs were completed with no failed/timed-out runs.
  Completed stages included 5 diagnoses, 35 analyses, 47 verifications, 50 deep
  reviews and 46 publication tasks, plus acquisition/conversion/chunking.
  At 17:13 UTC 239 new revisions existed, 233 currently active; Fidelity checks
  recorded 128 passed and 32 repair outcomes, retaining the normal repair path.
  The initial five-fragment analysis completed at 17:08:59 UTC and its
  executor subsequently completed nine more runs. No active database query
  older than 10 seconds was observed at the acceptance snapshots.
- Collection acceptance: the exhausted collection now has an empty cursor,
  scan counter zero, unchanged lifetime 200 pages and a future refresh time.
  Only one zero-page completion appeared after switching, with no repeat loop.
  Authenticated settings/models/Overview returned HTTP 200 in 257/108/2,362 ms;
  Overview reported the deployed SHA and all eight executors healthy/running.
  An initial pool catalog-report failure at 17:03:06 resolved; no later executor
  errors were observed, and subsequent catalog reads were fresh/error-free.
- Public acceptance: interface query for Cisco Catalyst 9300 / IOS XE 17.12.4
  returned complete in 2,444 ms with three non-dangerous references; provenance
  for those actual references succeeded. Existing Catalyst-family normalization
  and documentation-only assurance limits remain; this is service acceptance,
  not exact hardware/patch validation.
- Remaining source-level outcomes: upstream HTTP 403/429/503 attempts occurred;
  three acquisition tasks exhausted their existing retry limit (two 403, one
  429). One continuation from a September 21 processing run correctly closed
  with `FRAGMENT_ATTEMPTS_EXHAUSTED` after its fragment reached ten attempts;
  no new AI run failed. Neither outcome blocked the remaining lanes. No retry
  limit, global cooldown or quota was added. Service warning/error logs after
  switching contained only the external HTTP failures, with no database timeout,
  lease-validation or grant errors.
- Receipts: `artifacts/operations/2026-10-01-pipeline-recovery/` contains the
  first/final read-only SQL snapshots, admin responses, history plans and public
  MCP summary (local ignored evidence). Restart the read-only observation window
  at **2026-10-01 17:12 UTC**. No completed extended soak is claimed.

## 2026-10-01 — Public interface search and provenance retrieval

- Evidence: the OpenAI P4 interface-state/source-metadata prompt repeatedly
  returned `RETRYABLE_INTERNAL_ERROR`; the public call reproduced it. On
  372629 production revisions, its vendor broad-search EXPLAIN measured
  14940.963 ms against the unchanged 10 s database deadline. Wide
  applicability/trust/context joins ran for 12705 rows before the limit.
  Output-format words generated unrelated FTS candidates. P1 also returned a
  dangerous password-recovery workflow because its incidental verification
  steps contained `verify`/`operational` words.
- Correction: materialize active, domain/kind/vendor/exclusion-filtered ranked
  IDs before broad-search metadata joins; keep the same bounded candidate
  count and ranking. Strip the requested provenance-output clause from search
  intent and ignore generic find/guidance/verify wrappers. Dangerous results
  must match the primary title/summary/command/action-step purpose or a supported
  capability, rather than only incidental procedure checks. Related dangerous recovery and
  cross-platform upgrade guidance remains available with its safety metadata.
  Immutable publication/provenance, applicability rules, 8 executor lanes,
  model profiles, pause/leases/circuits and query deadlines are unchanged.
- Validation: type checks and 20 targeted tests passed on a disposable seeded
  PostgreSQL database, including both exact publication prompts, contaminated
  recovery evidence, explicit recovery retrieval and portable exclusions.
  Read-only production EXPLAIN measured 1000.544 ms for vendor expansion and
  1058.410 ms globally; only 20 metadata rows are joined. These are individual
  observations, not a latency SLA or extended soak. Deployment and exact public
  MCP rechecks ran after the standard production script. The first preflight
  passed all 345 tests but stopped before production changes on 4/250 evaluation
  template lookups: the initial guard omitted executable apply steps from
  structured change contracts. Keep those action steps, excluding incidental
  verify/check/confirm/validate/compare steps; all four CLI-template regressions pass.
  No restart or larger timeout was used to mask a failure.
- Final deployment: `df46aa3bf541828ba6ab5eb301f3f07f10b3b47c` verified through
  `ops/scripts/deploy-production.sh`; all 345 tests and 250 evaluation fixtures,
  type checks/build, full backup, reconciliation/statistics and live smokes passed.
  Backup: `/var/backups/clideck-mcp/deploy-20261001T040937Z-df46aa3`.
  The local Luna pool was restored by the script. API/worker are active with zero
  automatic restarts; pipeline enabled/capacity 8/settings version 8 and selected
  gpt-6-luna low/medium, High fallback gpt-5.6-terra medium remain intact.
- Post-deploy public acceptance: exact P1 returned complete in 1740 ms with three
  safe interface records, without the unrelated password-recovery workflow.
  Exact P4 returned complete in 2554 ms with three safe records; provenance for
  those actual returned references succeeded in 85 ms with official Cisco source
  metadata. Public revision `9eccdd05-cf43-402f-a3a6-431f0da310ac` remains active.
  Raw public receipts: `artifacts/publication/search-fix-public-retest.json` and
  `search-fix-public-provenance.json`. The read-only acceptance window restarts
  at 2026-10-01 04:28 UTC; these observations establish neither an extended soak
  nor exact patch/hardware validation of the already disclosed Catalyst-family
  normalization. Neither is a new publication blocker for these corrected cases.

## 2026-09-30 — Urgent learning correction

- Evidence/cause: the audit above measured 15 lost diagnoses, unrelated EVPN
  replay and no Fidelity progress. The global trigger dropped durable inserts;
  orphan reconciliation and terminal-source audit selection were incomplete.
- Minimal correction: migration 044 replaces the global diagnosis cap with
  per-demand uniqueness and repairs orphans. Durable request recovery, urgent
  scheduling at each stage and immediate publication retain leases, selected
  capacity, circuits and operator pause. Replay preserves original context,
  feature and action; source reuse requires relevance. Fidelity retains its
  original processing run and extractor/verifier identity on terminal sources.
- Operator visibility: Requests & Learning shows progress and waiting reasons;
  optional MCP feedback/status tools and authenticated admin feedback re-open
  gaps without quarantining knowledge on an unverified user complaint. Missing
  context remains visible and requires clarification.
- Statistics correction: materialize the projected active-knowledge coverage
  once per refresh instead of repeating the expensive public-view scan four
  times. Public response contracts and visibility rules remain unchanged.
- Validation before deployment: 331 tests and 250 evaluation fixtures passed
  on a fresh disposable PostgreSQL database; network pack validation passed.
  Added parallel-20, duplicate, orphan/recovery, role-grant, urgent-claim,
  terminal/original-run and EVPN/OSPF regression checks.
- First deployment: `ed4ae50c5dc8eb1d0b2c40e696608ef537240a95` through the
  production script, migration 044 and smoke checks passed. Twenty parallel
  genuine unknown questions all received durable learning IDs; no orphan
  queued/running diagnosis remained. All diagnoses completed; research and
  source preparation progressed, but no complete answer yet at the interim
  21:10 UTC checkpoint. Official-source gaps remain explicit.
- Follow-up cause: the worker awaited expensive statistics before every source
  operation. The projected coverage query measured 12.225 s against a 10 s
  client timeout; retries kept the August 30 snapshot and delayed sources.
  Move one refresh to its own background pool, use a consistent transaction,
  sequential aggregates, a 55 s server deadline and a 60 s client deadline.
  Preserve the fast public cache and fallback. Future retry tasks now consume
  urgent queue capacity only once ready; domain aliases/plurals match in both
  source reuse and evidence filtering.
- Follow-up validation: 334 tests and 250 evaluation fixtures passed on a fresh
  database, including nonblocking single refresh and future-retry/full-background
  queue regression checks. Follow-up `7bc91258c9f14b5bd75c04ecb1534978da04fce0`
  deployed successfully; the worker refreshed statistics at 21:26:27 UTC in
  18.647 s with no cache error, while public reads remained fast.
  Post-deploy observation found worker-role journal recovery missing UPDATE
  permission: SELECT FOR UPDATE requires it even without rows. Add only the
  two recovery columns and intake-function execution to the existing worker
  grants; verify recovery as both real scheduler roles.
  Four diagnosed cohort questions remained queued behind a shared topic's
  exhausted state and future seven-day eligibility. Topic history now orders
  ready user questions instead of blocking them; retain each demand's retry
  date, live-task uniqueness and circuit isolation. Terminal-source audits
  also join urgent materialization instead of waiting behind a full background
  queue. Both scheduling failures were reproduced before correction.
  Final correction passed 336 tests and 250 evaluation fixtures on a fresh
  database, plus type checks and network-pack validation. The worker-role
  failure was reproduced before applying the scoped grants and passed after.
  Deployment of `ae14e1d9cf21b9526af8c7bfa1c1ac3b2d083ed4` was stopped during
  backup before application switching: a read-only production-scale plan check
  timed out at 15 s. The terminal-source correlated candidate lookup rescanned
  the large table. Replace it with one distinct source-ID set; the same
  production-scale read completed in 784 ms. Deployment cleanup restored the
  local executor pool; the application remained on `7bc9125`.
  Final corrective deployment and live answer result pending.
  The short acceptance window is not a completed extended soak.

## 2026-09-30 — Search backlog delayed prepared demand evidence

- `56fb9fe722caeb4a00fc9e470b39a74e8fbec04c` deployed through the production
  script. Worker recovery grants verified, service restart count zero, all
  eight selected-model executors running. Conversion and segmentation resumed
  (15 and 10 passed checks after 21:56:30 UTC); no lost diagnosis tasks.
- At 22:00 UTC the cohort had 12 prepared sources and 160 queued fragments,
  while 95 queued discovery tasks took precedence over newer source work.
  Queue reservation counted searches as source progress; equal task priority
  plus creation time also picked an older search even with analysis ready.
  Topic fairness ordering preceded the explicit user-demand priority.
- Correction: reserve ready analysis/verification/review independently from
  searches; prefer active source windows before historical terminal audits;
  use source progress to break equal-priority lease ties. Demand priority
  precedes topic fairness. Keep diagnostics first, physical capacity, leases,
  retry dates, circuits, publication policy and operator pause unchanged.
- Regression reproduced the search-before-analysis lease on the previous
  release; coverage also includes simultaneously full background and urgent
  search queues. All 337 tests and 250 evaluation fixtures passed on a fresh
  database; type checks passed. The revised read-only production source
  selection took 829 ms. `7c58632c727b0632aef52fea2e2760d89549a369`
  deployed successfully; all four queued cohort demands entered discovery.
  Deep review resumed (38 completions by 22:27 UTC), worker restart count zero.
- Further observation: the shared source-progress reservation still let a
  large older review backlog block analysis and Fidelity. Separate ready
  reservation counts for analysis, verification, Deep Medium and Deep Low;
  every class may queue the selected operator capacity, while physical leases
  enforce that capacity across all classes. Prepare analysis and verification
  before review refill. No new lane cap, cooldown or quota.
- Only candidate-bearing sources enter verification selection. Migration 045
  indexes extraction task history and pending published-candidate audit joins;
  the old live-task/open-candidate indexes omitted those rows.
- Before the correction, full review and verification queues both reproduced
  missing analysis. The terminal/original-run regression now also includes a
  full urgent analysis queue. All 339 tests, 250 evaluation fixtures, type
  checks and network-pack validation passed on a fresh database. `7be2bfd`
  deployed successfully at 22:58 UTC; migration 045, smoke tests and settings
  (enabled/8, selected models) verified. All 20 original questions remained
  unknown; the new scheduler reached a separate analysis-history timeout.

## 2026-09-30 — Analysis history lookup timed out at production scale

- Evidence: after `7be2bfd`, the worker logged Query read timeout inside
  `queueSourceWork`'s fragment selection. PostgreSQL EXPLAIN showed a parallel
  full scan of `knowledge_candidates` even for one fragment's historical keys.
  The missing evidence-fragment index and history projection during relevance
  selection made urgent preparation roll back. Restarting did not correct it.
- Correction: select and lock at most 16 relevant fragments in a materialized
  CTE before reading their history. Migration 046 indexes fragment ID and stable
  key across all candidate statuses. Preserve relevance ordering, all historical
  keys, context bounds, transactional reservations and SKIP LOCKED.
- Validation: the history/relevance regression and all urgent-learning tests
  pass. On a fresh database, 340 tests and 250 evaluation fixtures passed; type
  checks passed. A separate production-scale Fidelity read used migration-045
  indexes and completed in 6.144 ms, so no speculative change to it was needed.
  `18064091fd831940d97aa049eb5ecace70fb66dd` deployed at 23:21 UTC; the history
  probe now uses an index-only scan (0.246 ms). By 23:37 UTC: 52 analyses,
  82 verifications, 76 publications; 317 Fidelity passes and 32 repairs since
  restart. Worker restart count zero, no new worker query timeout. Public MCP
  confirmed the formerly unknown Junos SRv6 local-SID question (HTTP 200);
  the remaining 19 original queries were still unknown in the first public
  recheck. These are observed answers, not counts of newly learned revisions.

## 2026-09-30 — Completion replay changed unspecified vendor context

- Public replay exposed three internal completions still unknown to an OS-only
  Linux request. Read-only probes at limits 3 and 5 reproduced the difference:
  an omitted vendor resolves to NULL; the stored display label `Not specified`
  resolves to a real legacy vendor/OS and falsely accepts a tc NAT configuration
  for reverse-path-filter inspection. Public intake correctly reopens the gap.
- Correction: reconstruct replay context without the display-label vendor.
  Preserve explicit nulls rather than filling them with diagnostic guesses;
  retain diagnosis fallback only for keys absent from older stored rows.
  Read intents include identify/determine/compare and require an actual reading
  command/procedure. Domain-pack RPF aliases and XDP constraints reject unrelated
  forwarding/configuration evidence. Migration 047 rechecks potentially affected
  demand completion metadata without changing published knowledge revisions.
- Validation: 343 tests and 250 evaluation fixtures passed on a fresh database,
  plus type checks and network-pack validation. The context integration test
  includes a real placeholder vendor and conflicting diagnostic guesses.
  Execution fixtures now hold the scheduler advisory lock to isolate model/
  capacity checks from unfinished learning fixtures; all lease, drain, profile,
  fallback and pause checks remain enabled. History-batch testing inspects the
  reserved evidence instead of relying on identical transaction timestamps.
  `aaa1b687fea7dfde268f3a13576fe783b59e59b7` deployed through the production
  script at 23:55 UTC; migration 047 and all smoke checks passed. Read-only
  replay of the three Linux demands now retains NULL vendor and returns unknown,
  matching public queries; the NAT configuration no longer satisfies RPF.
- Final acceptance, 23:56–23:58 UTC: all 20 public requests returned HTTP 200;
  1 complete (new Junos revision created 23:02:37 UTC, official documentation,
  minimum 25.1R1), 19 unknown with durable priority learning. All 20 diagnoses
  completed, no orphan diagnosis; cohort 1 published/9 processing/10 queued.
  Eight actual executors used selected gpt-6-luna low/medium; capacity/settings
  retained. Latest-release progress by 23:57:59: 9 analyses, 9 verifications,
  7 publications, 34 Fidelity passes and 6 repairs. Worker restart count zero
  and no warning/error in its new acceptance window. Public stats refreshed at
  23:57:42, stale=false; missing-context status explicitly requires clarification
  and creates no research task. Daily pricing cache has 13 models and no error.
- Limits: these short windows and interrupted experiment do not establish an
  end-to-end latency SLA or extended soak. The complete Junos public answer's
  asynchronous Fidelity task remains queued, so do not count it as audit-passed.
  Existing source access, incomplete domain coverage and historical audit backlog
  remain visible; successful publication is not proof that all knowledge is sound.

## 2026-09-30 — Knowledge quality and 20-question learning audit

- Evidence/report: [learning audit](../reports/2026-09-30-learning-audit/REPORT.md),
  with SQL, raw receipts, per-question CSV and executed notebook. Baseline active
  knowledge 351110; 3753/294292 candidate-backed active revisions Fidelity-passed;
  no new extract-fidelity checks after September 7. Missing provenance is legacy.
- Experiment 15:50:49–16:35:38 UTC: 20 genuine unknown MCP requests; five completed
  diagnoses, 15 demands with no diagnosis task; all 20 still unknown after
  42.427–43.855 minutes (also unknown at the 22-minute checkpoint). First diagnosis
  13.102 s. One internal published replay
  reused OSPFv3 priority for an EVPN DF question, so it is not a learned answer.
- Causes: live `pipeline_tasks_single_diagnosis` returns NULL globally;
  `queueDemandDiagnosisWork` excludes orphan queued demands. Source reuse selects
  same-target documents without positive relevance. `queueSourceWork` exits on
  terminal sources before Fidelity; stale stats refresh reports query timeout.
- Required correction: normal migration plus orphan reconciliation, semantic
  replay/relevant source reuse, source-independent Fidelity audit, stats refresh
  optimization. Preserve per-item leases/deduplication and selected 1–8 capacity.
- Deployment/correction: none; live application remains `04ddae1`. Settings and
  services unchanged. This measured failure is not a clean soak baseline; apply
  root-cause fixes, then repeat the experiment and start a fresh read-only soak.

## 2026-09-30 — Configurable execution and obsolete local runtime

- Before deployment: production `b48d745` services healthy, enabled/8, no running
  agent tasks, one fresh executor heartbeat; PostgreSQL `jit=off` preserved.
- Cause: local unified pool was unregistered; two legacy standalone executors
  remained on Node 20 and configured Codex path no longer existed.
- Correction: versioned profiles/capacity with atomic reservations, model-scoped
  circuits and Fidelity identity; authenticated runtime catalog and dated official
  prices; pinned Node 24 launchd pool, retire legacy executors through the normal
  deployment workflow. Corrected ignored Codex path and env mode to `0600`.
- Deployed clean `main` commits `d1ed0bb0283c484f92474071a9c2039ca53c225d`
  then `04ddae1ea2de7e935e452cdd38bfbd500dd9e873`, both through the production
  script with backup, migrations, grants, Linux build and smoke checks.
- Additional role check found missing admin column privileges for model retry
  and cold Fidelity-profile creation. Corrected only required UPDATE/INSERT
  columns; regression executes settings/retry/profile queries under the actual
  `clideck_mcp_admin` role rather than the fixture's PostgreSQL owner.
- Validation: typecheck/build passed; 323 tests and 250/250 evaluations passed,
  dangerous false-safe count zero. Desktop/mobile browser checks covered model
  selection, capacity save and readonly production demo without console errors.
- Real production web canary: admin-selected `gpt-6-luna`/low, capacity 1,
  `source_discovery` completed in 19,006 ms with accepted structured output.
  Run snapshot retained `luna`, settings version 2 and the selected model.
- High acceptance used a disposable database because no High task was eligible
  in production: admin API → real bridge/lease/coordinator → authenticated Codex
  `gpt-6-luna`/medium → accepted `demand_diagnosis`, 10,364 ms. This verifies
  execution/routing, not comparative model quality or production High ingestion.
- Live capacity reduction 8 → 2 preserved existing runs; after draining, two
  active runs used the new version. Pause terminated both Codex processes
  4,923 ms after API acknowledgment; retry API accepted under the admin role.
  Original profiles/capacity were restored and Resume enabled the pool.
- At 06:06 UTC: all eight coordinator heartbeats observed; completed production
  runs continued, only the intentional Pause cancellations in the sample.
  Health/readiness/admin Models/demo Models returned 200; settings/models/
  Overview reads took 192/73/2,624 ms. Catalog/pricing refresh had no error;
  official Standard-credit rates refreshed at 06:05:08Z. PostgreSQL `jit=off`;
  no structured service error in the 05:47–06:06 UTC sample.
- Restart the read-only soak from this baseline. Extended observation and
  Cisco/Akamai recovery remain unproven; no default model change was made.

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
