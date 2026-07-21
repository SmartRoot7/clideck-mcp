# CliDeck MCP 0.8 — Demand-driven knowledge and request observability

## Current focus

`[~]` Release Demand Intelligence: diagnose every unique incomplete answer,
reuse existing knowledge before discovery, allocate demand work fairly, and
prove the ONIE Rescue source-to-answer loop in production.

## Scope and completion journal

### M0 — Compatibility and privacy contract

- `[x]` Keep every existing public MCP tool name and response contract.
- `[x]` Keep `/admin` and `/demo` on the same `OperationsApp`.
- `[x]` Resolve client IP only through the existing trusted-proxy policy.
- `[x]` Store sanitized, bounded tool inputs and outputs rather than raw CLI,
  credentials, access tokens, verification handles, or provenance.
- `[x]` Keep exact client IP visible only to the authenticated local
  `super_admin`; replace IP and request content with `XXXXXXXX` in `/demo`.
- `[x]` Apply a configurable retention period to request payloads and IP data.

Ready when the migration, contracts and security tests prove these rules.

### M1 — MCP request journal

- `[x]` Add `mcp_request_logs` and a bounded request/response sanitizer.
- `[x]` Record every completed public MCP tool call, including failures.
- `[x]` Add indexed pagination and filters by tool and outcome.
- `[x]` Add local admin and mirrored read-only demo endpoints.
- `[x]` Add retention cleanup to the deterministic worker.

Ready when a successful, unknown and failed tool call appear in the journal,
and the same demo response hides request/IP data server-side.

### M2 — Request Analytics on Overview

- `[x]` Add hourly request, answered, unknown and error series.
- `[x]` Add 24-hour totals and a full-width ECharts visualization.
- `[x]` Explain the exact meaning of each line in the existing icon tooltip.

Ready when chart totals reconcile exactly with the request journal.

### M3 — Highest-priority unknown-question learning

- `[x]` Add deduplicated `knowledge_demands` linked to request logs, discovery
  tasks, sources and the resulting release.
- `[x]` Convert unknown Network query/workflow, Change Guard, and Upgrade
  Advisor results into durable learning demands without requiring the user to
  create an expert task. The legacy priority-120 bypass is superseded by the
  fair demand/baseline scheduler in M20.
- `[x]` Search only official public HTTPS documentation, then continue through
  Acquire → Convert → Chunk → Analyze → Verify/Deep Review → Publish.
- `[x]` Keep repeated identical questions idempotent and increase demand count.
- `[x]` Mark a demand learned only when repeating the same deterministic search
  finds an active revision.

Ready when an unknown test question creates one demand, enters discovery ahead
of background work, and later resolves from deterministic knowledge.

### M4 — Request Log interface

- `[x]` Add `MCP Requests` to the shared Monitor navigation.
- `[x]` Build a compact operational header, filters, paginated table and detail
  drawer using the existing Sites-guided visual system.
- `[x]` Show exact sanitized question, response, IP, timing and learning state
  to `super_admin`.
- `[x]` Render the same page and controls in `/demo`, with request/IP values
  replaced by `XXXXXXXX` while safe MCP responses remain visible.

Ready when component parity tests see the same registry, controls and layout.

### M5 — Active Sources truthfulness

- `[x]` Select the primary source from live Verify/Deep Review work when no
  fragment-analysis slot is occupied.
- `[x]` Keep the page visible when no extraction lane is assigned.
- `[x]` Show live tasks, Luna owner, stage, batch size and source progress.

Ready when active Deep Review work can no longer produce an empty page.

### M6 — Quality gate and rollout

- `[x]` Run TypeScript, unit/UI, PostgreSQL integration, security and eval
  suites.
- `[x]` Verify demo response redaction in JSON and the shared browser UI,
  including protection against question-search inference.
- `[x]` Verify request analytics reconciliation and Active Sources fallback.
- `[x]` Add a deterministic semantic-term floor so a context-only FTS match
  cannot turn an unsupported question into a misleading answer.
- `[x]` Keep the last valid public-stats snapshot during a transient aggregate
  timeout so deployment and the public endpoint remain available with `stale`.
- `[~]` Exercise unknown → official discovery → publication → instant reuse.
- `[x]` Deploy only with `./ops/scripts/deploy-production.sh`.
- `[x]` Do not push GitHub until explicitly requested by the user.

Ready when production smoke checks pass and the deployed SHA is recorded here.

### M7 — Exact-demand relevance gate

- `[x]` Reject a demand-linked source after deterministic conversion when it
  contains none of the question's specific technical terms; generic vendor,
  platform and operational wording is not enough.
- `[x]` Keep a fast-path or Luna candidate only when its structured result
  retains at least one demand-specific term; otherwise it cannot consume the
  urgent learning path or be published as its answer.
- `[x]` When every linked source is terminal and the exact query remains
  unknown, return the demand to the priority queue with an explicit reason
  instead of leaving it in `processing`.

Ready when an unknown production question cannot be falsely treated as learned
by unrelated documents, and the next official discovery remains retryable.

### M8 — Deep-review provenance binding

- `[x]` Treat provenance as immutable leased evidence during Deep Review. The
  reviewer may repair the claim, but cannot create, replace or invalidate a
  source URL, evidence fragment or content hash.
- `[~]` Accept a structurally useful repaired candidate even when the model
  redundantly returns malformed provenance, then restore the original evidence
  before applying the strict Domain Pack and risk checks.

Ready when malformed reviewer provenance cannot reject a whole automatic
review batch, while a repaired candidate still cannot escape evidence binding.

The code and regression suite prove that an invalid model-supplied provenance
hash is discarded while the leased provenance remains unchanged. Production
observation found that the long-lived local Luna pool was still executing an
older in-memory coordinator after remote deployment, so this is not yet marked
as live-verified. M11 makes a pool restart part of the single deployment path.

### M9 — Early dangerous-record completeness gate

- `[~]` Apply the mandatory rollback check during standard and Deep Review
  verification, before a record can become Ready.
- `[~]` Keep publication preflight as the final invariant, but eliminate the
  avoidable Ready → Deep Review loop for records already known to be incomplete.
- `[~]` Make the Luna extraction, standard verification and Deep Review
  instructions require an evidence-supported rollback or an explicit,
  documented irreversibility boundary for dangerous procedures.

Ready when no newly verified dangerous record without rollback reaches the
mechanical publisher, while dangerous records with an evidence-backed rollback
remain publishable.

### M10 — Preserve Deep Review throughput across transient failures

- `[~]` Preserve the current Deep Review batch size when Codex reports a
  retryable internal/platform error.
- `[~]` Continue reducing a batch only after a malformed structured artifact
  or an explicit omission, where a smaller response can improve completeness.

Ready when a transient failure retries the same evidence batch without
silently degrading it to one-record Luna runs.

### M11 — Deploy the coordinator code that was actually reviewed

- `[~]` Stop a running local Luna pool after the full preflight succeeds and
  before the remote rollout pauses and switches production.
- `[~]` Restart that pool only after the remote release and smoke tests succeed,
  so every executor loads the exact committed coordinator source.
- `[~]` Restore a previously running local pool in the deployment cleanup path
  if a rollout fails, without changing an intentionally stopped pool.

Ready when the local executor process start time follows the deployment and
new Deep Review runs no longer reject echoed provenance hashes.

### M12 — Circuit-breaker for structured platform failures

- `[~]` Classify Codex `INTERNAL_ERROR` output as a retryable platform failure
  even when the CLI exits with code zero.
- `[~]` Feed its stable diagnostic fingerprint into the existing circuit
  breaker, rather than treating it as a malformed knowledge artifact.
- `[~]` Keep a real schema or index error distinct, so a smaller batch is still
  available when it can improve artifact completeness.

Ready when four matching platform failures open the existing short cooldown and
the next successful executor closes it without losing or weakening a record.

### M13 — Fill the safe analysis evidence budget

- `[~]` Remove the obsolete per-fragment 16 KiB stop condition from analysis
  batching; retain the hard 64 KiB aggregate evidence limit and 16-fragment
  record limit.
- `[~]` Permit two normal 30 KiB converted fragments in one Luna analysis run
  when their combined evidence remains below the hard budget.

Ready when live median analysis batch size rises above one for normal converted
documents, without any artifact-size, quality or safety regression.

### M14 — Demand-aware fragment prioritization

- `[~]` For a priority knowledge demand, rank queued fragments by exact
  demand-term matches before creating a Luna analysis task; a matching section
  title is weighted above a matching body.
- `[~]` Preserve the existing complete-document queue: ranking changes only
  which safe fragment is analysed first and never discards unmatched evidence.
- `[~]` Use the same technical-term boundary rule as the source and candidate
  relevance gates, so a substring such as `remacsec` cannot be promoted for a
  `macsec` demand.

Ready when an urgent demand begins with relevant sections from the official
source, all remaining fragments remain retryable, and production observation
shows fewer zero-yield Luna analysis runs without a false learned answer.

### M15 — Preserve the question through demand analysis

- `[~]` Add the stored unknown question and context to the short-lived leased
  payload for source-derived AI tasks, without copying it into persisted task
  payloads or public/admin responses.
- `[~]` Require a demand-linked extraction candidate to directly answer that
  question and retain a specific technical term that the deterministic gate can
  verify.
- `[~]` Keep generic useful facts available to background coverage, but reject
  them from the priority answer path rather than presenting them as the answer
  to a different question.

Ready when a demand-linked analysis run can create a relevant candidate from a
ranked official fragment, and an unknown question becomes `published` only when
that candidate passes the existing verification and release policy.

### M16 — Immediate, non-repeating demand recovery

- `[~]` Resume high-priority discovery as soon as a fully processed official
  source yields no answer, instead of holding the user question in a fixed
  delay.
- `[~]` Supply the next discovery lease with the bounded list of already
  exhausted official URLs, so it must seek a distinct document rather than
  cycling over the same source.
- `[~]` Retain the longer backoff only when a discovery run itself finds no
  new qualifying official source, which prevents empty Luna loops.

Ready when a rejected or non-answering source immediately leads to a distinct
official-source attempt, while a genuine no-result search stays bounded and
does not consume repeated AI runs.

### M17 — Adaptive protection from repeated Codex platform failures

- `[~]` Treat a repeated identical `CODEX_PROCESS_FAILED` fingerprint as a
  platform incident rather than a sequence of independent knowledge failures.
- `[~]` Increase the circuit cooldown from the measured recurrence of that
  fingerprint, bounded by a short recovery probe instead of a permanent stop.
- `[~]` Close the affected circuit immediately after a successful same-scope
  probe, preserving the work-conserving four-Luna pipeline when the platform
  recovers.

Ready when a persistent external failure cannot repeatedly burn full Deep
Review runs, while one successful probe restores normal automatic work without
manual intervention.

### M20 — Demand Intelligence 0.8.5

- `[x]` Split software family, runtime mode, shell environment and requested
  capabilities; `ONIE Rescue` resolves as `ONIE + rescue`.
- `[x]` Decompose compound network questions and return `complete`, `partial`
  or `unknown` with per-capability coverage.
- `[x]` Queue exactly one Medium `demand_diagnosis` per unique unfinished
  demand before official-document discovery; repeated requests increase topic
  weight without launching another diagnosis.
- `[x]` Generate topic keys, slugs and artifact hashes only on the server.
- `[x]` Replay deterministic search after diagnosis and every related
  publication; one similar command can no longer falsely close a compound
  request.
- `[x]` Replace priority-120 bypass with `demand | baseline` queue classes,
  one concurrent diagnosis, half-lane/half-source fairness while baseline work
  exists, and full use of otherwise idle capacity.
- `[x]` Store structured diagnostics in PostgreSQL and expose them in the
  shared MCP Requests page with admin-only JSON/Markdown export; demo output
  masks questions, context, diagnostic prose and source leads server-side.
- `[x]` Make expert-task public progress follow its real Luna claim instead of
  showing `researching` together with a stale `queued` milestone.
- `[x]` Verify migrations 001–028, applicability backfill, 163 backend and
  PostgreSQL tests, all Domain Pack tests, 15 shared UI tests, production
  build, and eval 250/250 with dangerous false-safe 0 and p95 19.29 ms.
- `[x]` Verify the production-shaped 027 → 028 upgrade with unfinished
  demands: obsolete queued discovery work is skipped and every unfinished
  demand receives exactly one queued Medium diagnosis.
- `[x]` Run the first live compound ONIE Rescue query. It correctly returned
  partial coverage and queued diagnosis, but exposed one false-positive route:
  a remote-syslog IP value was treated as interface IP configuration. Add
  deterministic capability evidence gates so shared words cannot mark IP,
  ARP, counters, TFTP, reboot or boot behavior as covered without a matching
  command or procedure.
- `[x]` Fix the canonical deployment storage leak exposed by the acceptance
  correction rollout: interrupted SHA-addressed build directories are removed
  before the next build, and successful rollouts retain the current/previous
  release plus eight historical releases and 14 deployment backups. Retention
  runs only after smoke and never deletes the active rollback target.
- `[~]` Deploy through the canonical script and run the live ONIE Rescue
  acceptance cycle.

Ready when production creates one Medium diagnosis for the existing unfinished
demands, ONIE Rescue enters fair official discovery only if replay remains
partial, and the live MCP response exposes truthful coverage without waiting
for Luna.

### M18 — Isolate an AI incident without idling useful work

- `[~]` Scope a circuit to the exact AI task type and reasoning level that
  repeatedly failed, rather than pausing the entire Luna pool.
- `[~]` Keep the blocked scope to one recovery probe after its cooldown while
  discovery, analysis and verification claims remain eligible for the other
  executor lanes.
- `[~]` Verify with PostgreSQL integration that four failed Deep Medium runs
  still allow the next executor to claim Analyze work, with no duplicate lease.

Ready when a Deep Medium platform incident cannot starve high-quality upstream
knowledge work or urgent discovery, while the failing scope remains protected
from a token-spending retry storm.

### M19 — Clear request learning and live-source visibility

- `[~]` Keep the local MCP journal as the complete operational record: safe
  input/output, exact client address for the local super admin, pagination,
  filters and automatic retention.  The public demo uses the identical page
  but replaces request values and client addresses with `XXXXXXXX`, while
  retaining the real safe response.
- `[~]` Keep the Overview request chart based on the same journal: requests,
  answered results, unknowns entering learning, and structured errors.
- `[~]` Display all four source lanes on Overview, each with its true live
  stage, Luna/worker count, fragment progress and candidate/verified totals.
  The values come from current task leases rather than inferred heartbeats.
- `[~]` Treat an unknown request as a durable fair-scheduled learning goal. A
  recoverable analysis/verification/Deep Review failure must keep that goal in
  automatic processing; a terminal document failure immediately permits a
  fresh official-source discovery instead of a long delay.

Ready when the journal and its demo projection reconcile, the Overview can
explain every active source lane, and an unknown request cannot be lost merely
because one Luna run or official URL failed.

### M20 — Work-conserving scoped circuit recovery

- `[x]` Exclude queued work behind an open, task-type-and-reasoning-specific
  Codex circuit from capacity accounting.
- `[x]` Do not create more work for that blocked class until its probe window
  opens, while Verify, Analyze and Discovery can reserve the released lanes.
- `[~]` Observe a real Deep Medium circuit on production and confirm that it
  no longer leaves healthy Luna executors idle while useful upstream work
  exists.

Ready when an external Deep Medium failure protects tokens without making the
rest of the four-Luna pipeline appear fully occupied.

### M21 — Publication-equivalent validation before Ready

- `[x]` Apply Network Domain Pack and core publication policy validation during
  standard Verify, before a record receives `verified`/Ready status.
- `[x]` Route an invalid candidate to automatic Deep Review with a bounded,
  non-source-revealing reason; publication retains its final invariant.
- `[~]` Observe the reduction in `publication_preflight` repairs on production
  without relaxing rollback, confidence, version or provenance requirements.

Ready when invalid records no longer consume a release attempt merely to find
out that they need automated repair.

### M22 — Canonical source identity at acquisition

- `[x]` Treat a source URL that redirects to an already-known canonical
  document as a normal duplicate, rather than letting a unique-key error turn
  it into a failed mechanical task.
- `[x]` Remove the duplicate source from active lanes and clean up its
  temporary artifact immediately; retain the already-owned canonical document
  as the sole processing path.
- `[x]` Cover the redirect collision with a PostgreSQL integration scenario:
  the task completes as a duplicate, creates no second artifact and records no
  false worker failure.
- `[~]` Observe the next collection cycle to confirm that duplicate-key
  acquisition failures stop growing. Terminal 404/410 URLs remain separately
  classified as unavailable documents and are never retried.

Ready when a normal canonical redirect cannot consume a retry, poison a source
lane or inflate the mechanical-failure metric.

### M23 — Evidence-first Deep Medium review

- `[x]` Disable web search for Deep Medium: it receives the authoritative
  fragment and its role is to resolve the candidate against that evidence, not
  to seek a redundant second source.
- `[x]` Make the prompt explicit: a directly supporting official manufacturer
  document is sufficient; unsupported claims are narrowed or rejected.
- `[~]` Observe Deep Medium process-failure rate and tokens per resolved record
  after removal of the unnecessary external research capability.

Ready when Deep Medium remains a third, independent quality pass without
spending capacity on redundant web access or fabricating a claim beyond its
official evidence.

### M24 — Scoped recovery from repeated Medium platform errors

- `[x]` Keep normal Medium as the first and highest-priority deep-resolution
  pass.
- `[x]` Preserve the candidate reservation and official evidence while the
  scoped circuit admits only one Medium probe.
- `[x]` Remove the earlier Luna-low fallback. A platform incident must not
  change the semantic review level, reject a candidate, or make it publishable.
- `[x]` Convert any queued historical fallback task back to Medium in the
  scheduler transaction without duplicating its candidate batch.
- `[x]` Let unrelated Verify, Analyze and Discovery work use every remaining
  executor lane while the Medium circuit is cooling down.
- `[~]` Observe the next successful Medium probe and verify that it closes only
  the matching scoped circuit.

Ready when a transient Medium platform incident consumes at most one probe,
does not strand unrelated work and cannot alter candidate disposition.

### M25 — Evidence-sized source fragments

- `[x]` Derive the persisted source-fragment ceiling from the existing bounded
  analysis evidence budget and the intended useful cohort size, rather than
  allowing a single source fragment to consume nearly half of an analysis run.
- `[x]` Preserve deterministic splitting, UTF-8 safety, section locators and
  content hashes; the change affects only newly chunked sources.
- `[~]` Observe median analysis batch size, Luna utilisation and candidate
  quality on production before considering any further change to evidence
  limits.

Ready when normal documents can fill a related analysis cohort without raising
the Luna evidence budget or weakening provenance and risk validation.

### M26 — Work-conserving source and circuit recovery

- `[x]` Return `verifying` or `failed` sources with claimable queued fragments
  to prepared/analyzing lanes.
- `[x]` Clear fragment reservations only when the owning task is terminal,
  missing or no longer has a live lease; preserve queued and live reservations.
- `[x]` Permit due `active` coverage targets and force the oldest non-paused
  active/covered target when all source buffers are empty.
- `[x]` Keep exactly one active Discovery task through the existing partial
  unique task key.
- `[x]` Add safe Overview circuit telemetry and distinct `Circuit cooldown`,
  `Probe running` and true `Standby` states to the shared admin/demo UI.
- `[x]` Verify the change on a fresh PostgreSQL 16 database: 141 backend and
  integration tests passed without skip; all Domain Pack tests and 15 shared
  UI tests passed.
- `[x]` Product eval passed 250/250 with dangerous false-safe 0 and p95
  210.86 ms; typecheck and production build passed.
- `[x]` Extend the canonical production role contract so the authenticated
  admin and read-only demo Overview can read safe scoped-circuit telemetry.
  The first rollout exposed the missing `clideck_mcp_admin` grant as a
  permission error; no pipeline or knowledge data was changed by the failure.
- `[~]` Deploy the clean `main` commit through the canonical script and verify
  source-lane recovery, Discovery refill, alternative Luna work and candidate
  conservation on production.

Ready when production no longer shows queued Analyze fragments without a lane,
an empty source buffer immediately refills, and a Medium incident is visible
without making the other executors idle.

### M27 — Demand closure and exact-scope recovery

- `[x]` Trace every production learning demand without exposing caller IPs,
  source identities or stored request content. Six of eight historical unknown
  questions now return deterministic answers; two remain genuine gaps.
- `[x]` Replace the demand queue function with an explicitly qualified
  PL/pgSQL definition. A repeated unknown can now reuse an active demand without
  the `discovery_task_id` output variable colliding with the table column.
- `[x]` Reconcile a successful MCP answer back to its existing demand and link
  the active revision/release immediately.
- `[x]` Recheck every outstanding demand after each knowledge publication,
  including answers learned through a different source than the original
  demand.
- `[x]` Prevent late discovery and task failures from downgrading a published
  demand; restore historical rows only when their exact result revision remains
  active.
- `[x]` Make extraction and Deep Review narrow generic IOS/IOS XE evidence to
  generic applicability with explicit limitations instead of rejecting it only
  because the original request named an exact model or release.
- `[x]` Reuse an already-downloaded official source when demand Discovery finds
  only URL duplicates. Up to 32 question-relevant fragments return to targeted
  priority-120 analysis and rejected candidates receive one evidence-bound
  recheck; the document is not downloaded again.
- `[x]` Persist the demand/source content-hash attempt so an unchanged document
  cannot be reprocessed repeatedly for the same unanswered request. A genuinely
  updated artifact remains eligible for another targeted pass.
- `[x]` Before spending another Discovery run, rank all previously downloaded
  official documents linked to the demand or its coverage target and reuse the
  highest-value untried fragments. This closes the case where the exact evidence
  was already local but the newest discovery response mentioned a different
  duplicate URL.
- `[x]` Verify the first production pass on exact historical inputs: seven of
  eight demands now have useful deterministic answers. The remaining backup
  scenario initially returned only a preflight diagnostic that explicitly did
  not cover the requested transport and management VRF, so it is not accepted
  as complete merely because it shares search terms with the question.
- `[x]` Require an executable command or procedure before an operational query
  is considered answered. The workflow tool applies the same gate to every
  result. Diagnostic-only matches now remain honest `unknown` responses and
  reopen the priority-120 learning demand instead of prematurely closing it.
- `[x]` Verify the migration and demand lifecycle on a fresh PostgreSQL database
  with focused integration coverage. The complete gate passes 145 backend and
  PostgreSQL tests, all Domain/UI tests, eval 250/250 with zero dangerous
  false-safe results, typecheck and production build.
- `[~]` Deploy 0.8.3 through the canonical script, repeat all historical unknown
  questions and verify that the remaining gap reuses existing official evidence
  instead of stopping at URL dedupe.

Ready when every unknown response has a durable learning demand, every newly
known answer closes that demand, and generic official evidence remains useful
without being misrepresented as exact platform support.

## Production verification — 20 July 2026

- `[x]` Deployed `bc7c950b585bd994efa704e4ca246320fbde05dd` exclusively through
  `./ops/scripts/deploy-production.sh`. Health, public statistics, MCP tool
  discovery, deterministic retrieval, redaction, Change Guard, short
  verification handles, operational workflow and upgrade smoke checks passed.
- `[x]` Verified request observability on production: 54 public MCP tool calls
  in the rolling 24-hour window were recorded at the point of check; 53 were
  answered, one was an explicit unknown and there were no structured errors.
  The local admin journal retains the validated client address; demo JSON
  replaces the client address and request data with `XXXXXXXX` while retaining
  the actual sanitized response.
- `[x]` Exercised one new supported-context unknown request. It created exactly
  one learning demand at priority `120`, was claimed before background work,
  and completed Discover → Acquire → Convert → Chunk into a prepared official
  source. It holds an active source slot and a high-priority analysis batch.
- `[~]` The same demand has not yet reached publication at this observation
  point. Do not treat discovery or a prepared source as a knowledge answer;
  verify a repeat query only after a release makes a validated revision active.

## Operational definitions

- **Request**: one public MCP tool invocation, not protocol initialization,
  tool listing, health checks or browser asset requests.
- **Answered**: a tool invocation completed successfully and did not report
  `unknown`.
- **Unknown**: a deterministic query or workflow completed safely but found no
  applicable knowledge.
- **Error**: the tool returned a structured public error.
- **Learning demand**: a deduplicated unknown question plus its validated
  context, queued at the highest pipeline priority.
- **Evidence**: the authoritative source fragment that directly supports the
  specific claim, model and version. A clear official manufacturer document is
  sufficient evidence; the system must not require a second source merely to
  publish a correctly extracted record.
- **Raw input**: never stored. All persisted inputs are redacted, depth/size
  bounded JSON projections.

## Verified pre-deployment gate

- PostgreSQL 16 fresh migration through `021_mcp_observability_and_demands.sql`
  and production-role grants: passed.
- Backend and PostgreSQL tests: 112 passed, 0 skipped with `DATABASE_URL`.
- Domain tests: 14 passed.
- Shared admin/demo UI tests: 14 passed.
- Product eval: 250/250, dangerous false-safe 0, p95 12.45 ms.
- Production frontend build and Sites-guided browser review: passed.
- Demo check: caller IP and request content are `XXXXXXXX`; safe answer remains
  visible; private question text cannot be used as a public search oracle.
