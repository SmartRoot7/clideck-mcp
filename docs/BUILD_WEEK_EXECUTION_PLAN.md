# CliDeck MCP 0.6 — Build Week execution plan

Deadline: 2026-07-21 17:00 PDT  
Track: Developer Tools  
Branch policy: `main` only; completed stages are committed and pushed directly.

## Status

- `[ ]` not started
- `[~]` in progress
- `[x]` completed and verified
- `[!]` blocked

## Current focus

`0.8.4 — portable software applicability and version compatibility`

## Baseline

Captured at 2026-07-19T01:49:01Z from commit
`1ef86f26c2e21019a487e53ade21c65305fb6434`.

- Local `main` matched `origin/main` and the worktree was clean.
- `pnpm check`: passed.
- Backend tests: 47 passed, 13 PostgreSQL integration tests skipped because
  `DATABASE_URL` was not configured for the local run.
- Admin UI tests: 5 passed.
- `pnpm build`: passed.
- Production release: `#38`.
- Production active knowledge: 58,904 revisions.
- Public eval: 250/250 passed, dangerous false-safe 0, known-query p95 50.89 ms.
- Existing 13 network MCP tools are the compatibility boundary. They must keep
  their names and public response behavior throughout this sprint.

Existing network revisions remain in place. The sprint adds domain metadata and
adapters; it does not reprocess or duplicate the production knowledge database.

## Day 1 — universal core

### [x] D1.0 — Tracker, license, and compatibility freeze

Goal: create the living execution record, add the Apache-2.0 code license, and
capture a repeatable baseline.

Acceptance:

- this file contains the complete sprint and post-contest backlog;
- `LICENSE` contains Apache-2.0;
- production totals and network MCP compatibility boundary are recorded;
- baseline commands are documented in `README.md`.

Verification:

- production `/public/v1/stats` captured successfully;
- local check, tests, and build passed as recorded above.

Completed: 2026-07-19

## 0.7 — High-performance autonomous pipeline

### [x] P0.7.1 — Automatic candidate resolution

Goal: remove the operator from the normal verification path without weakening
the publication policy.

Delivered:

- the normal path is `analyzed → verified → published`;
- unresolved candidates enter batched `deep_review` instead of
  `manual_review`;
- an independent Luna low pass can repair evidence-backed structure and a
  medium pass is allowed only after an unresolved low pass;
- unresolved low-value cases enter timed quarantine; at most three dangerous
  or high-value root causes per day become `manual_exception`;
- lease expiry and retry exhaustion return work to automatic resolution;
- a publication preflight failure isolates one candidate and never rolls back
  the valid source package.

Verification:

- model policy rejects every non-Luna AI run and rejects medium reasoning
  outside `candidate_deep_review`;
- dangerous candidates cannot pass without rollback and deterministic risk
  classification;
- repaired payload hashes are recorded in verification receipts without
  changing candidate identity or creating duplicates.

Completed: 2026-07-19

### [x] P0.7.2 — Fast extraction and work-conserving scheduling

Goal: make executor count translate into published knowledge rather than
additional discovery and per-fragment AI overhead.

Delivered:

- Domain Kit exposes an optional pack-owned `DeterministicExtractor`;
- Network Pack mechanically extracts structured command-reference sections in
  batches of 100 and sends only ambiguous sections to Luna;
- analysis batches accept 16 fragments / 64 KiB / up to 50 candidates;
- verification batches accept 50 candidates and start at 32 candidates,
  15 seconds, or source-analysis completion;
- four independent active-source slots keep analysis, verification, and deep
  review supplied concurrently;
- source discovery maintains a 20-document buffer and official collections
  expand mechanically with HTTPS, vendor-domain, redirect, DNS/IP SSRF,
  depth, page, and link limits;
- repeated discovery queries are cooled down and collection metrics track
  unique yield and avoided duplicates.

Completed: 2026-07-19

### [x] P0.7.3 — Non-blocking publication and reconciliation

Goal: recover existing throughput and reduce release overhead without changing
immutable revision semantics.

Delivered:

- ready packages coalesce into release windows of up to 1,000 revisions;
- candidate revision creation and content identity are idempotent;
- release activation remains serialized with PostgreSQL transaction advisory
  locking while extraction continues;
- source completion distinguishes clean completion from automatic exceptions;
- legacy `manual_review` rows migrate to deep review, recoverable failed
  sources return to verification, and failed publication tasks receive
  reconciliation receipts;
- valid candidates from recovered sources publish without duplicating existing
  revisions.

Completed: 2026-07-19

### [x] P0.7.4 — Shared admin/demo observability

Delivered:

- Overview reports projected publications/day, automatic resolution,
  executor utilization, batch sizes, discovery yield, publication failures,
  and deep-review throughput;
- Active Sources shows four real source lanes;
- Pipeline includes Deep review;
- Review Exceptions exposes rare manual exceptions and quarantined records,
  with policy-gated retry, publish, and reject actions for `super_admin`;
- `/admin` and `/demo` still use the same 17-page `OperationsApp`; demo reads
  the same production contracts, redacts source identity server-side, and
  cannot issue mutations.

Completed: 2026-07-19

### [~] P0.7.5 — Quality gate, deployment, and observation

Acceptance:

- migration 014 applies both to a clean database and a restored production
  snapshot;
- PostgreSQL integration tests run without skip;
- typecheck, all tests, production build, product eval, and security checks
  pass;
- backup precedes rollout, pipeline Pause stops Luna, production SHA matches
  `main`, and Resume restores four unique executor lanes;
- initial source-to-release smoke test passes without a package-wide rollback;
- rolling throughput is observed after deployment; 2-hour and 24-hour figures
  are reported only after those windows actually elapse.

### [x] D1.1 — `@clideck/domain-kit`

Goal: define the stable, versioned extension contract used by every knowledge
domain.

Deliverables:

- strict `DomainPackManifestV1`;
- typed `DomainPack` runtime contract;
- universal candidate/revision envelope;
- explicit local pack registry with compatibility checks;
- JSON Schema 2020-12 export;
- reusable conformance suite;
- invariant core policies that packs cannot disable.

Acceptance:

- valid packs load deterministically;
- unknown fields, duplicate IDs, invalid versions, and incompatible packs fail;
- schemas can be exported for Codex and third-party tooling;
- conformance tests pass.

Verification:

- strict manifest, compatibility, registry, publication-policy, JSON Schema,
  and conformance tests: 6/6 passed;
- root typecheck, existing tests, and production build passed;
- no network runtime or database code changed.

Completed: 2026-07-19

### [x] D1.2 — PostgreSQL domain compatibility layer

Goal: extend the existing immutable storage and release engine without
reprocessing network data.

Deliverables:

- `domain_packs` catalog;
- `domain_id`, versioned context, and payload storage;
- pack-defined safe record type slugs;
- network-only relational constraints retained through conditional checks;
- JSONB indexes for used containment/search paths;
- network views and search explicitly scoped to `network`;
- additive migration validated against existing revisions.

Acceptance:

- existing rows become `network` automatically;
- generic records can coexist in the same active release;
- existing network queries cannot return generic records;
- previous application code can safely ignore the additive columns.

Verification:

- all migrations applied to a clean PostgreSQL 16 test database;
- the database seeded 50/50 records as `network` without reprocessing;
- a transactional generic revision produced 51 records in the domain view while
  the network view remained at 50;
- domain context and payload were included in the FTS document;
- 61/61 backend and PostgreSQL integration tests passed without skip;
- typecheck and production build passed.

Completed: 2026-07-19

### [x] D1.3 — Network Domain Pack

Goal: make the production network implementation the first built-in domain pack
without changing its public tools or deterministic behavior.

Deliverables:

- `domains/network` manifest and schemas;
- adapter between current network candidate/revision types and Domain Kit;
- Cisco, Junos, and EOS compatibility fixtures;
- unchanged public network tool schemas.

Acceptance:

- all existing network regression tests pass;
- existing release and risk behavior is unchanged;
- network candidate publication uses the pack adapter.

Verification:

- the built-in registry loads the Network pack through the same compatibility
  gate used by future packs;
- Cisco IOS XE, Junos, and Arista EOS fixtures map to the core envelope;
- Network pack conformance and validation tests: 3/3 passed;
- 61/61 backend/PostgreSQL tests, 6 Domain Kit tests, and 5 admin tests passed;
- current typecheck and production build passed.

Completed: 2026-07-19

### [x] D1.4 — Scaffolder and authoring documentation

Goal: let a developer and their Codex create a safe fork-specific domain without
editing core internals.

Deliverables:

- `pnpm domain:create -- --id <id> --name "<name>"`;
- `pnpm domain:validate -- --id <id>`;
- generated manifest, schemas, adapter, fixtures, tests, and README;
- `docs/DOMAIN_PACK_AUTHORING.md`;
- `docs/FORKING_WITH_CODEX.md`;
- agent guidance in `AGENTS.md`;
- type-only ArtifactStore, SpatialProvider, RelationProvider, and LabValidator
  extension boundaries.

Acceptance:

- a generated pack passes validation before custom logic is added;
- invalid or incompatible packs fail with actionable messages;
- documentation explains safe core/extension boundaries.

Verification:

- `pnpm domain:validate -- --id network` passed seven conformance checks and
  exported four schema documents in memory;
- scaffolder argument, traversal, replacement, duplicate, and generated-pack
  conformance tests passed;
- the generated template is a runnable strict pack, not placeholder prose;
- ArtifactStore, SpatialProvider, RelationProvider, and LabValidator boundaries
  are typechecked;
- 64/64 backend/PostgreSQL tests, 9 built-in pack tests, and 5 admin tests
  passed;
- production build passed.

Completed: 2026-07-19

### [x] D1.5 — Day-one quality gate

Goal: prove that the abstraction is additive and production-safe.

Acceptance:

- all PostgreSQL integration tests run without skip;
- migrations apply to a populated test database;
- existing MCP schemas and network search remain compatible;
- `pnpm check`, `pnpm test`, and `pnpm build` pass;
- this tracker is updated and all completed stages are pushed to `main`.

Verification:

- a PostgreSQL database was seeded under migrations 001–009 and then upgraded
  with migration 010; all 50 revisions remained available as Network records;
- 64/64 backend and PostgreSQL integration tests ran without skip;
- Domain Kit 6/6, Network pack 3/3, and admin UI 5/5 tests passed;
- product eval: 250/250 passed, dangerous false-safe 0, p95 16.03 ms;
- typecheck and production build passed;
- every Day-one stage was committed and pushed directly to `main`.

Completed: 2026-07-19

## Day 2 — second domain and public proof

### [x] D2.1 — Engineering Measurements pack

Goal: prove that the framework is not network-specific.

Deliverables:

- context dimensions: discipline, quantity, material/system, conditions;
- record types: measurement, tolerance, procedure, conversion;
- exact decimal strings, normalized unit codes, explicit tolerance bounds;
- deterministic dimensional and tolerance validation;
- 15–25 project-authored sample records;
- full validate → revision → release → query vertical.

Acceptance:

- data is published by the same immutable release engine;
- exact values survive round-trips without JavaScript number precision loss;
- fixtures contain no copied vendor/manual text.

Verification:

- 16 project-authored records cover measurements, tolerances, procedures, and
  conversions;
- decimal comparison and storage use strings throughout; a PostgreSQL
  round-trip preserved `100.000` and the `0.010` tolerance exactly;
- deterministic validation rejects reversed bounds, negative plus/minus
  magnitudes, unit/dimension mismatches, false-safe risk, and non-positive
  conversion factors;
- the integration test published all 16 records through the existing immutable
  release engine and found the expected record through deterministic FTS,
  context containment, and pack-specific output validation;
- the active Network view did not change when the Engineering release became
  active;
- 65/65 backend and PostgreSQL tests, 13 built-in pack tests, and 5 admin UI
  tests passed without skip; typecheck and production build passed.

Completed: 2026-07-19

### [x] D2.2 — Generic MCP tools

Deliverables:

- `list_knowledge_domains`;
- `describe_knowledge_domain`;
- `query_domain_knowledge`.

Acceptance:

- pack-specific input and output are validated before execution and response;
- unknown domains and invalid contexts fail explicitly;
- existing network tools remain unchanged.

Verification:

- all three generic tools were listed and called through a real MCP SDK Client
  over the SDK in-memory transport;
- the catalog reports both built-in packs and the description tool exports
  Draft 2020-12 context/public-record schemas;
- generic query returned the exact Engineering value through structured
  content after pack-specific context and response validation;
- invalid context returns `INVALID_DOMAIN_CONTEXT`, and an unknown pack returns
  `UNKNOWN_DOMAIN` without leaking an internal error;
- all 13 existing network/product tools remain registered with their original
  names; the server now exposes 16 tools in total;
- 65/65 backend and PostgreSQL tests, 13 built-in pack tests, and 5 admin UI
  tests passed without skip; typecheck and production build passed.

Completed: 2026-07-19

### [x] D2.3 / 0.6.1 — Exact read-only operations demo

URL: `https://mcp.clideck.com/demo`

Deliverables:

- one `OperationsApp`, `AppShell`, page registry, navigation registry, and
  compiled frontend artifact for `/admin` and `/demo`;
- all 16 real sections: Overview, Pipeline, Active Source, Agent Runs,
  Coverage, Sources, Knowledge, Imports, Quality, Lab, Conflicts, Feedback,
  Expert Tasks, Releases, Approvals, and Provenance;
- the same real production records, filters, pagination, tables, charts,
  controls, forms, and confirmation dialogs;
- mirrored GET-only public endpoints returning the strict admin contracts;
- no public login or admin session.

Security boundary:

- the server replaces source identity — source/document/manual title and URL,
  section locator, evidence fragment, content hashes, and source-bearing free
  text — with `XXXXXXXX`;
- tenant ownership and private task/revision linkage are omitted;
- safe IDs, status, timestamps, counters, release state, Luna activity, token
  data, and other allowlisted admin fields remain real;
- every mutation control remains visible and opens the same real dialog;
- Pause/Resume remains a direct control and no longer asks for a reason or
  confirmation phrase;
- the `public_demo` executor stops at final confirmation, returns
  `Read-only demo — no changes were made`, and performs no fetch;
- POST, PUT, PATCH, and DELETE under `/public/v1/demo/*` return 405 before
  domain logic and cannot create an audit event or database change;
- browser blur is not treated as security.

Truthfulness rule:

- there is no separately designed showcase dashboard and no fabricated
  dataset;
- `/admin` and `/demo` serve one byte-identical frontend artifact; only the
  runtime role, API prefix, source sanitizer, and final action executor differ;
- changes to an admin component therefore cannot ship to one route without
  shipping to the other;
- real Network production totals and pipeline activity are shown as reported
  by the active database at request time.

Verification:

- component parity test confirms the same 16 navigation and page registry
  entries for both roles;
- confirmation-flow test enters the real reason and confirmation phrase,
  receives the read-only result, and proves that `fetch` was never called;
- a PostgreSQL integration test reads every real admin model, inserts sentinel
  source URL, manual title, evidence fragment, task result, and failure text,
  and proves the public JSON contains `XXXXXXXX` but none of the sentinels;
- the same test proves IDs remain visible, all admin Zod contracts pass, all
  four mutation methods return 405, and the feature flag returns 404;
- 83/83 backend and PostgreSQL tests, 13 Domain Pack tests, and 8 UI tests pass
  without skip; product eval passes 250/250 with dangerous false-safe 0 and
  known-query p95 6.70 ms;
- Codex Security reported six public-projection disclosures; explicit
  fail-closed projectors now cover release reasons, feedback, pipeline
  free-text/metadata, tenant tasks, legacy aliases, and provenance hashes;
- desktop and 390 px browser QA confirms all 16 sections, source redaction,
  immediate Pause/Resume, retained confirmation dialogs for other actions,
  zero demo-side DB/audit changes, no horizontal overflow, and no console
  errors;
- production deployed
  `0e32b25338f293eb4f97a13e94c920a6f0b30d2d`; health reports 0.6.1 and
  `/demo` returns 200 through the Cloudflare route;
- the production demo rendered all 16 sections with release #62 and 60,111
  active revisions; browser console errors were empty and document width
  remained within the desktop viewport;
- production HTTP checks proved release, feedback, task, pipeline, source, and
  provenance projections redact or omit the six protected data classes, while
  a public POST returned 405;
- clicking production-demo Pause produced the local read-only acknowledgement
  with no dialog; database state remained `enabled`, concurrency remained 4,
  control generation remained 13, and the audit count remained 30;
- the verified PostgreSQL backup and root-only configuration backup precede the
  deployment; the previous checkout remains available for application
  rollback.

Completed: 2026-07-19

### [x] D2.4 — Open-source documentation

Deliverables:

- README positions CliDeck MCP as an agent-native framework for verified,
  continuously updated MCP knowledge systems;
- Network Knowledge is documented as the first production pack;
- Engineering Measurements is documented as the proof pack;
- installation, Codex workflow, pack authoring, screenshots, and demo URL;
- `DATA-NOTICE.md`;
- safe wording: “Runs through your existing local Codex setup. No separate
  model API integration is required. Subject to your Codex plan and usage
  limits.”

Verification:

- README now leads with the framework positioning and explains the core/pack
  boundary, Network production pack, Engineering proof pack, generic MCP tools,
  architecture, local install, Codex MCP connection, LAN admin, and tests;
- the README states that `/demo` is the same `apps/admin` code with a strict
  read-only server contract, not a separate marketing dashboard;
- current Codex CLI documentation was checked for ChatGPT login and
  `codex mcp add <name> --url <url>` syntax;
- `DATA-NOTICE.md` separates Apache-2.0 code/fixture rights from production
  knowledge, documents, user data, provenance, and operator-imported datasets;
- architecture and security documents describe Domain Pack isolation and the
  truthful public-demo boundary;
- project, admin UI, and admin-contract versions are aligned at 0.6.1;
- the README screenshot was captured from the deployed production `/demo`
  route, not a staged or invented dashboard image;
- 66/66 backend/PostgreSQL tests, 13 Domain Pack tests, 7 admin UI tests,
  typecheck, and both admin/demo production builds passed.

Completed: 2026-07-19

## 0.7.1 — Honest pipeline telemetry

### [x] P0.7.1.1 — Real waiting queues and synchronized executors

Goal: make the Overview pipeline answer how much domain work is actually
waiting and ensure its live stages cannot contradict the four Luna cards.

Delivered:

- all eight stages expose their real waiting object count and native unit;
- Deep Review counts eligible candidates rather than queued batch tasks;
- the funnel and executor cards share one PostgreSQL runtime snapshot;
- executor stage comes from the current leased task, not stale heartbeat
  metadata;
- stale, standby, paused, Luna, and mechanical worker states are separated;
- the shared admin/demo UI uses `Waiting`, `Running`, `Done`, and `Failed`;
- the operations canvas supports eight stages in one wide row, balanced `4 × 2`
  desktop, `2 × 4` tablet, and single-column mobile layouts;
- source identity remains redacted by the public demo projection.

Verification:

- PostgreSQL snapshot integration coverage includes all eight queues, two Luna
  stages, stale heartbeat metadata, and a mechanical worker;
- admin/demo component coverage confirms the same eight-stage registry and
  concise labels;
- typecheck, PostgreSQL tests without skip, production build, eval, rendered
  desktop QA, and production smoke checks passed;
- deployed API and LAN admin use the same Git SHA; no knowledge release or
  pipeline state was changed.

Completed: 2026-07-19

## 0.7.2 — Streaming publication and saturated Luna lanes

### [~] P0.7.2.1 — Prepared source buffer and dynamic AI scheduling

Goal: keep eight converted/chunked sources ready while four independent Luna
lanes perform useful expert, medium-review, verification, low-review, analysis,
or discovery work.

Delivered:

- `prepared` separates mechanical intake from the four active analysis lanes;
- the scheduler maintains a target of eight prepared sources and twenty
  discovered sources;
- medium Deep Review is selected before low review and is no longer starved;
- fixed Deep Review concurrency was removed; the common 1–4 Luna setting now
  controls every AI stage;
- identical Codex process failures open a 30-second circuit breaker followed
  by one probe lane instead of creating a token-consuming failure storm.

Verification pending production rollout.

### [~] P0.7.2.2 — Incremental releases and streaming publication

Goal: publish verified records within 30 seconds or in batches of 50 without
waiting for sibling records or copying the full active knowledge snapshot.

Delivered:

- atomic `candidate_publication` reservations;
- delta `release_changes` and indexed `active_knowledge_state`;
- a full checkpoint every 120 releases;
- exact arbitrary-release restoration from the closest checkpoint plus deltas;
- per-record publication preflight that sends only invalid records back to
  Deep Review while publishing the rest of the batch.

Verification pending production rollout.

### [~] P0.7.2.3 — Result-oriented operations UI

Goal: make throughput and conservation understandable without exposing task
batch counts as product output.

Delivered:

- Source Intake uses native source/document/fragment units;
- Knowledge Records uses records only for Verify, Deep Low, Deep Medium, Ready,
  and Published;
- executor cards show batch size and unit;
- Agent Runs retains process diagnostics, retries, tokens, and fingerprints;
- `/admin` and `/demo` continue to share the same `OperationsApp`.

Verification pending browser QA and production rollout.

### [~] P0.7.2.4 — Downstream-weighted Luna scheduling

Goal: prioritize knowledge nearest publication without starving Verify,
Analyze, or future source supply.

Delivered:

- Ready records keep the highest deterministic publication priority;
- Luna priority is Expert, Deep Medium, Deep Low, Verify, Analyze, then
  Discover/Refresh;
- four available lanes use a downstream-weighted split: `2/1/1` for three
  waiting stages, `3/1` for two stages, or all four for the only useful stage;
- existing paid runs are never preempted; the mix converges as lanes finish;
- queued tasks from an older deployment have their numeric priority normalized
  before claiming;
- Source Intake now shows Downloaded as a real sixth rail card, and every
  running stage displays the number of assigned Luna or mechanical workers.

Verification:

- weighted allocation unit coverage includes Deep Low + Verify + Analyze,
  Deep Medium dominance, two-stage and single-stage saturation, and convergence
  from the previous Analyze-heavy allocation;
- 95 backend/PostgreSQL tests, 14 Domain Pack tests, and 11 admin UI tests
  passed on a newly migrated database;
- typecheck, production build, 250/250 product eval, dangerous false-safe 0,
  dependency audit, and diff validation passed.

Production verification pending rollout.

## 0.7.3 — Confirmed pipeline transition visualization

### [x] P0.7.3.1 — Transactional transition telemetry

Goal: visualize only status changes that the backend actually committed.

Delivered:

- append-only `pipeline_transition_events` records aggregated source/record
  transitions in the same PostgreSQL transaction as the corresponding status
  update;
- cursor-based admin and public-demo reads expose counts, stages, kinds, and
  timestamps without task IDs, source identity, fragments, or provenance;
- the first request primes the cursor without replaying historical activity;
- cursor pagination, idempotency, every allowed route, and transaction rollback
  are covered by PostgreSQL integration tests.

### [x] P0.7.3.2 — Shared productive-motion UI

Goal: show where committed work moved without decorative or misleading motion.

Delivered:

- `/admin` and `/demo` use the same `PipelineFlow` component around the same
  Source Intake and Knowledge Records rails;
- same-route events are aggregated into a `+N From → To` impulse, at most six
  routes animate per refresh, and twelve remain in `Last transitions`;
- terminal outcomes are visible as Rejected, Conflict, Quarantine, and
  Exception cards;
- cards remain fixed while a thin orthogonal SVG rail and one compact badge
  move above them; mobile uses a vertical route;
- Overview is refreshed successfully before an event becomes visible, so an
  animation cannot accompany stale counters;
- initial load, hidden/stale events, unavailable data, and reduced-motion
  behavior suppress movement appropriately.

Verification:

- clean PostgreSQL 16 migrations 001–019 and grants succeeded;
- 102 backend/PostgreSQL tests, 14 Domain Pack tests, and 14 admin UI tests
  passed without skip;
- Node.js 24 typecheck and production build passed;
- product eval passed 250/250 with dangerous false-safe 0 and p95 11.46 ms;
- production dependency audit and diff secret/provenance scan found no issue.

The scheduler observation requested before rollout ran from
`2026-07-20 00:59:06 UTC` through `2026-07-20 01:53:43 UTC`. It was ended early
by the explicit request for immediate deployment, so it is not reported as a
two-hour result. During that bounded interval active knowledge increased to
64,583, release sequence reached 289, and 567 delta changes were published.

Production deployment and browser QA completed:

- the first production smoke check exposed a least-privilege mismatch:
  PostgreSQL reads the explicit `dedupe_key` conflict target used by
  `ON CONFLICT DO NOTHING`, while the worker roles initially had only `INSERT`;
- migration 019 grants those roles column-level `SELECT` on `dedupe_key` only,
  and an integration regression verifies both writer roles;
- cursor ordering uses the numeric identity column rather than its text
  projection; a regression crosses the `99 → 100` boundary and proves that
  acknowledged events are neither replayed nor skipped;
- after the grant, real committed transitions appeared immediately across
  Acquire, Convert, Chunk, Analyze, Deep Low, and Publish, including a
  26-record `Ready → Published` transition;
- the public demo displayed the same production Overview and all real
  transition history without internal task/source references;
- browser QA passed at 1920px, 1440px, tablet, mobile, and reduced motion,
  without horizontal overflow or a separate demo component tree.

## Final day — release and submission

### [~] CliDeck MCP 0.7.4 — knowledge quality and public MCP reliability

Goal: remove quarantine as a normal terminal state, add operational IOS-XE
workflows, shorten change-verification credentials, and make public reads
predictable under load.

Implemented locally:

- medium Deep Review now resolves a supported candidate to verified/conflict or
  rejects only the unsupported candidate claim; an official vendor passage is
  sufficient evidence and does not require a second source;
- Deep Review repair now transmits only a validated compact patch, not a full
  duplicate candidate: server-held provenance and unchanged fields are
  preserved, explicit null means no change, and only five nullable
  applicability/CLI fields may be explicitly cleared;
- omitted candidates, Codex process failures, and exhausted leases remain
  automatically retryable and reduce their batch size instead of entering
  quarantine;
- migration 020 adds short hashed verification sessions, expert-task
  idempotency, public-stats cache state, reconciliation snapshots, and
  structured technical retry fields;
- the reconciliation command snapshots every existing quarantined status before
  returning it to automatic Deep Review;
- nine Catalyst 9300 / IOS-XE operational workflows cover trunk inspection,
  additive VLAN changes, trunk removal and end-to-end checks, err-disable,
  port-security diagnosis/recovery, BPDU Guard, and interface descriptions;
- public limit inputs are clamped server-side, topology parsing handles more
  CDP/LLDP/traceroute forms and refuses self-loops, and transient PostgreSQL
  failures expose a stable retryable MCP error;
- `/public/v1/stats` reads one precomputed row; the heavy refresh runs under a
  worker lock after releases/evals and retains the last successful snapshot;
- the single production deployment entrypoint now owns pause, lease drain,
  backup, migration, reconciliation, seed, cache priming, smoke, state restore,
  and application/knowledge rollback.

Verified locally:

- clean PostgreSQL migrations 001–020 and 59-item authored IOS-XE seed;
- 23/23 PostgreSQL integration tests without skip, including short reusable
  handles, tamper/expiry/legacy-token behavior, idempotent expert tasks, cache
  latency, and automatic retry after a medium-review omission;
- all 107 backend/PostgreSQL tests and 14 UI tests passed;
- product eval 250/250, dangerous false-safe 0, p95 10.38 ms;
- typecheck, unit/UI suites, production build, shell syntax, and diff checks.
- compact-repair regressions prove that a strict-output null cannot erase an
  existing field, provenance cannot be replaced, and an allowed explicit clear
  remains narrowly scoped.
- scoped AI circuits now reclaim a probe reservation after a deploy or
  supervisor restart only when its exact executor has no live matching lease;
  this prevents an expired Medium probe from starving the entire Medium queue
  while retaining the single-probe safety invariant.
- after a complete Deep Review artifact, an unreserved cohort recovers its
  batch limit gradually (1 → 2 → 4 → 8 → 16 → 20); malformed/omitted output
  still shrinks only its affected batch, and every widened result passes the
  same Domain Pack, risk, version, conflict, and publication gates.

Remaining for completion: one local `main` commit, the unified production
deployment, reconciliation accounting, 20 live MCP acceptance scenarios, and
production latency/security smoke checks.

### [~] CliDeck MCP 0.8.4 — portable OS and version compatibility

Goal: reuse OS-wide knowledge across equipment vendors without weakening
model, architecture, version, risk, or provenance boundaries.

Implemented locally:

- migration 026 adds software families, aliases, inheritance, OS memberships,
  platform architecture, revision applicability, exclusions, and resumable
  reindex manifests;
- ONIE, SONiC, OpenWrt, Debian/Linux tooling, and Cumulus/NVUE are portable
  families; NX-OS and IOS-XE retain vendor ownership while gaining explicit
  `major.minor` branch matching;
- the context resolver accepts OS-only and unknown-vendor portable queries,
  preserves an unrecognized requested model, and retains strict behavior for
  vendor-specific operating systems;
- retrieval ranks exact model, vendor OS, architecture, and OS-family scopes,
  then exact, range, branch, unbounded, and same-branch patch compatibility;
- public answers add match, version, assurance, and platform-confirmation
  metadata without changing existing MCP tool names or removing commands;
- generic and same-branch best-effort answers queue a lower-priority
  specificity gap, while a true unknown retains priority 120;
- `knowledge:reindex-applicability -- --resume --verify` processes immutable
  revisions in committed batches, records a checksum manifest, verifies
  conservation, and does not rebuild FTS;
- deterministically safe portable inspection commands such as `onie-sysinfo`
  receive new immutable safe revisions in one supplemental release; old
  revisions are not edited;
- Knowledge filters now expose family, scope, and version policy, while Imports
  shows the latest applicability reconciliation run.

Verified before release:

- a fresh PostgreSQL database applied migrations 001–026, seeded knowledge,
  completed the applicability index twice without duplicate rows, and retained
  exact revision/index conservation;
- integration coverage proves unknown-vendor ONIE reuse, exact model overlay
  precedence, platform and version exclusions, and full command return;
- unit coverage proves NX-OS same-branch patch fallback, cross-branch refusal,
  calendar branches, match assurance, and safe portable inspection risk;
- 153 backend/PostgreSQL tests, 14 Domain Pack tests, and 15 admin UI tests
  passed without skip;
- product eval passed 250/250 with dangerous false-safe 0 and known-query p95
  9.45 ms; typecheck, production build, shell syntax, and diff checks passed.
- the first canonical rollout attempt stopped safely during its isolated local
  preflight because seed revisions had not yet received the new derived index;
  the canonical script now runs the verified reindex between seed and tests,
  before any remote backup, switch, or production mutation.
- the next conservation gate found legacy network revisions with no OS; rollout
  again stopped before checkout switch and restored release #1220. Migration
  027 maps those immutable records to a vendor-level family that is added only
  for the requested vendor, including portable-OS queries without cross-vendor
  inheritance. A synthetic no-OS revision then passed exact 60/60 conservation
  and all 40 focused PostgreSQL scenarios.
- the corrected production backfill indexed all 71,416 immutable network
  revisions with exact conservation, including 1,884 portable revisions. The
  supplemental risk-repair then found a legacy inspection record without the
  Network Pack's required command/procedure content; rollout again preserved
  release #1220 and did not switch application checkout. Risk reconciliation
  now isolates each legacy candidate with a PostgreSQL savepoint, records
  deterministic Domain Pack validation skips by reason, and continues the
  safe immutable corrections without hiding unexpected database failures.

Remaining: production backup and canonical deployment, 14 real public MCP
scenarios, latency/query-plan review, and production conservation accounting.

### [x] D3.1 — Security and release gate

- scan repository contents and full Git history for secrets and provenance;
- back up production PostgreSQL and deployment configuration;
- apply the additive migration;
- run network, generic MCP, demo, performance, and dangerous-safety smoke tests;
- capture the deployed real `/demo` UI and add that exact production screenshot
  to the README;
- make the repository public only after the gate passes;
- tag the verified release `v0.6.0-build-week`.

Completed so far:

- the repository-wide Codex Security scan closed all 40 review surfaces and
  produced a final report for 14 findings: 4 medium, 10 low, no high or
  critical findings;
- all 14 earlier findings retain code remediations and focused regressions;
  six additional public-demo diff findings now cover release reasons,
  feedback, event text/metadata, tenant tasks, legacy provenance aliases, and
  provenance hashes;
- the complete Git history was scanned for common secret patterns without a
  match, and ignored local credentials remain outside the tracked tree;
- a fresh production PostgreSQL custom-format backup and a root-only deployment
  configuration backup were created and checksum-verified;
- a clean PostgreSQL database applied migrations 001–012; 77 backend and
  PostgreSQL tests, 13 Domain Pack tests, and 7 UI tests passed without skip;
- product eval passed 250/250 with dangerous false-safe 0 and known-query
  p95 3.61 ms; typecheck, production build, and diff checks passed.
- production applied migrations 010–013 and published 16 authored Engineering
  records in immutable release #53 alongside existing Network knowledge;
- production smoke tests passed for health, readiness, all 16 MCP tools, known
  Network search, generic domain discovery, exact Engineering conversion, and
  fail-closed multiline change review;
- `/admin` and `/demo` serve byte-identical HTML and frontend asset bytes; the
  deployed public route displayed 60,052 active revisions, real hourly
  publications, real pipeline stages, and four active Luna executors;
- browser QA exercised Overview and Pipeline navigation plus the existing
  contextual-help trigger against the real production snapshot;
- the README screenshot was captured from the deployed production route after
  those checks;
- the repository was published only after this gate and tagged
  `v0.6.0-build-week`.

Completed: 2026-07-19

### [ ] D3.2 — Build Week submission

- public YouTube demo shorter than three minutes with audio;
- show Network Knowledge, continuous Luna pipeline, Domain Pack abstraction,
  Engineering Measurements, scaffolding, and public demo;
- finish Devpost description, repository URL, demo URL, and `/feedback` Session
  ID.

## Required acceptance suite

- all existing network MCP tools remain compatible;
- 58,904 baseline revisions remain available without reprocessing;
- incompatible packs cannot load;
- packs cannot bypass immutable releases, provenance, trust, conflicts, or risk
  policy;
- generic records do not appear in network search;
- demo has no admin credentials or mutation endpoints;
- sentinel source, secret, and provenance values do not appear in demo JSON,
  HTML, JavaScript, or logs;
- PostgreSQL integration tests run without skip;
- known network query p95 remains at or below 300 ms;
- dangerous false-safe remains zero.

## Rollback

- stop rollout before switching the active release when possible;
- restore the previous application checkout;
- atomically reactivate the previous knowledge release;
- keep additive domain columns and immutable revisions;
- disable `/demo` with its feature flag.

## Post-contest backlog

- generalize Coverage Planner and the Luna pipeline for all packs;
- add graph relations without replacing PostgreSQL as the source of truth;
- provide S3 and PostGIS recipes and production adapters;
- add external pack registry and signing policy;
- expand storage, renderer, source connector, and lab-provider interfaces;
- publish conformance badges and upgrade compatibility guidance for fork owners.
