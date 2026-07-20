# CliDeck MCP 0.8 — Demand-driven knowledge and request observability

## Current focus

`[~]` Observe the production demand-driven loop through analysis, verification
and publication. The next measured gap is ensuring an analysis executor retains
the urgent question in its short-lived lease, so an extracted candidate can be
correctly linked back to that question.

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
  Advisor results into priority-120
  demand-discovery work without requiring the user to create an expert task.
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
