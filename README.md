# CliDeck MCP

**CliDeck MCP — Network Knowledge** is a deterministic, vendor-aware network
knowledge server for any Model Context Protocol client.

- Public endpoint: `https://mcp.clideck.com/mcp`
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

## Verification

```bash
pnpm check
pnpm test
pnpm eval
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/SECURITY.md](docs/SECURITY.md), and
[docs/OPERATIONS.md](docs/OPERATIONS.md) for the system contract and production
runbook.

## Scope boundary

This repository and `clideck-mcp.lan` are the only approved mutation targets.
Integration into the existing CliDeck admin application requires separate
approval.
