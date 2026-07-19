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

`D1.3 — Network Domain Pack`

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

### [~] D1.3 — Network Domain Pack

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

### [ ] D1.4 — Scaffolder and authoring documentation

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

### [ ] D1.5 — Day-one quality gate

Goal: prove that the abstraction is additive and production-safe.

Acceptance:

- all PostgreSQL integration tests run without skip;
- migrations apply to a populated test database;
- existing MCP schemas and network search remain compatible;
- `pnpm check`, `pnpm test`, and `pnpm build` pass;
- this tracker is updated and all completed stages are pushed to `main`.

## Day 2 — second domain and public proof

### [ ] D2.1 — Engineering Measurements pack

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

### [ ] D2.2 — Generic MCP tools

Deliverables:

- `list_knowledge_domains`;
- `describe_knowledge_domain`;
- `query_domain_knowledge`.

Acceptance:

- pack-specific input and output are validated before execution and response;
- unknown domains and invalid contexts fail explicitly;
- existing network tools remain unchanged.

### [ ] D2.3 — Public read-only operations demo

URL: `https://mcp.clideck.com/demo`

Deliverables:

- separate Vite demo build reusing the LAN console visual system;
- Overview, Pipeline, Coverage, Knowledge Domains, and Quality screens;
- `GET /public/v1/demo/snapshot`;
- live aggregate metrics, publication trends, funnel, safe coverage, executor
  count, token efficiency, eval, and allowlisted sample answers;
- no login or mutation controls.

Security boundary:

- no admin API or admin session is reachable from the demo;
- source URLs/titles, evidence, provenance, task IDs, fragment IDs, questions,
  internal errors, hostnames, credentials, and audit records are omitted at the
  server contract;
- browser blur is not treated as security;
- production knowledge data is not included in the repository.

### [ ] D2.4 — Open-source documentation

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

## Final day — release and submission

### [ ] D3.1 — Security and release gate

- scan repository contents and full Git history for secrets and provenance;
- back up production PostgreSQL and deployment configuration;
- apply the additive migration;
- run network, generic MCP, demo, performance, and dangerous-safety smoke tests;
- make the repository public only after the gate passes;
- tag the verified release `v0.6.0-build-week`.

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
