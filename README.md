# CliDeck MCP

CliDeck MCP is an **agent-native framework for verified, continuously updated
MCP knowledge systems**.

It combines deterministic retrieval, immutable releases, internal provenance,
quality gates, and a continuous Codex-powered research pipeline. The built-in
**Network Knowledge** pack is the first production implementation.
**Engineering Measurements** is a small project-authored proof that the same
core can support a different technical domain without turning network columns
into a fake universal schema.

- Public MCP: `https://mcp.clideck.com/mcp`
- Live read-only operations demo: `https://mcp.clideck.com/demo`
- Product page: `https://clideck.com/software/mcp`
- Runtime: Node.js 24, TypeScript, Hono, Zod 4, MCP TypeScript SDK 1.29
- Storage: PostgreSQL 16, full-text search, and `pg_trgm`
- License: Apache-2.0 for code and project-authored fixtures

Known answers never call an AI model. The read path is deterministic,
version-aware, fast, and explicit when knowledge is missing. AI is used
asynchronously to discover, analyze, and independently verify candidates before
the ordinary worker can publish an immutable release.

## Why this project exists

Most knowledge systems either put an LLM in every answer path or require a
custom ingestion application for every subject. CliDeck MCP separates the
stable safety/release core from subject-specific **Domain Packs**:

- Core owns immutable revisions, releases, provenance, conflicts, confidence
  thresholds, audit, and publication policy.
- A Domain Pack owns its context schema, record types, payload schema,
  deterministic validation, and core mapping.
- Optional providers can add artifacts, spatial data, relations, or lab
  validation without putting credentials or domain assumptions into core.

Runs through your existing local Codex setup. No separate model API integration
is required. Subject to your Codex plan and usage limits.

That means a developer can use their authenticated local Codex installation to
grow a private or public knowledge system without first wiring a separate model
API. This is an operating option, not a promise of free or unlimited usage.

## What is included

### Network Knowledge

The production pack understands vendor, product family, model, operating
system, version scope, CLI mode, risk, verification, and rollback. Its public
tools are:

- `resolve_network_context`
- `query_network_knowledge`
- `get_network_workflow`
- `request_expert_answer`
- `get_expert_task`
- `continue_expert_task`
- `cancel_expert_task`
- `submit_feedback`
- `analyze_device_snapshot`
- `review_network_change`
- `verify_network_change`
- `advise_network_upgrade`
- `analyze_network_path`

CliDeck MCP never connects to a network device and never executes a command.
Raw CLI is processed in memory. An opted-in example is redacted again, isolated,
expires after 30 days, and is never auto-published.

### Generic Domain Pack tools

These additive tools work through the same release engine:

- `list_knowledge_domains`
- `describe_knowledge_domain`
- `query_domain_knowledge`

The generic query validates both its input context and returned record through
the selected pack. Unknown domains, invalid context, and missing knowledge are
reported explicitly instead of guessed.

### Engineering Measurements

The proof pack contains 16 project-authored records across measurements,
tolerances, procedures, and conversions. Exact decimal values remain strings,
units are normalized, and tolerance bounds are checked deterministically. It is
small by design: it proves the extension contract rather than pretending to be
a scientific reference database.

## Truthful public demo

`/demo` is not a mock dashboard. It is a second read-only build of the real
`apps/admin` application:

- the same React source, pages, charts, formatters, breakpoints, and tooltips;
- real aggregate data from the active production database;
- the same Overview, Pipeline, Coverage, and Quality screens;
- no login, admin session, mutation controls, or private endpoints.

The server removes source identity, provenance, document content, internal IDs,
questions, hostnames, audit data, and internal errors before JSON reaches the
browser. Values are not hidden with CSS blur. Public and LAN builds may expose
different permissions and fields, but they do not maintain separate visual
implementations.

## Architecture

```text
public MCP clients ──> API ──> deterministic domain search ──> active release
                         │
                         └──> expert task queue

coverage planner ──> discover ──> acquire ──> convert ──> chunk
                                                  │
                                                  v
                                           Luna analyze
                                                  │
                                                  v
                                           Luna verify
                                                  │
                                                  v
ordinary worker ─────────────────────────> immutable publish
```

PostgreSQL is the only stateful dependency. Redis, vector databases, and
external model APIs are not required. Mechanical download, conversion, OCR,
chunking, hashing, indexing, and publication do not consume AI tokens.

The pipeline runs continuously while enabled. Up to four isolated Luna
executors atomically lease expert, verification, analysis, or discovery work.
Pause stops new token-consuming work; Resume continues idempotently.

See [architecture](docs/ARCHITECTURE.md), [security](docs/SECURITY.md), and the
[Build Week execution log](docs/BUILD_WEEK_EXECUTION_PLAN.md).

## Quick start

Prerequisites:

- Node.js 24
- pnpm 10 or newer
- PostgreSQL 16
- Docker and Docker Compose if you want the included development database

```bash
cp .env.example .env
pnpm install --frozen-lockfile
docker compose up -d postgres
pnpm db:migrate
pnpm db:seed
pnpm build
pnpm dev:api
```

Run the deterministic worker in a second terminal:

```bash
pnpm dev:worker
```

Local endpoints:

- MCP: `http://127.0.0.1:8787/mcp`
- health: `http://127.0.0.1:8787/health`
- readiness: `http://127.0.0.1:8787/ready`
- restricted researcher MCP: `http://127.0.0.1:8788/mcp`
- local admin in development: `http://127.0.0.1:8790/admin`

The included Docker credentials are development-only. Production must use
separate API, worker, researcher, admin, and quarantine roles.

## Connect from Codex

Codex supports ChatGPT browser login through `codex login`; an API key is not
required for that login mode. Add the hosted Streamable HTTP server:

```bash
codex mcp add clideck --url https://mcp.clideck.com/mcp
codex mcp list
```

For a local instance:

```bash
codex mcp add clideck-local --url http://127.0.0.1:8787/mcp
```

Other MCP clients can connect to the same endpoint with their normal
Streamable HTTP configuration.

## Create your own Domain Pack

```bash
pnpm domain:create -- --id marine-science --name "Marine Science"
pnpm install --lockfile-only
pnpm domain:validate -- --id marine-science
pnpm --filter @clideck/domain-marine-science test
```

The scaffolder creates strict schemas, a mapper, a fixture, tests, and a
manifest compatible with `@clideck/domain-kit`. Then register the local pack
explicitly and add an additive catalog migration. Core never downloads and
executes pack code from a URL or an untrusted package.

Read:

- [Domain Pack authoring](docs/DOMAIN_PACK_AUTHORING.md)
- [Adapting a fork with Codex](docs/FORKING_WITH_CODEX.md)
- [Data and licensing notice](DATA-NOTICE.md)

## LAN operations console

The full console lives at `https://clideck-mcp.lan/admin`. It is served by a
separate loopback process behind LAN-only TLS. Authentication is one local
`super_admin` account with a scrypt password hash and a 12-hour Secure,
HttpOnly, SameSite-Strict session.

Run `sudo pnpm admin:setup` once, then follow the
[LAN admin runbook](docs/lan-admin-operations.md). The public MCP endpoint does
not expose this listener.

## Verification

```bash
pnpm check
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/clideck_mcp_test \
  pnpm test
pnpm build
pnpm eval
```

The integration database must be isolated and migrated. `pnpm eval` runs 250
deterministic product/security cases. The required dangerous false-safe result
is zero.

## Data, provenance, and license

Public MCP answers deliberately exclude source URLs, manual titles, quotations,
evidence fragments, and internal acquisition details. Minimal internal
provenance is nevertheless mandatory for every published revision and remains
restricted to `super_admin`.

The Apache-2.0 license covers source code and explicitly project-authored sample
fixtures. It does not grant rights to third-party documents, private production
knowledge, user data, or an operator's imported dataset. Production knowledge
and source documents are not distributed in this repository. See
[DATA-NOTICE.md](DATA-NOTICE.md).
