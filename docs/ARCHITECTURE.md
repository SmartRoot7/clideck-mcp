# Architecture

## Product contract

CliDeck MCP is a universal MCP server. It resolves network-device context and
returns deterministic, version-scoped operational knowledge without calling an
AI model in the read path.

The production MCP URL is `https://mcp.clideck.com/mcp`. The displayed server
name is `CliDeck MCP — Network Knowledge`.

## Process boundaries

1. `clideck-mcp-api` exposes the public MCP endpoint, health/readiness/metrics,
   and an authenticated admin API.
2. `clideck-mcp-worker` expires tasks, releases stale leases, validates candidate
   revisions, and atomically publishes eligible releases.
3. `clideck-mcp-researcher` exposes a loopback-only, token-protected MCP surface
   used by a Codex Automation. It cannot read client credentials or administer
   the host.

PostgreSQL 16 is the only stateful dependency. The API and researcher processes
are stateless.

## Knowledge model

`knowledge_items` provides a stable identity. `knowledge_revisions` is append-only
and contains structured facts. `releases` and `release_items` form immutable
snapshots. `active_release` contains one row and is switched in a transaction.

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

## Task lifecycle

The durable state machine is:

`queued → claimed → researching → input_required → validating → completed`

Terminal alternatives are `failed`, `cancelled`, and `expired`. Claims use
`FOR UPDATE SKIP LOCKED`, bounded leases, heartbeats, and attempt limits.

Authenticated tasks are tied to a tenant. Anonymous tasks use 192-bit random
public IDs, a separate 256-bit access token, short TTL, and lower rate limits.
Only a hash of the access token is stored.

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

## Deliberate exclusions

Redis, vector databases, external LLM APIs, full manuals, closed documents, and
user logs are not part of the architecture.
