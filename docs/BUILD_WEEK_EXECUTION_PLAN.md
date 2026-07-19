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

`D3.2 — Build Week submission`

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

### [x] D2.3 — Public read-only operations demo

URL: `https://mcp.clideck.com/demo`

Deliverables:

- the exact same compiled `apps/admin` bundle used by the LAN console, with
  the same shell, pages, charts, formatters, responsive rules, JS, and CSS;
- the real Overview, Pipeline, Coverage, and Quality screens;
- `GET /public/v1/demo/snapshot`;
- real production aggregate metrics, publication trends, funnel, safe coverage,
  executor state, token efficiency, eval results, and allowlisted sample
  answers;
- no login or mutation controls.

Security boundary:

- public mode never calls the admin API or creates an admin session;
- source URLs/titles, evidence, provenance, task IDs, fragment IDs, questions,
  internal errors, hostnames, credentials, and audit records are omitted at the
  server contract;
- source names are replaced with an explicit “Source identity withheld” label
  only after the server has removed the underlying values;
- browser blur is not treated as security;
- production knowledge data is not included in the repository.

Truthfulness rule:

- there is no separately designed showcase dashboard and no fabricated
  dataset;
- `/admin` and `/demo` serve one byte-identical frontend artifact; only
  authorization, available sections/actions, and the server-provided data
  contract differ;
- changes to an admin component therefore cannot ship to one route without
  shipping to the other;
- real Network production totals and pipeline activity are shown as reported
  by the active database at request time.

Verification:

- the strict public snapshot is assembled from real database queries plus the
  existing Overview, Coverage, Pipeline, and Quality admin functions;
- a PostgreSQL integration test inserted a sentinel source URL, title, payload,
  UUID, and failure message; none appeared in the returned public JSON;
- POST and unknown `/public/v1/demo/*` routes return 404, and the entire feature
  returns 404 when `ENABLE_PUBLIC_DEMO=false`;
- public UI tests confirmed the real admin shell renders while Pause, executor
  configuration, Sources, Provenance, and other mutation surfaces are absent;
- local browser checks opened all four sections, confirmed real rows and
  metrics, no horizontal overflow, no browser errors, and working mobile
  navigation at 390 px;
- desktop visual comparison retained the production admin's published-first
  hierarchy, hourly chart, pipeline rail, executor cards, restrained status
  color, and compact navigation. The concept's dark sidebar and invented cards
  were intentionally rejected so the demo remains identical to the real admin
  instead of becoming a marketing mockup;
- typecheck, 16/16 PostgreSQL integration tests, 7/7 admin UI tests, and the
  single shared production frontend build passed.

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
- project, admin UI, and admin-contract versions are aligned at 0.6.0;
- the README screenshot was captured from the deployed production `/demo`
  route, not a staged or invented dashboard image;
- 66/66 backend/PostgreSQL tests, 13 Domain Pack tests, 7 admin UI tests,
  typecheck, and both admin/demo production builds passed.

Completed: 2026-07-19

## Final day — release and submission

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
- all 14 findings have code remediations and focused regressions in the release
  worktree, including child-process capability isolation, public-output
  redaction, fail-closed change canonicalization, SSRF/parser bounds, atomic
  publication and lease transitions, public-reference separation, and
  evidence-derived lab assurance;
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
