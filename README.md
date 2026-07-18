# CliDeck MCP

**CliDeck MCP — Network Knowledge** is a deterministic, vendor-aware network
knowledge server for any Model Context Protocol client.

- Public endpoint: `https://mcp.clideck.com/mcp`
- Product page and playground: `https://clideck.com/software/mcp`
- Runtime: Node.js 24, TypeScript, Hono, Zod 4, MCP TypeScript SDK 1.29
- Storage: PostgreSQL 16 with full-text search and `pg_trgm`
- Processes: API, worker, and a restricted Codex researcher bridge
- No Redis, vector database, external LLM API, or AI in the read path

The public MCP response contains applicable vendor/platform/version context,
commands or procedures, risk, verification, rollback, freshness, confidence,
quality, conflicts, and limitations. Source URLs, manual titles, quotations,
internal identifiers, and acquisition-pipeline details are deliberately excluded
from the public contract. Internal provenance remains mandatory and is available
only to `super_admin`.

## Quick start

Prerequisites: Node.js 24, pnpm, Docker, and Docker Compose.

```bash
cp .env.example .env
pnpm install --frozen-lockfile
docker compose up -d postgres
pnpm db:migrate
pnpm db:seed
pnpm dev:api
```

The local endpoints are:

- MCP: `http://127.0.0.1:8787/mcp`
- health: `http://127.0.0.1:8787/health`
- readiness: `http://127.0.0.1:8787/ready`
- restricted researcher MCP: `http://127.0.0.1:8788/mcp`

Run the worker in a second terminal:

```bash
pnpm dev:worker
```

## Public tools

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

The 0.2 knowledge pack contains 50 published Catalyst 9300 / IOS-XE items:
20 operational commands, 15 change contracts, 10 post-change verification
contracts, and 5 upgrade records. Junos and Arista EOS snapshots can be
fingerprinted, but limited coverage is reported honestly instead of inferred.

CliDeck never connects to a network device and never executes a command. Raw CLI
is processed in memory. An example can enter the isolated 30-day quarantine only
through explicit consent; it is redacted again and never auto-published.

## Browser integration

The main site uses explicit Next.js BFF routes rather than an open proxy. The
backend facade is disabled unless `ENABLE_PLAYGROUND=true`, and requires
`PLAYGROUND_TOKEN` plus a daily HMAC client key. Aggregate statistics are
available at `GET /public/v1/stats` with a five-minute cache contract.

See [docs/PLAYGROUND_API.md](docs/PLAYGROUND_API.md) and
[docs/SITE_INTEGRATION_HANDOFF.md](docs/SITE_INTEGRATION_HANDOFF.md).

## Verification

```bash
pnpm check
pnpm test
pnpm eval
```

`pnpm eval` runs 250 deterministic product and safety scenarios and records only
the safe aggregate result for public statistics. Lab reports are commit-bound
and imported separately with `pnpm lab:import-report`.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/SECURITY.md](docs/SECURITY.md), and
[docs/OPERATIONS.md](docs/OPERATIONS.md) for the system contract and production
runbook.

## Scope boundary

This repository and `clideck-mcp.lan` are the only approved mutation targets.
Integration into the existing CliDeck admin application requires separate
approval.
