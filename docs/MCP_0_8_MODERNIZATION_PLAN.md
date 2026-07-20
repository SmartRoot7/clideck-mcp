# CliDeck MCP 0.8 — Demand-driven knowledge and request observability

## Current focus

`[~]` Deploy the validated request journal, analytics and demand-driven
learning loop, then exercise the production unknown-to-answer path.

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
- `[~]` Exercise unknown → official discovery → publication → instant reuse.
- `[ ]` Deploy only with `./ops/scripts/deploy-production.sh`.
- `[x]` Do not push GitHub until explicitly requested by the user.

Ready when production smoke checks pass and the deployed SHA is recorded here.

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
