# CliDeck MCP

**CliDeck MCP — Network Knowledge** is a deterministic, vendor-aware network
knowledge server for any Model Context Protocol client.

- Public endpoint: `https://mcp.clideck.com/mcp`
- Product page and playground: `https://clideck.com/software/mcp`
- Runtime: Node.js 24, TypeScript, Hono, Zod 4, MCP TypeScript SDK 1.29
- Storage: PostgreSQL 16 with full-text search and `pg_trgm`
- Processes: API, deterministic worker, restricted researcher bridge, and a
  continuous ephemeral Codex coordinator
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
- independent local admin: `http://127.0.0.1:8790/admin` (development only)

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

The native knowledge pack contains 50 published Catalyst 9300 / IOS-XE items:
20 operational commands, 15 change contracts, 10 post-change verification
contracts, and 5 upgrade records. Junos and Arista EOS snapshots can be
fingerprinted, but limited coverage is reported honestly instead of inferred.

CliDeck MCP 0.3 adds a continuous coverage planner and a manifest-verified
legacy migration. Its first production import release contains exactly 56,798
active revisions: 51 current revisions and 56,747 established CliDeck records.
The pipeline continuously discovers the next official public source, downloads
and converts it deterministically, analyzes bounded fragments with Luna low,
verifies them in an independent ephemeral run, and publishes one immutable
source package. It idles only when manually paused or after a recorded system
failure.

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

## LAN operations console

CliDeck MCP 0.5 includes its own React operations console at
`https://clideck-mcp.lan/admin`. A separate Hono process listens only on
loopback, while Caddy terminates local-CA TLS and accepts the trusted LAN.
Authentication is a single local `super_admin` account with a scrypt password
hash and a 12-hour secure, HttpOnly, SameSite-Strict session. The console has no
registration, email recovery or public listener.

Run `sudo pnpm admin:setup` once to create the root-owned local authentication
configuration. See [docs/lan-admin-operations.md](docs/lan-admin-operations.md)
for HTTPS installation, validation, remote-admin cutover and rollback.

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

The continuous coordinator and import runbook are documented in
[docs/RESEARCHER_AUTOMATION.md](docs/RESEARCHER_AUTOMATION.md) and
[docs/OPERATIONS.md](docs/OPERATIONS.md).

## OpenAI Build Week

CliDeck MCP 0.2 was built with Codex and GPT-5.6 as the primary engineering
workflow. Codex helped turn the initial product idea into the immutable revision
model, process boundaries, MCP contracts, deterministic safety rules, database
migrations, knowledge pack, tests, CI validation, and production runbook.

GPT-5.6 was especially useful where the design needed careful judgment rather
than code completion:

- defining when a network change must fail closed instead of returning a
  plausible answer;
- separating the deterministic read path from the Codex knowledge-research
  flywheel;
- designing signed post-change verification contracts that never contain raw
  commands;
- threat-modeling snapshot redaction, task isolation, contribution quarantine,
  and public telemetry;
- building the 250-case product/security eval and commit-bound lab policy;
- diagnosing production rollout failures without changing another project or
  server.

The main design decision was to use AI to grow and validate the knowledge base,
not to place an LLM in front of every network answer. Known questions remain
fast and repeatable. Unknown, unsupported, or dangerous inputs stop explicitly
or enter the controlled expert-task workflow.

### Judge test path

The fastest hosted test path is:

1. Connect an MCP client to `https://mcp.clideck.com/mcp`; no device
   credentials are required.
2. Ask for `show ip interface brief` on a Catalyst 9300 running IOS-XE 17.9.4
   and confirm the version-scoped deterministic answer.
3. Call `analyze_device_snapshot` with a sanitized `show version` sample and
   inspect the fingerprint, redactions, and `retention: not_stored`.
4. Send `reload` to `review_network_change` and confirm the critical change is
   blocked.
5. Review a safe description change, then call `verify_network_change` with
   identical before/after output and confirm rollback is recommended.
6. Pass CDP/LLDP or traceroute output to `analyze_network_path` and inspect the
   normalized graph and probable fault domain.

For a local test, follow **Quick start** above and use the same path at
`http://127.0.0.1:8787/mcp`. The repository includes deterministic seed data,
so judges do not need access to a network device, vendor image, external LLM
API, or private dataset.

## Scope boundary

This repository and `clideck-mcp.lan` are the only approved mutation targets.
The existing CliDeck website admin remains a temporary rollback path during the
LAN-console production soak. It is maintained in another repository and is not
modified here. After the soak, the public API's old signed remote-admin routes
can be disabled with `ENABLE_REMOTE_ADMIN_API=false`; the public MCP endpoint
is unaffected.
