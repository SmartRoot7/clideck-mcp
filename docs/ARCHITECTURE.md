# Architecture

## Product contract

CliDeck MCP is an agent-native framework for verified, continuously updated MCP
knowledge systems. It returns deterministic, domain-validated knowledge without
calling an AI model in the read path.

The production MCP URL is `https://mcp.clideck.com/mcp`. The displayed server
name remains `CliDeck MCP — Network Knowledge` because Network Knowledge is the
first production Domain Pack and public product instance.

## Process boundaries

1. `clideck-mcp-api` exposes the public MCP endpoint, health/readiness/metrics,
   and an authenticated admin API.
2. `clideck-mcp-worker` downloads public sources, converts and chunks them,
   releases stale leases, validates deterministic gates, and atomically
   publishes source packages.
3. `clideck-mcp-researcher` exposes a loopback-only, token-protected MCP surface
   used by the continuous coordinator. It cannot read client credentials or
   administer the host.
4. A macOS `launchd` coordinator runs ephemeral Codex executions. It gives Luna
   low one bounded discovery, extraction, verification, or expert artifact at a
   time. It has no database credentials and reaches state only through the
   restricted researcher bridge.

PostgreSQL 16 is the only stateful dependency. The API and researcher processes
are stateless.

The browser playground is a BFF-only facade. A browser sends data to
`clideck.com/api/mcp/*`; the site attaches its server-side bearer token and a
daily HMAC client key. The backend exposes only named operations and has no
generic proxy route.

## Domain Pack boundary

`@clideck/domain-kit` defines a versioned contract between core and a subject:

- a strict manifest and core compatibility range;
- context, candidate, and public-record schemas;
- deterministic normalization and validation;
- mapping to and from the universal core revision envelope;
- a conformance suite and JSON Schema export.

Core retains exclusive ownership of immutable revisions, releases, provenance,
confidence/risk thresholds, conflicts, audit, and activation. A pack cannot
lower or bypass those policies. Built-in packs are registered explicitly from
local code; the runtime never downloads and executes a pack from the internet.

Network Knowledge owns vendor/model/OS/version and operational record semantics.
Engineering Measurements owns discipline/quantity/material/conditions, exact
decimal strings, units, and tolerance semantics. Both publish through the same
release engine.

Type-only provider boundaries allow forks to add content-addressed artifacts,
PostGIS-backed spatial data, typed relationship projections, or reproducible
labs without adding speculative infrastructure to core.

## Knowledge model

`knowledge_items` provides a stable identity. `knowledge_revisions` is append-only
and contains structured facts. `releases` and `release_items` form immutable
snapshots. `active_release` contains one row and is switched in a transaction.

Every item has a `domain_id`. Every revision can carry versioned
`domain_context` and `domain_payload`. Existing Network records default to
`network`, so enabling Domain Packs does not reprocess or duplicate them.
Network views are explicitly scoped to `domain_id = 'network'`; generic records
cannot leak into network search.

Every revision must have internal provenance. The public query selects only
explicitly allowlisted response columns; no provenance table is joined by public
queries.

Search ranking combines:

- exact vendor/platform/OS constraints;
- vendor-specific normalized versions and version ranges;
- PostgreSQL `websearch_to_tsquery` full-text rank;
- `pg_trgm` similarity for aliases and typographical variants;
- confidence, quality score, freshness, and conflict penalties.

No vector similarity or generative ranking is used.

The native deep-support pack contains 50 Catalyst 9300 / IOS-XE revisions:
20 commands, 15 change contracts, 10 verification contracts, and 5 bounded
upgrade records. Cisco, Juniper, and Arista models are recognized, while only
the C9300 family is marked deep.

The 0.3 import release adds 56,747 established CliDeck revisions without
changing their search-rank class. Missing OS means vendor-level applicability;
missing version bounds mean unbounded applicability. Original trust, confidence,
quality, lifecycle, risk, and provenance remain in restricted metadata.
Deterministic risk classification may only increase the effective risk.

## Continuous coverage planner

`coverage_targets` is the managed backlog across vendor, family/model, OS,
version branch, document role, priority, coverage, freshness, and next check.
When enabled, the scheduler always chooses useful work in this order:

1. queued expert task;
2. unfinished stage of the active source;
3. next unprocessed fragment;
4. candidate verification;
5. source-package publication;
6. discovery for the highest-priority coverage gap or refresh.

There is no enabled idle state. When all currently due targets are covered, the
oldest covered target is made due and discovery continues. The only idle states
are an explicit super-admin pause or a recorded coordinator system failure.

The source state machine is:

`discover → acquire → convert → chunk → analyze → verify → publish`

Acquire, conversion, local OCR, chunking, hashing, FTS indexing, and publication
are deterministic worker stages. Discovery, fragment analysis, and independent
verification are isolated Luna-low runs. Every run must submit a schema-valid
artifact, an explicit rejection, or a recorded failure. A source is published
once as a single immutable release; rejected fragments and blocked candidates
do not prevent safe verified candidates from publishing.

Pipeline tasks have bounded leases, heartbeats, idempotent dedupe keys, and five
attempts. Transient failures return the same stage to the queue. Exhausted
stages record a terminal source failure, clear the active source, and return the
planner to discovery; a failed source cannot reach publication.

## Product intelligence

- Device fingerprinting and redaction operate in memory and return
  `retention: not_stored`.
- Change Guard classifies commands deterministically and fails closed for
  unknown or destructive input.
- A signed, 30-minute verification token contains checks and a change digest,
  never raw commands.
- Upgrade advice is exact-model and exact-version; an unverified transition
  returns `unknown`.
- Topology analysis normalizes supplied CDP, LLDP, route, and traceroute output.
- Opt-in samples are re-redacted through a dedicated quarantine DB role with a
  30-day TTL.

## Public demo

The public `/demo` and LAN `/admin` are two builds of the same `apps/admin`
source. The public build uses the same pages, charts, components, responsive
rules, and formatters but receives only a strict read-only snapshot.

The snapshot contains real production aggregates and sanitized operational
records. Source identity, provenance, document content, internal UUIDs,
questions, errors, hostnames, and audit records are removed on the server.
Public mode has no session and no mutation endpoint. `ENABLE_PUBLIC_DEMO=false`
removes both the snapshot and static route.

## Expert task lifecycle

The durable state machine is:

`queued → claimed → researching → input_required → validating → completed`

Terminal alternatives are `failed`, `cancelled`, and `expired`. Claims use
`FOR UPDATE SKIP LOCKED`, bounded leases, heartbeats, and attempt limits.

Authenticated tasks are tied to a tenant. Anonymous tasks use 192-bit random
public IDs, a separate 256-bit access token, short TTL, and lower rate limits.
Only a hash of the access token is stored.

The safe public flywheel is:

`queued → researching → conflict_check → validating → publishing → completed`

Public milestones never contain source names, URLs, researcher errors, user
questions, or internal pipeline identifiers.

## Publication

Candidates require:

- at least one internal provenance record;
- a valid vendor/platform/OS/version scope;
- a successful structured validation pass;
- confidence ≥ 0.90, or ≥ 0.95 for dangerous procedures;
- no unresolved blocking conflict.

Publication creates a new immutable release and switches `active_release` in the
same transaction. Rollback switches it to an earlier release; revisions are never
overwritten.

Legacy import is separately resumable by manifest hash and legacy key, but its
activation is one atomic release. The required release contains exactly 56,798
active revisions: 51 current revisions plus 56,747 legacy revisions.

## Lab assurance

Batfish validates bounded Cisco configuration snapshots and differential
reachability. Containerlab runs parser scenarios only with downloadable open
network images. A Cisco revision can receive `batfish_modeled` from a model
check, but cannot receive `runtime_lab_validated` unless a Cisco runtime image
was actually tested.

CI emits a hashed report tied to the Git commit. Production imports it only when
the report commit equals the deployed commit and every check passed.

## Deliberate exclusions

Redis, vector databases, external LLM APIs, full manuals, closed documents, and
user logs are not part of the architecture.
