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

The browser playground is a BFF-only facade. A browser sends data to
`clideck.com/api/mcp/*`; the site attaches its server-side bearer token and a
daily HMAC client key. The backend exposes only named operations and has no
generic proxy route.

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

The first deep-support pack contains 50 Catalyst 9300 / IOS-XE revisions:
20 commands, 15 change contracts, 10 verification contracts, and 5 bounded
upgrade records. Cisco, Juniper, and Arista models are recognized, while only
the C9300 family is marked deep.

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

## Task lifecycle

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
