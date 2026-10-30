# Pipeline corrective action log

Read before pipeline changes/monitoring or production grant reconciliation.
Repeated soak failure requires a root-cause code/schema/grant/config correction;
a restart alone is not a fix. Add evidence → cause → minimal correction → deployed
SHA (or configuration-only status) → measured result, then restart the read-only
soak. A clean baseline is not a completed extended observation window.

## Handoff as of technical discovery context correction, 2026-10-30

Live application: `a95b0bc9752d78f4ac1a863a36f4bf3ba517aa3b` on
`100.116.82.78`, deployed through `ops/scripts/deploy-production.sh`.
Pipeline enabled, capacity 8. Operator settings version 8 use `gpt-6-luna`
low/medium, High fallback `gpt-5.6-terra` medium; unchanged at this acceptance.

- **Technical discovery, October 30:** the 13:02/13:03 UTC slices confirm repeated
  discovery without new evidence for the original Node/Hugging Face questions.
  Node discovery incorrectly reports missing Node.js 27.0.1 documentation, although
  27.0.1 is the requested macOS version. Leased discovery retains only the legacy
  version envelope; technical answer tasks already receive separate OS/component
  dimensions. The correction adds that existing normalized scope to leased technical
  demand context and explains its use in discovery. Two regressions fail before
  the change; 73 focused tests pass after it. Canonical deployment passed 423
  tests/250 evals and all smokes; four services switched at 13:53:33 UTC and the
  local pool restarted afterward. At 13:57:12 UTC all eight executors were fresh,
  with seven valid/no expired leases, 47 completed AI runs and one completed
  publication since switching. A real discovery lease carries requested_context.
  Neither original question is closed; their next post-switch discoveries have
  not completed in this short acceptance. New read-only baseline: October 30
  13:57:12 UTC, not an extended soak.

- **Publication history, October 28:** repeated full candidate-history scans
  exhausted publication retries. Migration 053 adds the published-origin index;
  the same read-only production query now takes 14.957 ms instead of exceeding
  eight seconds. Canonical deployment passed 421 tests/250 evals. In the saved
  failed batch, 40 records published and ten returned to quality review; all 19
  historical-run counters match actual published totals. At 10:28:07 UTC eight
  executors were fresh, with seven valid/no expired leases, 78 completed AI runs
  and seven completed publications since switching. One follow-up demand
  reconciliation timeout did not recur in the confirming fresh slice. Original
  Node/Hugging Face replays remain partial; the prepared-source backlog without
  live work was zero in the initial slice. New read-only baseline: October 28
  10:28:12 UTC; this is not a completed extended soak.
- **Prepared evidence, October 27:** the urgent analysis source scan let sources
  without available fragments occupy its LIMIT 16 and hide prepared user
  evidence. Eligibility now precedes that limit. Canonical deployment passed
  420 tests and 250 evals. Three sampled prepared sources completed analysis;
  additional batches and candidate verification advanced. At 04:55:17 UTC all
  eight executors were fresh, with eight valid/no expired leases and 61 completed
  AI runs since switching. The two oldest sources and the wider backlog were
  still open at that acceptance; exact Node/Hugging Face replays remained partial. Five bridge
  heartbeat-write timeouts clustered at pool startup; the confirming fresh log
  slice has none. New read-only baseline: 2026-10-27 04:55:32 UTC, not an extended soak.
- **Runtime recovery observed, October 24:** the 03:06 and 09:09 UTC slices have
  796 and 892 successful AI runs in 30 minutes, respectively; the earlier
  background Codex failure is no longer present in these slices. No runtime
  replacement, restart or application change was made by this monitoring run;
  the recovery cause is unestablished. Both exact questions remain partial,
  although new drafts/reviews and evidence windows now advance. This is not
  complete question closure or a completed extended soak.
- **Failure persistence, October 24:** retry prefixes could overflow the event
  message constraint and roll back failure/lease updates. Final event text is
  now bounded at insertion; full bounded task diagnostics and existing retry
  limits remain intact. Canonical deployment passed 418 tests and 250 evals.
  At 09:54 UTC all eight lanes were fresh, with valid/no expired leases and
  thirteen completed AI runs. No fresh event-constraint errors were observed;
  a natural long-message retry has not yet occurred in this short slice.
- **Prior runtime blocker, October 22:** services and leases remained healthy, but real
  AI completions stopped at 18:56:13 UTC. At 20:58 and 21:17, every finished
  recent AI run failed with CODEX_PROCESS_FAILED (55 failures/no completions in
  each 30-minute slice). A controlled CLI run in the pool's bootstrap context
  fails configuration loading with "Failed to synchronize managed preferences
  (code -32600)"; the same runtime/model/schema/payload works from the active
  app context. Bundled 0.163.0-alpha.10.2 and standalone 0.163.0/0.162.0 reproduce
  the bootstrap error. No replacement was activated, management settings were
  not bypassed, and no restart/deployment was used. See evidence and limits
  below. Its failed observation window is historical; the October 24 snapshots
  above establish renewed execution, not a root-cause runtime correction.
- **Learning, October 20:** metadata-contract and mixed private/public evidence
  corrections and the repeated-item publication correction remain deployed.
  Current canonical deployment passed 418 tests and 250 evals. Exact Node and
  Hugging Face replays return partial procedures; macOS 27.0.1 applicability and
  installed library versions are not inferred. The check prioritizes actual
  question closure, repeated discovery and stalled sources, including software
  questions. Repeated-item publication acceptance remains valid, with worker
  identity UPDATE still denied.
  The October 19 claim-order correction is now deployed: all six sampled old
  ready user-gap tasks were claimed; three completed in the first snapshot.
  Both exact original-question/context replays remain partial, not closed.
  The October 20 correction now lets prepared evidence precede empty repeated
  discovery at the same effective priority. All six sampled tasks still waiting
  at switch were claimed: five completed and one is in a bounded artifact retry.
  At 21:28:54 UTC analysis, verification, deep review and technical work use all
  eight lanes. The ready-source backlog remains open; this short result proves
  selection/completion progress, not durable backlog reduction or question closure.
- **Storage, October 19:** owner replaced per-copy approval with automatic
  retention after successful deployment: one daily and one deployment backup,
  current/previous application releases only. Canonical cleanup removed fourteen
  daily archives, eight old deployment directories and nine old releases, after
  the separately approved 266de23 preflight removal. Free space is now about
  148 GiB (39% filesystem use), versus 8.3 GiB before; backup storage is about 20 GiB.
  Future routine rotation under this policy needs no new per-copy approval.
- **Executor recovery:** October 1 expired-lease/scheduler correction remains
  deployed; October 9 checked-out PostgreSQL client error handling is now deployed.
  At October 20 21:28:54 UTC all eight lanes were fresh, with eight valid leases
  and zero expired; nineteen AI runs completed successfully since switching
  (one artifact rejection is retrying). Health/ready, four
  services and canonical API/admin/MCP smokes passed. The read-only window
  restarted at 2026-10-20 21:28:54 UTC and later failed the October 22 runtime
  criterion. The new post-correction read-only baseline is October 24 09:54:48
  UTC; this is a short baseline, not an extended soak or validation of the entire
  knowledge base.
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





## 2026-10-30 13:02 UTC — Discovery confuses the requested OS version with Node.js

- Initial compact slice: live 470bff4279bce34cecf13a193979353b249bdeac,
  health/ready and four services active with NRestarts=0, eight fresh executors,
  seven valid/no expired leases, settings enabled/version 8/capacity 8. In 30
  minutes 964 AI runs, 47 candidate publications, six technical drafts and six
  independent reviews completed, but no original question reached complete replay.
  There are 127 empty discoveries out of 134 and two prepared sources without
  live work. Fresh errors are nine intermittent Gateway Timeouts; no new internal
  event-constraint or publication-counter failure is present.
- One scoped confirming slice at 13:03 UTC shows the latest six discoveries for
  the two stable demands all inserted/reused no evidence. Node's 07:19 and 12:10
  results explicitly seek Node.js v27.0.1 documentation. The original question,
  canonical diagnosis and stored context identify macOS 27.0.1, not that Node
  version. The leased discovery payload has context.version and a coverage target
  version_branch but lacks the separate requested_context used by answer tasks.
- Minimal correction: reuse technicalRequestScope when leasing a technical demand,
  retaining the original question/raw context and adding normalized OS/component
  fields. Discovery instructions prohibit transferring OS versions to components;
  an unspecified component version remains unspecified. Network payloads keep their
  existing shape. No claims, models, capacity, Pause, dedupe, retries, publication
  thresholds, provenance or immutable revisions change.
- Two regression cases cover the legacy macOS version and explicit separate Node
  version. Before the correction two fail/52 pass; afterward all 73 focused
  product-feature/demand-intelligence tests pass. The network lease test also
  asserts that the technical scope is absent. Canonical Node 24 deployment passed
  423 tests (344 root, 32 domain, 47 admin), 250 evals, type checks, local/Linux
  builds, normal migration/grant/reconciliation/index/stats and API/admin/MCP
  smokes. Deployed SHA: a95b0bc9752d78f4ac1a863a36f4bf3ba517aa3b. Four services
  switched at 13:53:33 UTC; the deployer restored settings and restarted Luna.
- Validated pre-switch dump: deploy-20261030T130805Z-a95b0bc,
  clideck-mcp-20261030T130806Z.dump, 11,270,593,216 bytes, with checksum. Canonical
  retention removed the obsolete 470bff4 deployment backup and 76d2df3 release,
  retaining one daily/one deployment backup and current/previous application
  releases. Free space is 138 GiB. No manual production mutation or extra restart
  was used.
- Acceptance at 13:57:12 UTC: health/ready good, four services active/NRestarts=0,
  eight fresh executors (oldest 15 seconds), seven valid/no expired leases,
  settings enabled/version 8/capacity 8, worker knowledge-item UPDATE still denied.
  Since switching 47 AI runs completed, including one publication, seven fragment
  analyses, two verifications, 32 deep reviews, six discoveries and one diagnosis.
  Fresh post-switch error slices are empty. Discovery lease
  ac76514a-6697-42fd-9413-38ec497d5f01/settings version 8 contains normalized
  requested_context; the exact macOS/Node version cases are covered by regression.
  The two stable demands remain queued for subsequent discovery at this
  acceptance; no post-switch source-selection result is claimed for them.
- The evidence-window check shows different fragment IDs/hashes being visited,
  not proof of repeating the same leased span: Node has 112 windows and Hugging
  Face 63. Review correctly rejects unrelated Node error-reference sections and
  an Apple JavaScript-only page. This correction addresses the demonstrated
  version confusion; it does not establish that discovery now finds all missing
  guidance or remove the need for private heartbeat, traceback, version and
  timestamped network evidence. Exact public replays remain partial at
  ca5d3c42-c9ef-4bc7-a02d-64a6795ccad7 / d84279a6-e30e-4c7c-a345-c63e4809614b.
  Restart the read-only observation window at 2026-10-30 13:57:12 UTC. This is a
  short acceptance, not an extended soak or proof of complete original-question
  learning.

## 2026-10-28 09:30 UTC — Publication history recount exceeds the worker deadline

- Compact slice: live 76d2df37d7203b1a11b2f291ea8c0cf50238a4ab,
  health/ready and four services healthy with NRestarts=0, eight fresh executors,
  eight valid/no expired leases, settings enabled/version 8/capacity 8. There
  are 764 completed AI runs in 30 minutes, ten technical drafts/nine independent
  reviews and no ready user source without work. Original Node/Hugging Face
  replays remain partial with explicit incident-specific missing evidence.
- Publication is degraded despite continuing analysis/review: eleven publication
  tasks reached terminal PIPELINE_MECHANICAL_FAILURE in 30 minutes, versus 45
  completed. Initial fresh logs have 28 deterministic query timeouts; one
  confirming slice has 31 since 09:15. Task e732bf39-c611-45a7-aea9-72945850e92a
  exhausted its five attempts with a 50-candidate payload. Scoped worker stacks
  identify the UPDATE agent_runs published_revisions recount, not revision
  creation or the publication policy. No stuck expired lease was observed.
- Cause: the correlated published-candidate count has no index on its origin.
  Open-candidate and pending-Fidelity indexes cannot serve published history.
  Production EXPLAIN shows a full knowledge_candidates sequential scan for each
  matching historical agent run; the same read-only SELECT exceeds an eight-second
  server timeout without row writes or row locking. Repeated recounts can
  exceed the unchanged ten-second worker query deadline and roll back activation.
- Minimal correction: migration 053 adds a partial index on
  knowledge_candidates(pipeline_task_id) WHERE status='published'. Application
  queries, counters, immutable revisions, provenance, grants, retry bounds,
  publication validation, models, all eight lanes and operator Pause are unchanged.
- PostgreSQL 16 regression uses a 50-origin mixed publication batch, retry history,
  10,000 historical candidates and the worker role. Before the index, the recount
  discards 7,840 unrelated published rows on every origin scan (one failed/eight
  passing tests). With the migration all nine publication/search/recovery tests
  pass, without unrelated-history scans; each of 51 matching historical runs has
  the correct 160 published records and an unrelated run retains its count of 99.
  Fixtures are isolated and rolled back; production data was not changed.
- Clean-main Node 24 canonical deployment passed all 421 tests, 250 evals, type
  checks, local/Linux builds, migration 053, normal grants/reconciliation/index/
  stats and API/admin/MCP smokes. Deployed SHA:
  470bff4279bce34cecf13a193979353b249bdeac. Four services switched at
  10:22:39–59 UTC; the deployer restored settings and started the local pool.
- Validated pre-switch dump: deploy-20261028T094025Z-470bff4,
  clideck-mcp-20261028T094025Z.dump, 10,755,587,709 bytes, with checksum.
  Canonical retention removed the obsolete 76d2df3 deployment backup and bc7b416
  release. One daily/one deployment backup and current/previous releases remain;
  free space is 140 GiB. No additional storage approval was needed.
- The identical read-only production SELECT now uses
  knowledge_candidates_published_origin_idx (index-only scan), completing in
  14.957 ms for the saved 50-candidate/19-origin batch, versus the eight-second
  timeout before migration. No worker deadline was raised. Before the fix all
  50 candidates were verified and reserved, with 40 existing immutable revisions.
  At 10:25:39, 40 were published and ten deferred to deep review by ordinary
  validation; no manual retry, data edit or validation bypass was used. At
  10:28:07 all 19 historical-run counters match their actual published totals.
- Acceptance at 10:28:07 UTC: health/ready good, four services active with
  NRestarts=0, eight fresh executor heartbeats (oldest 51 seconds), seven valid/
  no expired leases, settings enabled/version 8/capacity 8, worker knowledge-item
  UPDATE still denied. Since switching 78 AI runs and seven publications completed;
  analysis, verification, independent deep review, diagnosis, discovery and one
  technical draft/independent technical review advanced. One artifact rejection
  remains subject to the existing retry bounds. Neither stable original question
  is closed by those completions.
- Exact original-question/context replays remain partial at b76b7068/d84279a6.
  Node still lacks incident timestamps, error stacks, executor/server evidence
  and project source/configuration; Hugging Face still lacks exact macOS and
  component versions, timestamped failures and read-only endpoint observations.
  Generic applicability is not evidence of the requested OS or installed component
  version. No private incident cause or complete workflow is claimed.
- A single timeout occurred at 10:25:29 in reconcilePublishedKnowledgeDemands,
  after the publication transaction had committed. Its stack is distinct from the
  corrected counter query. The confirming fresh slice from 10:25:30 through
  10:28:07 has no errors; no speculative follow-up change or extra restart was
  made. Restart the read-only observation window at 2026-10-28 10:28:12 UTC.
  This short acceptance is not a completed extended soak.

## 2026-10-27 03:24 UTC — Empty analysis sources hide prepared user evidence

- Initial compact slice: live bc7b416e6fde4f0b5c8413603208f829eebd048e,
  health/ready and four services healthy with NRestarts=0, eight fresh executors,
  eight valid/no expired leases, settings enabled/version 8/capacity 8. About
  821 AI runs completed in 30 minutes, but 307 ready user sources had no live
  work, versus 228 at October 26 21:22. There were 263 discoveries (249 empty),
  ten technical drafts and ten independent reviews, without complete closure
  of either stable original Node/Hugging Face question. Their replays remain
  partial; incident-specific versions, traces and aligned read-only evidence
  remain missing, with OS applicability separate from component versions.
- One confirming slice at 03:25:39 has 269 discoveries (252 empty) and live
  analysis/review work. Scoped logs show only intermittent GatewayTimeouts,
  without recurrence of pipeline_events_message_check. Prepared source
  95c1129b-5ad8-4dd1-8dfb-477ddb6b0212 has 453 queued/unreserved fragments
  untouched since October 19; 45f3497c-cb2f-4376-bba2-84e907166b15 has 94
  untouched since October 20. These sources have only mechanical task history.
- Cause: queueUrgentDemandWork applies its LIMIT 16 before excluding analysis
  sources with no queued, unreserved fragments. In the matching production
  selection, 15 of the first 16 sources have no available analysis fragments.
  Sources legitimately awaiting candidate review can therefore occupy this
  bounded scan indefinitely and hide prepared evidence outside ordinary source
  lanes. Keeping those sources verifying while review is pending is correct.
- Minimal correction: require an available analysis fragment before the bounded
  source selection; verification eligibility, source/task locking, reservation
  dedupe, finite retries, publication/provenance checks, models, all eight lanes
  and operator Pause remain intact. No quota, cooldown, stage cap or synthetic
  demand is introduced. Existing indexes support the predicate: the read-only
  production SELECT with EXPLAIN ANALYZE completes in 63.209 ms.
- Regression: transaction-isolated PostgreSQL 16 fixtures keep the ordinary
  source lane occupied and place zero/sixteen legitimate review-only sources
  ahead of prepared user evidence. The sixteen-source case fails before the
  correction (one failed, fifty passed); all 51 urgent-learning and technical
  demand tests pass afterward. Existing reservations and unresolved review
  candidates are preserved. Production data was not altered by these tests.
- Deployment waited for the scheduled daily backup (started 03:25:38 UTC) to
  finish successfully, without competing pg_dump processes. Clean-main Node 24
  canonical deployment passed all 420 tests, 250 evals, type checks, local/Linux
  builds, normal grants/reconciliation/index/stats and API/admin/MCP smokes.
  Deployed SHA: 76d2df37d7203b1a11b2f291ea8c0cf50238a4ab. Four services switched
  at 04:49:09–10 UTC; the deployer restored settings and the local pool.
- Validated pre-switch dump: deploy-20261027T040753Z-76d2df3,
  clideck-mcp-20261027T040753Z.dump, 10,456,705,741 bytes, with checksum.
  Canonical retention removed the obsolete bc7b416 deployment backup and f86a217
  application release. One daily/one deployment backup and current/previous
  releases remain; free space is 142 GiB. No new storage approval was needed.
- Acceptance at 04:55:17 UTC: health/ready good, four services active with
  NRestarts=0, eight fresh executor heartbeats (oldest three seconds), eight
  valid/no expired leases, settings enabled/version 8/capacity 8, worker
  knowledge-item UPDATE still denied. Since switching, 61 AI runs completed;
  two artifact rejections remain bounded by ordinary retries. Completed work
  includes eleven analyses, eight verifications and thirty-four deep reviews.
- Three of the eight prepared-source samples (21f7ca4d, 9eb48d2a, 2530beee)
  completed their first post-switch analysis by 04:54:27; candidate verification
  and subsequent batches advanced. Two further samples (daa7a5ca, 0e843e2f)
  received queued analysis. The October 19/20 examples still await work.
  The learning aggregate at 04:54:32 has 336 ready sources without live work;
  this short result proves eligibility/claim/completion progress, not durable
  backlog reduction or complete resolution of every old demand.
- Both exact original-question/context replays remain partial at unchanged public
  revisions b76b7068/d84279a6. Node still needs actual Node/Tailscale versions,
  timestamped client/server and heartbeat evidence, plus application timeout and
  retry semantics. Hugging Face still needs exact installed component versions,
  invocation/repository/revision, trace and aligned route/DNS/HTTPS observations;
  learning metadata was temporarily unavailable on its replay. No macOS or
  component version is inferred and neither question is closed by this fix.
- Five researcher-bridge heartbeat upserts timed out together at 04:53:37–40
  around pool startup. The single confirming log slice from 04:53:41 through
  04:55:17 has no new errors; no restart or speculative correction was made.
  No pipeline_events_message_check error recurred. Restart the read-only window
  at 2026-10-27 04:55:32 UTC; this acceptance is not a completed extended soak.

## 2026-10-24 09:09 UTC — Long retry event rolls back failure persistence

- Compact slice: live f86a21775b556f513606b91b6fd87199645024a9,
  health/ready good, four services active (restart counters 0/2/0/0 unchanged),
  eight fresh executors, eight valid/no expired leases, settings enabled/version
  8/capacity 8. In 30 minutes 892 AI runs completed; 32 technical drafts,
  32 independent reviews and five technical publications completed. Prepared
  user sources without work declined from 207 at 03:06 to 177. Exact Node/Hugging
  Face replays remain partial; evidence windows advanced from 85/37 to 87/39,
  with current explicit missing public and incident-specific evidence. OS and
  component versions are not inferred from each other.
- Four source-conversion tasks failed with PIPELINE_MECHANICAL_FAILURE in the
  preceding 30 minutes. One confirming slice at 09:10 and scoped worker logs
  show repeated PostgreSQL 23514 pipeline_events_message_check errors in
  failPipelineTask. Representative tasks 6e596b7f/d00ead8c contain 1,000-character
  converter failures; malformed/non-PDF input is still rejected by pdftotext.
- Cause: the bounded failure message receives the 29-character retry prefix
  after input validation. Inserting the resulting event exceeds the existing
  1,000-character constraint, rolling back the entire failure transaction and
  retaining the running lease until recovery. At attempt five the prefix is
  absent and terminal failure can persist. This is a failure-bookkeeping defect,
  not evidence that the underlying source document is valid.
- Minimal correction: bound the final display message to 1,000 PostgreSQL
  characters at recordEvent insertion. Full bounded task failure text and event
  failure-code metadata remain intact; schema constraints, source rejection,
  five-attempt retry bound, leases, settings, models and operator Pause remain
  unchanged. No source-format or publication-policy workaround is introduced.
- Validation: real PostgreSQL 16 regressions with worker-role grants reproduce
  the failure at attempts one/four before the correction (two failures, five
  passing tests); all seven recovery tests pass afterward, including terminal
  attempt five and an unchanged short message. Canonical Node 24 clean-main
  deployment passed all 418 tests, 250 evals, type checks, local/Linux builds,
  normal reconciliation/index/stats/grants and API/admin/MCP smokes.
- Deployed SHA: bc7b416e6fde4f0b5c8413603208f829eebd048e. Services switched at
  09:52:04–05 UTC; the deployer restored settings and restarted the local pool.
  Full validated pre-switch dump: deploy-20261024T091433Z-bc7b416,
  clideck-mcp-20261024T091433Z.dump, 9,820,295,998 bytes, with checksum. Automatic
  retention removed the obsolete f86a217 deployment backup and 1e62f00 release;
  current/previous releases and the one-daily/one-deployment policy are preserved.
  Free space is 145 GiB; no storage approval was needed.
- Acceptance at 09:54:01 UTC: health/ready good, four services active with
  NRestarts=0, eight fresh heartbeats (oldest five seconds), eight valid/no expired
  leases, settings enabled/version 8/capacity 8, worker knowledge-item UPDATE
  still denied. Thirteen AI runs completed since 09:53:30, including fragment
  analysis, deep review, diagnosis, discovery and two technical drafts. Both
  exact original-question/context replays remain partial at unchanged public
  revisions b76b7068/d84279a6; this does not close either question.
- At 09:54:48 UTC scoped service logs have no new error entries and zero
  pipeline_events_message_check violations. No natural failed/retried event has
  occurred after the switch yet: the maximum-length retry path is verified by
  the worker-role PostgreSQL regressions, with live recurrence still to observe.
  Restart the read-only observation window at this timestamp; do not call this
  short acceptance a completed extended soak.

## 2026-10-22 20:58 UTC — Background Codex execution blocked; no project correction established

- Initial compact slice: health/ready good, API/admin/researcher active with
  NRestarts=0, worker active with the previously observed NRestarts=1, no fresh
  error-priority service journal entries, eight fresh heartbeats and eight
  valid/no expired leases. Settings remain enabled/version 8/capacity 8. Live
  application is still f86a21775b556f513606b91b6fd87199645024a9; free space 146 GiB.
- Learning is stopped despite healthy executors: 55 failed AI runs and zero
  completions during the initial 30-minute slice; the confirming five-minute
  slice also has only CODEX_PROCESS_FAILED failures and eight active runs.
  Representative low/medium gpt-6-luna runs exit 1 after about 222–223 seconds
  with zero reported input/output tokens. At 21:17:15 UTC the preceding 30
  minutes still have 55 failures/no completions; last successful AI completion
  is 18:56:13.320010 UTC. There are 114 ready user sources without live work.
  No model circuit is open. Account limit read reports ordinary usage allowed
  and 5% weekly usage; no reset or credit operation was performed.
- Two exact original-question/context replays remain partial with unchanged
  b76b7068/d84279a6 revisions and explicit missing public/private evidence.
  Node has 85 evidence windows; Hugging Face has 37. No question is closed by
  executor heartbeats, publication counts, or the diagnostic probes.
- Controlled foreground diagnostics use the existing binary, policy arguments,
  environment allowlist, gpt-6-luna low/medium, a copied output schema and one
  already leased payload. They succeed, including the executor working folder.
  No probe claims a pipeline task, submits an artifact, creates a synthetic
  demand or changes production data. Raw task/source text and credentials are
  not retained in the diagnostic logs.
- A foreground diagnostic executed with `launchctl bsexec` in the existing
  coordinator's bootstrap context fails before inference: "Error: thread/start:
  thread/start failed: failed to load configuration: Failed to synchronize
  managed preferences (code -32600)". The default bundled CLI is
  0.163.0-alpha.10.2. The same error reproduces with the no-daemon flag and
  temporary official standalone 0.163.0 and 0.162.0 binaries. The latter were
  compatibility probes only and were not activated. The host reports no DEP/MDM
  enrollment; the standard system requirements/managed-config files and checked
  com.openai.codex managed-preference plists are absent.
- Scope and uncertainty: the bootstrap configuration failure is reproducible;
  it narrows recovery to the host/Codex runtime integration. Existing run records
  retain exit codes and diagnostic fingerprints, not the raw child error, so
  the bootstrap probe is not a verbatim capture of a failed production child.
  A specific application-code correction has not been established. Official
  [non-interactive documentation](https://learn.chatgpt.com/docs/non-interactive-mode)
  documents the controlled CLI flags and JSONL errors; official
  [managed-configuration documentation](https://learn.chatgpt.com/docs/enterprise/managed-configuration)
  confirms that managed requirements must remain effective. No policy bypass,
  alternate auth, model change, global queue blocker, Pause change or unproven
  restart was applied. Temporary standalone packages were removed after probing.
- Result: unresolved runtime/configuration blocker, not a successful correction.
  No application deployment or new soak baseline; the read-only window has
  failed the AI-completion criterion. Recover background Codex configuration
  synchronization, then verify fresh leases and actual original-question
  learning progress before claiming recovery. Keep original model settings and
  all publication/provenance checks intact.

## 2026-10-20 20:40 UTC — Empty discovery repeats delay prepared user evidence

- Health/ready and all four services are healthy (NRestarts=0); capacity remains
  8, with eight fresh executor heartbeats and eight valid/no expired leases.
  Nevertheless, 241 of 245 discoveries completed in the preceding 30 minutes
  added no sources, reused fragments or reopened candidates. Only five fragment
  analyses and two verifications completed; no real question closed. Prepared
  user sources without live work increased from 296 at 02:26 to 410 at 20:40.
  Both stable original Node/macOS and Hugging Face replays remain partial.
- One confirming snapshot at 20:40:55 shows all eight lanes doing discovery,
  while eight ready unresolved-user analyses, six verifications and sixteen deep
  reviews wait. No model circuit is open. This is distinct from the earlier
  host-sleep lease expirations, whose sampled tasks recovered without a restart.
- Cause: empty repeated discovery and prepared evidence share effective demand
  priority 160; creation time lets the older discovery backlog repeatedly win.
  Four PostgreSQL regressions reproduce analysis, verification, deep-review and
  technical-review starvation before the correction. Only the latest completed
  discovery determines progress; an older empty search does not demote a later
  productive one.
- Minimal correction: within the same demand/effective-priority tier, a search
  whose latest completed attempt added no evidence yields to other ready work.
  First searches and searches that added a source, reused fragments or reopened
  candidates retain age ordering. No stage cap, cooldown or quota is added;
  repeats still fill all eight lanes when they are the only ready work. Migration
  052 indexes latest completed discovery by demand; claims lock only their task
  row with SKIP LOCKED. Models, settings, leases, bounded retries, provenance,
  publication quality and operator Pause are unchanged.
- Validation: eight new regressions (four fail before/four already pass), all
  49 technical/urgent integration tests, full 414 tests and 250 evals pass against
  isolated PostgreSQL 16 with production grants. Canonical clean-main deployment
  repeated all ordinary gates with Node 24 and completed successfully at
  f86a21775b556f513606b91b6fd87199645024a9. Full pre-switch dump:
  deploy-20261020T204950Z-f86a217, 9,493,138,862 bytes, archive/checksum validated.
  Migration 052, grants, reconciliation/index/stats, Linux/local builds and all
  API/admin/MCP smokes passed. Services switched at 21:25:30–31 UTC; the local
  Luna pool restarted through the deployer. Automatic retention kept this one
  deployment backup and daily clideck-mcp-20261020T032202Z.dump; obsolete history
  rotated successfully. Free space remains 148 GiB; no storage approval needed.
- Acceptance at 21:28:54 UTC: settings enabled/version 8/capacity 8 unchanged,
  eight fresh heartbeats (oldest five seconds), eight valid/no expired leases,
  four services active/NRestarts=0, health/ready good, no fresh service error
  entries. Worker identity UPDATE remains denied. Nineteen AI runs completed;
  one AGENT_ARTIFACT_REJECTED run is in the existing bounded retry path.
  Post-switch completed work includes one fragment analysis, eight deep reviews,
  three technical drafts, five independent technical reviews and one candidate
  publication. Current lanes: two analyses, two verifications, two deep reviews,
  one technical draft and one technical review. The sole completed discovery
  added evidence; no completed empty repeat appears in this short window.
- Eight task IDs were sampled before deployment: two completed on the old
  version before switching and are excluded from correction evidence. All six
  still waiting at switch were claimed by the new version; five completed and
  one technical review is running attempt 2 after artifact validation rejection.
  This verifies actual evidence processing rather than heartbeat activity.
  Ready sources without live work remain 436, versus 424 immediately after pool
  startup; sustained backlog reduction is not established by this short slice.
- Exact original Node/macOS 27.0.1 and Hugging Face questions/contexts still
  replay partial with unchanged revision refs b76b7068 and d84279a6. Missing
  public capabilities and case-specific versions, invocation/error/heartbeat
  logs and aligned host/network evidence remain explicit. Neither question is
  closed. Restart read-only observation at 2026-10-20 21:28:54 UTC; this is not
  an extended soak or a validation of the whole knowledge base.

## 2026-10-19 — Automatic backup retention and learning fairness deployed

- Owner approved deletion of deploy-20261017T055739Z-266de23 and explicitly
  replaced per-copy approval with automatic removal of obsolete backups after
  a healthy deployment. The earlier requirement to preserve every daily copy
  is superseded by this retention decision; do not ask again for routine history
  rotation under this policy.
- Observed production storage: 250 GiB root filesystem, 232 GiB used and
  8.3 GiB free; /var/backups/clideck-mcp uses 157 GiB, versus PostgreSQL 51 GiB,
  application artifacts 8.7 GiB, releases 3.6 GiB and logs 1.4 GiB. Fifteen daily
  dumps from October 3–17 coexist with deployment history. Cause: independent
  14-day daily and 14-deployment retention, plus eight extra releases beyond
  current/previous; the previous retention boundary needed repeated manual
  space approvals. Abandoned deployment directories also retained a 1.3 GB
  partial dump. Host-migration snapshots account for 2.9 GiB and are preserved.
- New policy: retain one latest daily dump and the pre-switch backup belonging
  to the latest successful deployment; keep current/previous application releases
  only. Validate archive readability and checksums before rotation. Daily backup
  success rotates only daily files; deployment backup history and abandoned
  attempts rotate only after canonical smokes, pipeline-state restoration and
  atomic-link verification. A failed backup/rollout keeps earlier recovery
  points. Strict names, regular paths, symlink exclusions and running-pg_dump
  protection preserve unmanaged/migration data. Full-backup headroom and the
  2 GiB reserve remain mandatory.
- Targeted filesystem regressions cover count rotation, unreadable/corrupt new
  archives, running dump exclusion, symlinks, unmanaged snapshots and rollout
  ordering. Canonical clean-main deployment includes the previously verified
  learning-queue correction 2850ad0 and all ordinary test/build/backup gates.
- Completed: clean main 1e62f00014da18b37fc191596951bf2096a7b3b2 deployed via
  ops/scripts/deploy-production.sh with Node 24. The explicit 266de23 removal
  met ordinary headroom; all 406 tests, 250/250 evals, types, local/Linux builds,
  full backup, migrations/grants/reconciliation/index/stats, API/admin/MCP smokes
  and local pool restart passed. Targeted retention/contract tests: 32 passed.
  Switch: API/admin/researcher 19:03:14 UTC, worker 19:03:18 UTC.
- New completed backup: deploy-20261019T182647Z-1e62f00, dump 9,458,488,330 bytes
  with archive-index validation and verified checksum. After successful smokes,
  automatic retention removed fourteen older daily dump/checksum pairs, eight
  obsolete deployment directories (including the abandoned partial) and nine
  old application releases. Retained exactly this deployment backup, daily
  clideck-mcp-20261017T032238Z.dump (8,847,817,616 bytes), current 1e62f00 and
  previous 395fb50 application releases. Host-migration snapshots preserved.
  Backups use 20 GiB and releases 726 MiB. Filesystem free space increased from
  8,813,137,920 to 159,044,476,928 bytes, about 140 GiB freed; use fell to 39%.
- Acceptance at 19:05:50 UTC: health/ready good, four services active/NRestarts=0,
  eight fresh executors (oldest heartbeat five seconds), eight valid/no expired
  leases, settings enabled/version 8/capacity 8 unchanged, worker item UPDATE
  still denied. No fresh error-priority service entries since switch. Ten AI
  runs completed successfully; new claims include twelve old-priority-160
  discoveries and six urgent-priority-170 diagnoses. All six sampled priority-160
  discoveries created October 18 03:51–03:53 UTC changed from queued/attempts=0
  to attempts=1: three completed without failure and three running. This is real
  progress on previously bypassed work, not just executor activity.
- Exact Node/macOS 27.0.1 and Hugging Face replays retain their original IDs and
  return partial answers, with missing public capabilities and private incident
  context still visible. OS applicability and installed component versions are
  not inferred. Neither question is closed by this acceptance. Restart read-only
  observation at 2026-10-19 19:05:50 UTC; this short snapshot is not an extended
  soak. Routine backup rotation is now automatic; no deployment blocker remains.

## 2026-10-19 02:22 UTC — Technical refills starve older user-gap research and source work

- Health/ready good, four services active with NRestarts=0, settings enabled
  version 8/capacity 8, eight fresh executors and eight valid/no expired leases.
  This does not establish healthy learning: the last 30 minutes completed 77
  technical drafts, 78 reviews and three partial publications, but no fragment
  analysis or ordinary candidate verification/review/publication. 130 of 154
  discovery completions added no evidence, and ready sources without work grew
  to 163. Both original questions remain partial; Node evidence windows reached
  43, while Hugging Face's last completed work is still October 18 19:35 UTC.
- One repeat confirms the specific starvation. Hugging Face has a ready demand
  source_discovery task created October 17 08:00:38 UTC, available since then,
  attempts=0, priority 160 and no context hold. Active work is all priority 165:
  four focused discoveries, two technical drafts, one technical review and one
  mechanical publication. The standard ready queue includes 702 discoveries,
  17 analyses, 56 verifications and 45 reviews at 160. No fresh service errors.
- Cause: a continuously replenished 165 technical/focused-discovery tier always
  precedes other real user learning at 160. An unconditional preference for
  source-bound tasks before task age can also bypass an older discovery after
  priorities are equal. This strands public research even though private incident
  requirements remain correctly visible; it is not an operator Pause or missing
  executor capacity.
- Minimal correction: AI and mechanical claims treat historical demand-stage
  priority 165 at the ordinary user-gap tier 160, then order ready work by age.
  Source-bound work keeps its former preference only for equal-age ties. Initial
  diagnosis urgency 170 and user-gap precedence over background work remain.
  Persisted task metadata, active leases/model snapshots, available_at, dedupe,
  finite attempts, operator-selected 1–8 lanes and Pause are unchanged; no new
  quotas, cooldowns, stage caps or global serial execution were introduced.
- Actual PostgreSQL regressions reproduce all five failures on old code: older
  discovery, analysis, verification, review and acquisition lose to new technical
  refills/publication. Corrected code passes all 41 technical/urgent tests,
  including legacy simultaneous-source behavior, Pause, profile selection and
  background priority. Types, all 399 tests and 250/250 evals pass on a fresh
  migrated/seeded/indexed PostgreSQL 16 fixture with production grants.
  Deployment remains required before declaring the starvation corrected live.
  Correction is committed and pushed as 2850ad0 on main.
- Production remains 395fb500cb735cd8c4a8a7da1eefb0ced1eebe93; no runtime change
  or restart was performed during diagnosis. The read-only window must restart
  after deploying this correction; prior healthy executor snapshots do not prove
  progress on the stranded questions.
- Canonical deploy of clean main with Node 24 and no cleanup selection passed
  sudo authorization but stopped at backup preflight: 8,638,193,664 available
  bytes versus 16,170,547,032 required, BACKUP_INSUFFICIENT_FREE_SPACE, exit 1.
  No backup, migration, grant, switch or restart was attempted. Prior explicitly
  approved cleanup lists have already been consumed and must not be reused.
- Proposed new explicit cleanup: only deploy-20261017T055739Z-266de23,
  8,867,244,281 bytes (about 8.3 GiB). Its completed dump exists and it is outside
  the newest-two protection; current available space plus it meets the ordinary
  headroom check. Preserve every daily copy, October 9, the other October 17
  copy deploy-20261017T072848Z-6a81c23, and both October 18 copies d9bf099/395fb50.
  This is a new retention decision requiring approval, not covered by any
  previous September 30/October 1 cleanup consent. No extra history was deleted.
  Once approved, use only the canonical script with that exact list and all
  normal gates. Verify claims/progress of old queued user-gap work after switch,
  retain original-question/OS/component context and restart read-only observation.

## 2026-10-18 22:24 UTC — Existing-item publication confirmed in production

- One compact read-only check on deployed 395fb500cb735cd8c4a8a7da1eefb0ced1eebe93:
  health/ready good, all four services active with NRestarts=0, settings enabled
  version 8/capacity 8, eight executor heartbeats under 14 seconds, three valid
  leases and zero expired. No error-priority service entries in the last 15 minutes.
- The previously pending live acceptance is now satisfied without synthetic
  demands or manual task resets. Four technical publications completed against
  existing items: demand 6087cfd2-8d31-4075-ab05-ab257794a21e appended revisions
  2, 3 and 4 at 22:13:12, 22:14:16 and 22:16:05 UTC; demand
  e6b5a6a4-c77b-4ca6-8276-62a2e8946ff9 appended revision 2 at 22:23:40 UTC.
  Worker still lacks UPDATE on knowledge_items; no technical publication task
  failed since the switch. This exercises the corrected existing-item path.
- Since 21:55:33 UTC, 607 AI runs, 97 technical drafts and 97 independent reviews
  completed; four technical and 29 ordinary candidate publications completed.
  Retained validation rejected 34 artifacts; one historical run expired, with
  no currently expired leases. All aggregated work uses the demand queue;
  84/127 discoveries added no new evidence, while 44 acquisitions and 41 source
  conversions/chunkings completed. These counts do not establish full answers.
- Exact original-question/context replays retain both cohort IDs and needs_context.
  Node/Tailscale remains unknown for macOS 27.0.1, with the macOS 27 workflow only
  an example; evidence windows advanced from 21 to 25 and source processing is
  current. Hugging Face remains partial at revision cfdd2c81-78a7-4303-823c-bc59d698bd20,
  with HTTPS/Xet and incident-diagnostic gaps plus the same missing private data.
  Neither cohort is closed. The learning aggregate has one complete closure in
  30 minutes elsewhere; do not attribute it to these two questions.
- No runtime code, settings, grants, task attempts or deployment changed during
  this check. The read-only window remains based at 21:56:47 UTC; this roughly
  half-hour observation is not a completed extended soak.

## 2026-10-18 21:59 UTC — Publication correction deployed; short acceptance

- Clean main 395fb500cb735cd8c4a8a7da1eefb0ced1eebe93 deployed through the
  canonical script with Node 24, including 0ef99f0's per-key publication lock
  and the local test-database readiness correction below. All 394 tests,
  250/250 evals, types, local/Linux builds, full backup, migrations/grants,
  reconciliation/index/stats, atomic switch and ordinary smokes passed.
  The script restarted the local Luna pool on this SHA; readlink confirms it.
- The approved 1806409/aaa1b68/cbcd30a directories are absent. October 9,
  both October 17 copies and October 18 d9bf099 are verified present; daily
  copies were outside the cleanup selection. New backup:
  deploy-20261018T212118Z-395fb50, 9,348,708,923-byte completed dump and
  157-byte checksum file, no partial file. About 8.55 GiB remain free.
  This resolves the capacity approval below; do not reuse the consumed list.
- API/worker/admin/researcher active since 21:55:33 UTC, NRestarts=0;
  health/ready good. At 21:59:17 UTC all eight executor heartbeats are under
  30 seconds old, seven leases valid and none expired. Settings remain enabled,
  version 8/capacity 8; no models, operator choices, Pause or task retry limits
  were changed. Worker still has no UPDATE privilege on knowledge_items.
- Since service switch, 75 AI runs completed, two artifacts were rejected by
  retained validation checks, two ordinary candidates published, ten technical
  drafts and ten independent technical reviews completed. Those reviews did
  not approve a candidate; no technical publication was queued/completed in
  this short window, so the existing-item production path is not yet observed.
  The reproduced permission failure is fixed in code and covered by actual-role
  repeat/revision/concurrency regressions. No fresh error-priority service
  journal entries appeared in the first post-switch read. Preserve the live
  repeat-publication acceptance as a follow-up; do not force an approval or
  reset exhausted task attempts just to demonstrate publication.
- Exact original-question replays succeeded through MCP with the same cohort
  IDs and unchanged contexts. Hugging Face is partial with public revision
  cfdd2c81-78a7-4303-823c-bc59d698bd20, "Download selected Hugging Face repository
  files". It supports documented CLI/Python file selection and dry-run usage,
  not HTTPS-only/Xet bypass or macOS Errno 65 diagnosis. Installed client versions,
  timestamped errors and the precise repository/invocation remain required.
- Node/Tailscale exact replay is unknown for macOS 27.0.1. The macOS 27 workflow
  abffed09-0ad6-43db-949a-c6e7b96fe1c7 is returned only as a separate example,
  without inferring applicability to the patch version or component semantics.
  Timestamped Node errors/configuration, executor heartbeat logs/timeouts,
  sleep/wake/network evidence, Tailscale/service logs and exact component
  versions remain visible via needs_context=true. Both demands stay open;
  a partial public document is not complete original-question learning.
- Read-only observation restarts at 21:56:47 UTC after fresh executors returned.
  This is a short post-deployment baseline, not a completed extended soak.
  Canonical output: tmp/publication-lock-deploy-retry.log; repeat-publication
  acceptance: tmp/publication-lock-acceptance.sql with acceptance_since set to
  2026-10-18T21:55:33Z. Future routine checks must track reviewed publication,
  unseen relevant evidence and exact closure rather than agent/database growth.

## 2026-10-18 21:17 UTC — Approved cleanup completed; local preflight readiness race corrected

- The user approved precisely deploy-20260930T230659Z-1806409,
  deploy-20260930T234029Z-aaa1b68 and deploy-20261001T023833Z-cbcd30a.
  Canonical deployment of clean main 571878b removed these three only and measured
  18,417,426,432 available bytes versus 16,131,478,760 required. The capacity
  approval below is resolved; do not reuse this already-consumed cleanup list.
- Types passed, but local test-role creation hit a missing PostgreSQL socket.
  No production dump, migration, switch or restart occurred. Cause: the official
  image starts a temporary socket-only initialization server, which made the
  old socket pg_isready gate succeed before initialization shutdown/restart.
  The [official image entrypoint](https://github.com/docker-library/postgres/blob/master/docker-entrypoint.sh)
  explicitly starts that temporary server with listen_addresses empty.
- Minimal deployment correction: both readiness probes require 127.0.0.1 TCP.
  A controlled PostgreSQL 16 container with a delayed init script reproduces
  socket-ready/TCP-not-ready; the TCP gate waits until initialization completes
  and immediate role creation then succeeds. Shell syntax and all 18 deployment
  contract tests pass. The normal deploy, with no further cleanup selection,
  will rerun every ordinary gate before applying the publication correction.

## 2026-10-18 20:25 UTC — Existing technical item publication fails under worker permissions

- Compact check: health/ready good, four services active with NRestarts=0,
  settings version 8/capacity 8 unchanged, eight fresh executors, eight valid
  leases and zero expired. All recent work is in the demand queue: 159 technical
  drafts, 168 reviews, eight technical publications and 48 discoveries completed
  in 30 minutes; no complete original-question closures. Node is processing a
  subsequent evidence window; Hugging Face remains unresolved with explicit
  source insufficiency and private timestamped traceback/version/invocation gaps.
  Connected MCP calls failed in this monitor's transport, so no new public query
  replay or MCP guidance is claimed; production SQL provides this state evidence.
- A separate runtime aggregate exposed 12 failed technical publication tasks in
  the same interval. One repeat and short worker logs confirm PostgreSQL 42501,
  permission denied for table knowledge_items, in createDomainKnowledgeRevision.
  Successful first publications had hidden the existing-item path: its SELECT
  FOR UPDATE requires UPDATE on at least one column, while the production worker
  intentionally has only SELECT/INSERT on item identity. See the official
  [PostgreSQL privilege rule](https://www.postgresql.org/docs/16/ddl-priv.html).
- Minimal code correction: acquire a transaction advisory lock per stable key
  before item insertion/reuse and revision allocation; remove the existing-item
  FOR UPDATE. This preserves deduplication and serial revision numbers without
  granting identity mutation or restricting unrelated keys/operator lanes.
  Existing revisions, provenance, independent review and finite task attempts
  remain unchanged. [PostgreSQL advisory locks](https://www.postgresql.org/docs/16/explicit-locking.html#ADVISORY-LOCKS)
  release with the publication transaction.
- Regression on isolated PostgreSQL 16 with actual production grants: the old
  code fails both repeat-publication and existing-item revision tests with the
  observed permission error. Corrected tests verify retry reuse, unchanged prior
  revision and appended revision 2; concurrent workers serialize only the same
  key, allow an unrelated publication and release the lock on rollback. Types,
  all 394 tests and 250/250 evals pass on a freshly migrated/seeded/indexed local
  fixture with the production grant matrix. Deployment remains pending below.
  Correction is committed/pushed as 0ef99f0; no branches/worktrees/PRs were created.
- Production is still d9bf09952ef48799d6a958f6aeb5d8edf4cd9758; this is a new
  failed observation, not a clean extended soak. Read-only capacity check found
  7,962,902,528 available bytes; the largest completed dump implies a canonical
  requirement of 16,131,478,760 bytes. No other deploy/dump is running. Additional
  historical backup deletion requires a new exact approval; the previously
  approved three copies are already gone and cannot supply capacity again.
- Clean-main canonical deployment was attempted with Node 24 and no cleanup
  selection. Sudo authorization passed; backup preflight stopped before rollout:
  8,002,711,552 available bytes versus 16,131,478,760 required, exit 1 with
  BACKUP_INSUFFICIENT_FREE_SPACE. No dump, grants, switch or production restart
  was performed. Existing publication failures remain until deployment.
- A new exact cleanup proposal is awaiting approval: the three oldest remaining
  completed deployment copies, deploy-20260930T230659Z-1806409 (3,393,877,879
  bytes), deploy-20260930T234029Z-aaa1b68 (3,396,338,946 bytes), and
  deploy-20261001T023833Z-cbcd30a (3,412,932,192 bytes). Total 10,203,149,017
  bytes, about 9.5 GiB; enough for current headroom. Preserve all daily copies,
  October 9, both October 17 copies and the fresh October 18 copy. No additional
  completed history has been deleted. After approval use only the canonical
  script with this exact list and all ordinary gates; then measure real
  publication/revision progress and restart the read-only observation window.

## 2026-10-18 19:24 UTC — Learning follow-up deployed after approved backup cleanup

- The user approved the three-copy proposal below. The canonical deploy script
  removed only deploy-20260930T214235Z-56fb9fe, deploy-20260930T220949Z-7c58632
  and deploy-20260930T224350Z-7be2bfd (10,092,649,806 bytes total). Read-only
  verification confirms those three absent; October 9 and both October 17 deploy
  copies remain, as do daily copies. The earlier pending approvals/capacity notes
  below are superseded. Preflight measured 17,385,222,144 available bytes against
  15,459,281,486 required; no reserve/headroom check was bypassed.
- Clean main d9bf09952ef48799d6a958f6aeb5d8edf4cd9758 was deployed only through
  ops/scripts/deploy-production.sh with Node 24 and the exact approved list.
  All 392 tests and 250/250 evals, type checks, builds, backup, migration 051,
  grants, reconciliation/index/stats, atomic switch and ordinary smokes passed.
  The completed backup is deploy-20261018T183316Z-d9bf099, with a 9,322,663,408-byte
  dump and checksum, no partial file. The script restarted the local Luna pool;
  the current release symlink confirms this SHA. About 7.6 GiB remain free.
- Root causes/corrections: b82d3cb makes provider-supported metadata constraints
  task-specific literals/enums and returns safe actionable artifact feedback;
  2a79bbd separates private context requirements from unfinished public research.
  Migration 051 resumes existing mixed gaps while retaining private requirements,
  finite attempts, leases and immutable revisions. Detailed evidence and focused
  regressions are in the two October 17 entries below. No provenance, independent
  review or complete-original-question closure check was relaxed.
- Post-switch health/ready are good, API/worker/admin/researcher active with
  NRestarts=0. At 19:24:03 UTC settings remain enabled/version 8/capacity 8,
  all eight executor heartbeats are under 30 seconds old, eight leases valid,
  none expired. Luna low, Luna High medium and the configured High fallback
  remain unchanged. Since 19:09:30 UTC, 116 AI runs completed successfully;
  completed work includes 62 technical drafts, 40 independent reviews, two
  technical publications, 13 discovery/acquisition/conversion/chunking tasks
  each and one diagnosis. Complete original-question closures remain zero;
  activity and partial publications do not establish complete learning.
- Node/Tailscale cohort 7ddc8291-bf44-4f8e-80b2-4fd62a991638 completed draft,
  independent review and publication at 19:20:56 UTC. Replaying the exact original
  question with its original Apple/macOS 27.0.1/diagnostic/zsh context returned
  answer_status=partial and revision 16bea534-7b6b-4872-9a37-fe2017388369,
  "Collecting macOS Console evidence for transient failures". Only Apple's
  documented Console collection steps are supported; this does not establish
  Node/executor/Tailscale behavior or the incident cause. The demand remains open
  with replay_status=partial and another technical draft queued. needs_context
  stays true: incident times, redacted Node errors and targets, heartbeat/lease
  and server logs, sleep/wake and contemporaneous Tailscale/interface evidence,
  exact Node/Tailscale versions and relevant application configuration/code.
- Hugging Face cohort ae85265e-9d39-4024-ab60-66e6b13277bb retains its exact
  question/macOS/normal/zsh context. Its first post-switch draft exhausted five
  bounded attempts at 19:19:14 UTC on a nonliteral provenance quotation; the
  strict check correctly rejected it. A next unseen evidence window was queued
  immediately and is running at 19:23:38 UTC. Exact public replay still returns
  unknown, same demand ID and needs_context=true. Needed private evidence remains
  the redacted timestamped traceback, exact MLX Whisper repository/invocation,
  installed huggingface_hub/hf_xet versions and contemporaneous route observations.
  Neither cohort was replaced by a synthetic demand or marked complete.
- Read-only observation restarted at 19:10:19 UTC. These are short acceptance
  observations, not a completed extended soak. Canonical output is retained
  locally in tmp/learning-followup-deploy.log; subsequent regular checks should
  measure source/evidence progress and exact question closure, not database size.

## 2026-10-18 12:15 UTC — Earlier two-backup capacity proposal is insufficient

- Health/ready and four services remain good; eight fresh executors, eight valid
  and zero expired leases, unchanged settings 8/capacity 8. Both original cohort
  requests remain partial under the already documented, not-yet-deployed fixes.
- Root filesystem is 98% used. Compact snapshot showed 6.3 GiB available; one
  repeat showed 7,437,971,456 bytes (about 6.9 GiB), with no pg_dump running.
  Even the repeat's larger value plus the previously proposed two historical
  copies cannot meet the canonical approximately 14.4-GiB preflight requirement.
  Do not run a dump or bypass the reserve/headroom check.
- The unanswered two-copy approval proposal is superseded by this explicit
  three-copy proposal: deploy-20260930T214235Z-56fb9fe (3,357,400,713 bytes),
  deploy-20260930T220949Z-7c58632 (3,358,089,976 bytes), and
  deploy-20260930T224350Z-7be2bfd (3,377,159,117 bytes). Total 10,092,649,806
  bytes, about 9.4 GiB. All daily copies, October 9 and the two freshest October
  17 completed deploy copies remain protected. These exact files exist; the two
  newest completed deploy copies are still 266de23 and 6a81c23.
- Approval for this additional history deletion is still required; the earlier
  human approval covered only the already removed first three September 30
  copies. No additional backup deletion or production mutation was performed.
  After approval recheck current capacity and deploy clean main only through
  the canonical script with the exact approved list; run all ordinary gates.

## 2026-10-17 10:04 UTC — Private evidence hold also blocked public research

- Compact production snapshot: health/ready good, API/worker/admin/researcher
  active with NRestarts=0, eight fresh executor heartbeats, eight valid leases,
  zero expired, settings version 8/capacity 8 unchanged. No fresh journal errors.
  Technical work reached 52 drafts, 42 independent reviews and three publications;
  zero complete original-question closures in the last 30 minutes. These counts
  do not establish complete learning for the monitored two questions.
- Both original cohort IDs are now partial/unresolved with CONTEXT_REQUIRED.
  One repeat read confirmed that each latest rejected review still names missing
  public capabilities and explicit official-document searches, alongside private
  incident evidence. Node/Tailscale needs runtime/error/heartbeat/sleep evidence;
  Hugging Face needs the exact invocation/repository, installed client versions,
  timestamped traceback and contemporaneous route observations. Do not invent
  a case-specific causal answer or silently drop those requirements.
- Cause: recordTechnicalGap classified every nonempty missing_context as a total
  hold. Both synthesis and discovery exclude CONTEXT_REQUIRED, so missing private
  logs prevented researching the independent public documentation gaps too.
- Minimal correction: retain TECHNICAL_EVIDENCE_INCOMPLETE while both public
  missing capabilities and next_searches remain; CONTEXT_REQUIRED still stops
  work when only private context remains. Public learning status derives
  needs_context from retained review evidence independently, so the private
  requirements remain visible while useful public work continues. Prompts put
  public official-document searches in next_searches and private data in
  missing_context. Migration 051 reclassifies existing latest reviewed mixed
  holds only; it does not reset task attempts, leases or immutable revisions.
- Regression: the mixed-gap test fails on prior main because no focused discovery
  task is queued. Corrected code passes all 34 technical/urgent PostgreSQL tests,
  including private-only standby and migration preservation of task/lease state.
  Type checks pass. Production remains 6a81c23; this correction joins the pending
  metadata follow-up. About 8.6 GiB free; the existing request to remove precisely
  56fb9fe/7c58632 completed historical backups is still awaiting user approval.
  No additional backup deletion, deployment or production mutation was performed.

## 2026-10-17 — Provider schema omitted technical metadata constraints

- Canonical deployment `6a81c23adca8a8502bf1c5fbc8a3fc909ae570d8` completed
  at 08:00 UTC: 387 tests and 250 evals passed; backup completed in
  `deploy-20261017T072848Z-6a81c23` (8,874,531,892 bytes), migrations 049/050,
  grants, index, switch and smokes succeeded. Only the three approved September
  30 copies were removed. API/ready and all four services healthy, NRestarts=0;
  settings version 8/capacity 8 unchanged, eight fresh executors, zero expired
  leases. Both original cohort requests retained their IDs and started synthesis.
  The numeric 802.1X diagnosis completed successfully at 08:00:55 UTC.
  Read-only observation restarted at 08:01:15 UTC; this short baseline is not
  an extended soak. At 08:06 UTC neither original cohort request has a published
  exact answer; do not report their learning complete.
  Follow-up code is pushed as `b82d3cb922d86c7b28d77d2e0616c385f9842b13`.
  Explicit cleanup approval is pending for `deploy-20260930T214235Z-56fb9fe`
  (3,357,400,713 bytes) and `deploy-20260930T220949Z-7c58632`
  (3,358,089,976 bytes), about 6.25 GiB combined. Keep all daily backups,
  October 9 and both fresh October 17 completed copies. No additional historical
  copy has been removed. Type checks and all 13 focused metadata/backup tests pass.
- Fresh artifacts repeatedly failed on question-key regex, capability length
  and ISO verification dates, including third attempts on two tasks. Cause:
  the provider-supported JSON Schema conversion deliberately drops regex,
  length and date-format keywords. The generated schema therefore failed to
  communicate these metadata constraints even though server validation retained
  them. Natural-language capability labels also cannot establish exact coverage.
- Correction: generate task-specific literal question keys and verification
  dates, and capability enums containing the leased required identifiers. These
  keywords survive the provider conversion. Keep server hash/quote checks,
  exact binding, independent review and completeness checks. Prompt clarifies
  identifiers versus explanation. Version the synthesis policy so already
  consumed v1 windows can be reconsidered under the corrected contract; finite
  task attempts and active leases are unchanged.
- Additional observed rejection: leased URL/hash matched but the generated quote
  was a paraphrase. The common prompt requested original writing without a clear
  citation exception. Clarify short contiguous literal provenance quotations.
  Keep the quote check strict. Restricted submission now reports allowlisted
  technical validation errors without private details instead of generic
  INTERNAL_ERROR; they no longer masquerade as upstream model failures.
- Targeted regression covers the actual normalized provider schema, wrong key,
  long prose capability and invalid date rejection, plus unchanged rejection of
  fabricated source hashes. Corrective follow-up deployment pending capacity:
  latest backup retained, about 8.7 GiB free versus 14.4 GiB canonical headroom.
  Do not bypass this check or delete more history without explicit approval.

## 2026-10-17 — Numeric standard identifier rejected every diagnosis retry

- Fresh post-recovery failures repeatedly affected demand `0756fac1-ba1d-47d9-810b-9da1d634236b`:
  `subquestions.5.capability` failed the strict letter-first identifier pattern.
  Its original campus/security question includes `802.1X`. Existing normalizer
  converts punctuation but leaves `802-1x` numeric-first, causing each otherwise
  valid diagnosis artifact to be rejected and retried.
- Prefix only numeric-first capability identifiers with `cap-`, retaining the
  original label/search terms and applying the same conversion to missing-capability
  references. The strict schema, topic identity, source policy and models remain.
  Regression covers `802.1X`/`802_1x` matching to `cap-802-1x`; canonical gates pending.

## 2026-10-17 — Technical request scope and relevant-evidence follow-up

- A focused regression reproduced a new exact-cache collision: the same question
  on Intel/M1 or normal/recovery shared a completion binding because the first
  technical mapper retained only public pack dimensions. The raw request
  constraints must remain available to the reviewer and in the private exact key,
  without inventing public hardware applicability or conflating OS/library versions.
- Retain bounded vendor/model/mode/architecture/execution-environment constraints
  privately in intake, lease snapshots and exact lookup; normal/absent mode and
  placeholder vendor normalize consistently with existing legacy requests. Related
  searches still use the typed documented context. Explicitly mismatched related
  OS/component versions appear as examples, never complete request answers.
- A controlled PostgreSQL regression with 18 unrelated documents and a relevant
  document showed that ordering document UUIDs could exclude the relevant evidence
  from the first 16-span window. Rank matches to original-question terms within
  and across documents while preserving a diverse, bounded evidence window.
  When a partial review requests focused searches, materialize those searches
  alongside further retained-evidence work at the same 165 priority; FIFO can
  advance missing documentation instead of consuming unrelated bulk facts first.
  No global cap, quota, cooldown or source reservation changes.
- Old reviewed completion bindings are requeued by migration 050 for the corrected
  scope. No public revision rewrite or cancellation of fresh leases. Changed task
  snapshots supersede normally through the submission guard.
- Regression evidence: ignored old/new scope probe reproduces the collision on
  initial code and distinguishes constraints on the correction. Draft integration
  tests run via local aliases against disposable PostgreSQL, leaving the current
  clean deployment source unchanged. Record final tests/deployed SHA/real-cohort
  outcomes after the follow-up canonical deployment.

- Additional verified fixes: retain every diagnosis capability (up to 24 rather
  than silently truncating to 20); keep short public phrases present in trusted
  source quotes while rejecting private echoes; share intake's existing strict
  redaction when computing repeat-query bindings. Old large UTF-8 fragments use
  byte-safe spans so retained citations leave capacity for new evidence.
- Current validation: Node 24 type checks/domain conformance pass; 32 real-role
  technical/urgent DB regressions and five backup guard regressions pass. Final
  full canonical gates remain required.

## 2026-10-17 — Backup exhausted production disk before application switch

- At 07:12:26 UTC PostgreSQL checkpointer PANIC: could not write
  `pg_logical/replorigin_checkpoint.tmp`, `No space left on device`. Repeated
  recovery checkpoints failed for the same reason. Root filesystem 250 GiB was
  100% full; `/var/backups/clideck-mcp` occupied 168 GiB. The failed deployment's
  own incomplete archive was 8,399,166,568 bytes in
  `deploy-20261017T064517Z-c7b573e`. `pg_dump` then reported SSL EOF while copying
  `source_fragments`; this was a disk failure, not evidence of a network outage.
  MCP was unavailable; PostgreSQL 16's official disk-full documentation confirms
  this failure mode: https://www.postgresql.org/docs/16/disk-full.html.
- Clean-main candidate `c7b573e56e8bf3de697c532fa679daf42e5a967e` passed 374
  tests, 250 evals and Linux build but never reached migration/switch. Production
  remains `266de23`. The canonical cleanup restored the local executor pool.
- Cause: backup had neither capacity preflight nor a free-space reserve; failed
  archives were retained. Correct the canonical flow, not database state by hand.
  New preflight may remove only an explicitly selected failed SHA's incomplete
  dump, never completed or unrelated backups. Require estimated dump headroom
  plus a 2-GiB database reserve; the backup monitors free space, terminates only
  its own dump and cleans its partial on failure. Deploy uses the tested candidate
  backup helper so the guard applies to this first corrected deployment.
- Recovery at 07:18 UTC: canonical preflight on clean/pushed `54b8384` with
  `CLIDECK_MCP_CLEANUP_FAILED_BACKUP_SHA=c7b573e56e8bf3de697c532fa679daf42e5a967e`
  removed only that failed incomplete archive. PostgreSQL recovered and readiness
  returned `ready` without manual SQL/service restart. Available 8,229,412,864
  bytes; required headroom 15,448,350,069 bytes. Preflight correctly stopped before
  a new dump/migration/switch. Production remains `266de23`.
- Completed backups remain untouched. Prepared an explicit opt-in canonical
  cleanup list for three historical September 30 deployment backups, preserving
  the newest two completed deploy copies and all daily copies. Exact targets:
  `deploy-20260930T052121Z-04ddae1` (3,347,372,269 bytes),
  `deploy-20260930T201539Z-ed4ae50` (3,355,319,065 bytes),
  `deploy-20260930T211222Z-7bc9125` (3,356,557,867 bytes).
  Their combined size is about 9.4 GiB. This irreversible historical cleanup
  was explicitly approved by the user at 07:23 UTC for these three targets only.
  The first approved attempt stopped before deletion: SSH dropped an empty optional
  SHA argument and shifted the CSV into its slot. Quote the remote command arguments,
  including empty slots; a regression exercises the canonical preflight across a
  shell boundary. No historical target was removed before this correction. The deployment will rerun every ordinary gate after capacity
  is available. New helper tests cover approved exact lists and protection of
  the newest two backups. No password storage or ad hoc production changes.
- Verification at 07:21 UTC: all 385 tests and 250/250 evals pass on disposable
  PostgreSQL 16; type checks and domain conformance pass. Live old release is
  enabled at capacity 8/settings version 8 with unchanged models, eight fresh
  executor heartbeats, eight valid/zero expired leases and 98 successful AI runs
  since 07:18. Some bounded artifact rejections remain; this short recovery
  baseline is not an extended soak or proof of original-question closure.

## 2026-10-17 — Technical questions lost between publication and exact retrieval

- Confirmed on the real Hugging Face demand: 2,628 published revisions had neither
  vendor nor network OS catalog IDs. macOS itself was absent from that catalog.
  Publication therefore omitted applicability rows, and exact network search
  could not return those facts as a complete answer. Generic priority changes
  cannot fix this. The user selected working technical scope: macOS/Linux,
  Node/Python, tools and APIs. Old published revisions remain immutable.
- Correction: scaffolded/validated `technical-operations` Domain Kit pack with
  independent OS and component versions. Conservative legacy routing preserves
  explicit network hardware/protocol handling. Source-backed answers use a
  private exact-question ledger and separate public, generalised knowledge.
  Retained official documents feed bounded 16-span/64-KiB question synthesis,
  independent Luna High review, then ordinary core publication/release activation.
  Both AI stages have priority 165 above bulk demand extraction/discovery (160);
  all operator-enabled lanes can learn different gaps. Models/settings/Pause,
  transactional leases, ordinary finite retries and source reservations persist.
- Deepening advances unseen source spans and retains cited prior evidence.
  Per-window evidence fingerprints prevent unchanged work loops. Missing public
  evidence returns focused search hints. Missing private code/logs/versions stays
  explicit across repeat queries; feedback invalidates the old exact-answer
  binding, including reports without revision refs. Stale in-flight snapshots
  cannot publish/close a changed question. Partial publication never closes it.
  Original questions/requested environment and private identifiers are not public
  payload fields; citations are rebound to trusted task bytes/hashes/URLs.
- Compatibility: three explicit task types keep rollback executors from consuming
  differently shaped publication tasks. Migration reclassifies unresolved macOS
  and clear software requests, including the two audited IDs, without rewriting
  published facts or resetting fragment attempts. New column-specific API ledger
  reads and worker/researcher grants are exercised with the actual DB roles.
  Existing network tool envelopes remain valid; typed feedback is additive via
  `report_domain_knowledge_gap`. Reviewed complete technical replay does not
  reopen merely because its legacy applicability label is generic.
- Verification: domain conformance/type checks pass. Last full PostgreSQL 16 run:
  373 tests and 250/250 evals. Subsequent public legacy-replay regression and the
  focused cohort (27 tests including 16 existing urgent regressions) pass. Tests
  cover eight simultaneous learning lanes, Pause, bounded/unseen evidence,
  citations/private echo, independent incomplete/partial review, stale feedback,
  active-release exact replay, component version mismatch and real MCP/API roles.
  The canonical deployment will rerun every gate on the final clean commit.
- First-fix observation at 06:38 UTC: the real Hugging Face question again has
  completed verification, publication and deep review tasks. The macOS/Node
  question retains its focused discovery task. Neither observation establishes
  complete original-question closure. Technical-domain deployment is pending.

## 2026-10-17 — Learning repeated discovery and stranded older-run evidence

- Evidence, 05:38–05:47 UTC, live `53c60bf`: user demand
  `7ddc8291-bf44-4f8e-80b2-4fd62a991638` (macOS/Node/Tailscale diagnosis)
  remained unresolved after 354 discovery tasks over ten days. The latest three
  completions added no source or reused fragment and returned 2–3 duplicates.
  Demand `ae85265e-9d39-4024-ab60-66e6b13277bb` (Hugging Face downloads)
  had no source work since October 14 11:30 UTC. Its newer run `b9c4ef42`
  was auditing with zero ready fragments; older failed run `0a8a21ee` retained
  two unreserved queued fragments at attempt 9. A second read-only selection
  confirmed the corrected ordering chooses that older run without resetting
  attempts. At 05:44:50 UTC the compact learning check reported zero complete
  question replays in 30 minutes, 655 discoveries without new/reused evidence,
  and 45 sources with ready evidence and no live task. These are learning
  failures despite healthy executors, not proof that every unanswered question
  has publicly available evidence.
- Causes: `withLeasedKnowledgeDemand` replaced the nested demand object and
  discarded diagnosis/subquestions/search expansions already queued by the
  scheduler. Discovery was limited to one search, without previous search
  outcomes, and excluded only 20 sources owned directly by that demand.
  Independently, analysis always preferred a newer nonterminal processing run,
  hiding queued evidence in an older failed run even while the source remained
  nonterminal. Existing demand-first priority was already active; raising a
  generic numeric priority would not correct either defect.
- Correction: lease the latest completed diagnosis and replay coverage, retain
  stored diagnosis for compatibility, and give discovery its last three results
  plus a bounded exclusion set including previously reused sources. Record
  searched official URLs for subsequent attempts. Target up to five focused
  searches at missing subquestions across official project/maintainer docs;
  avoid locale copies and identify missing private evidence explicitly. Prefer
  runs with ready analysis evidence or unverified candidates for the requested
  stage, preserving their run IDs, reservations and retry counts through analysis
  and verification. No production row edits, model/capacity changes, cooldowns,
  quotas or publication/replay relaxation.
- Monitoring: the existing two-hour `clideck` heartbeat and project rules now
  prioritize closure of real unknown/partial questions over background growth.
  `ops/sql/learning-health.sql` provides a bounded read-only aggregate and stable
  old/repeated question samples without generating synthetic demands. It avoids
  treating `last_seen_at` (also updated by incomplete replay) as progress.
- Validation so far: new diagnosis-preservation regression fails on the old
  implementation and passes on the correction. Node 24 type checks/build and
  all database-free tests passed (245 total; 108 database tests skipped).
  Added database regressions for current diagnosis/history in old queued leases
  and older-run recovery through analysis and verification with unchanged attempts.
  All 16 urgent-learning database regressions passed on disposable PostgreSQL 16.
  The unrelated lab assurance
  test had expired on October 15; freeze its test clock so real production
  expiry checks remain enforced. The first canonical preflight stopped on seven
  integration assertions before any production change: the multi-connection
  intake test left 20 synthetic demands/targets behind. Other test schedulers
  recovered them, making results depend on file order. Delete those test-owned
  records in cleanup instead of parking them as paused/unresolved. A fresh full
  PostgreSQL 16 run now passes all 353 tests and 250/250 evaluation fixtures.
  A second canonical preflight exposed a UI-test race: analysis rendered its
  detected context before its busy flag cleared, so the test clicked a disabled
  Search button. Wait for the button to become enabled; no product UI change.
  The canonical deployment must rerun its gates on the clean final commit.
- Resolved local preflight blocker: Docker Desktop responded to neither `docker ps` nor its
  local socket `_ping` (5-second timeout). Do not bypass the canonical deploy or
  run write-based regressions against production. User approval to restart
  Docker was requested because other local containers would be interrupted.
  The user authorized a restart; normal stop timed out, the supported force-stop
  and start commands succeeded, and the existing containers became healthy again.
- Deployment: clean main `266de23045097d317d61d9b1c8d7f772757f0213` verified
  by the canonical Node 24 script, all 353 tests/250 evals and ordinary build,
  backup, migration/grants, reconciliation, switch and smokes. Backup directory:
  `/var/backups/clideck-mcp/deploy-20261017T055739Z-266de23`.
- Initial read-only baseline, 06:32:38 UTC: all four services active/NRestarts 0,
  capacity 8/settings version 8 and both model profiles unchanged. Eight fresh
  executor heartbeats (0–6 seconds), eight valid leases, zero expired. Since
  06:30 UTC 37 AI runs completed; 13 analysis/11 verification/12 deep reviews and
  eight publications completed. This is progress, not proof of original-question
  closure or a completed extended soak. Observation restarts at this baseline.
- Further confirmed cause: software facts without resolved vendor AND network OS
  are excluded from exact network applicability retrieval. The Hugging Face
  demand has 2,628 published revisions with neither catalog identity. macOS is
  absent from that catalog. A component-aware technical domain and direct,
  reviewed original-question synthesis are being added for the user-authorized
  scope: macOS/Linux, Node/Python, tools and APIs. No fabricated network OS or
  rewriting old published revisions.

## 2026-10-09 — Checked-out PostgreSQL client error terminated worker

- Evidence: the worker exited at 06:10 UTC on `bb8b234` with an unhandled
  `Client` error, `Connection terminated unexpectedly`, from pg 8.22.0.
  systemd recorded exit status 1 and its first automatic restart, starting
  again at 06:10:43 UTC. At 07:13–07:14 UTC all eight executor heartbeats were
  fresh, zero leases were expired, and 153 AI runs completed in five minutes.
  The underlying connection interruption is not established by this stack.
- Cause: `createDatabase` handled only pool errors. pg-pool removes its idle
  error listener while a client is checked out, leaving errors between queries
  unhandled. This affects both transactions and the dedicated statistics client.
  Confirmed against installed pg-pool source and the official client error
  contract: https://node-postgres.com/apis/client#events.
- Correction: install one logging error listener when each pool connection is
  created, retaining it while checked out. Existing query rejection, rollback,
  broken-client disposal and bounded retry behavior remain in place; no process
  restart workaround, connection retry, capacity/model or queue policy change.
- Validation: four targeted tests passed against disposable PostgreSQL 16.
  New regressions terminate an actual checked-out backend while idle between
  queries, verify logged errors and replacement connections, and confirm that
  an interrupted transaction rejects without committing its write while a later
  transaction succeeds. The test observes only `end`, so it cannot mask a
  missing application `error` listener. Existing rollback-timeout disposal
  and mechanical-lease renewal regressions also pass.
- Deployment: clean `main` commit `53c60bf6146578e3ee08af20bf39bb3223ec6fc4`
  verified through `ops/scripts/deploy-production.sh` with Node 24. All 350 tests,
  250/250 evaluation fixtures, type checks and local/Linux builds passed. Full
  backup, migration/grant checks, reconciliation, applicability/statistics,
  atomic switch and public protocol smokes completed; the script restored the
  local executor pool. Backup (7.6 GB with checksum):
  `/var/backups/clideck-mcp/deploy-20261009T072249Z-53c60bf`.
- Live acceptance, 07:50:46–07:53:07 UTC: API, worker, admin and researcher active
  with zero automatic restarts. Public health/ready returned ok/ready;
  authenticated settings/models/Overview returned HTTP 200 and the new SHA.
  Enabled capacity 8, settings version 8 and both model profiles are unchanged;
  model catalog is fresh with no catalog/pricing error or open circuit.
  All eight executor heartbeats were 0–4 seconds old and running. Eight AI runs
  were active; task leases were valid (8–9 total across the two snapshots),
  with zero expired leases. Successful AI completions increased from 25 to 50
  between 07:52:03 and 07:53:07, with completions on every lane. Diagnosis,
  analysis, verification, deep review, publication, discovery and mechanical
  acquisition/conversion/chunking all advanced. One `AGENT_ARTIFACT_REJECTED`
  retained the existing validation path; no fresh internal service error,
  uncaught client error or process exit was observed.
- The read-only observation window restarts at 07:53:07 UTC. This short acceptance
  does not establish an extended soak or the cause of the original connection
  interruption. The regression proves error handling and transaction recovery
  against a real disconnect on the disposable database, without terminating
  production connections.

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
