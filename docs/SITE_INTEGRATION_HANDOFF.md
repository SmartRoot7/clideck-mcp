# CliDeck website integration reference

Scope: the **separate website repository**, when the user requests website work.
This file is a contract reference, not an active cross-repository task. The
product page already exists; verify deployed state before recreating work.

Product: **CliDeck MCP — Network Knowledge**, at
`https://clideck.com/software/mcp`; endpoint `https://mcp.clideck.com/mcp`.
Use existing site design, product navigation and SEO. Explain deterministic,
version-aware answers, honest unknowns, research and immutable reuse; show actual
cached stats/evals and variable coverage, never a fixed historical launch count.

Playground tabs: Ask, Detect Device, Review Change, Verify, Upgrade, Topology.
Use [fixed BFF routes/security/limits](PLAYGROUND_API.md), server-only
`CLIDECK_MCP_BACKEND_URL` and `CLIDECK_MCP_PLAYGROUND_TOKEN`, accessible/responsive
charts and graphs, and graceful unavailable state. Preserve public privacy
contracts; do not claim full vendor support or automatic device execution.

## Optional remote admin

If `/admin/mcp` remains enabled, use fixed BFF routes, signed actor HMAC,
server-side RBAC, explicit response allowlists, audit and `no-store`.
Ordinary `admin` reads safe state; only `super_admin` receives mutation controls.
Local admin is the primary operations console; see
[retirement reference](lan-admin-operations.md).

Only pipeline state mutation:
`POST /api/admin/mcp/pipeline/state` → `POST /admin/v1/pipeline/state`,
body `{ enabled: boolean, reason?: string }`.
Display Pause/Resume, selected 1–8 capacity, current/queued work and executor
heartbeats. Pause stops AI within ten seconds; a running mechanical step may
finish. Safe Overview fields:

```text
pipeline_enabled paused_reason pause_requested_at pause_pending
max_concurrent_ai_runs active_luna_executors
queued_expert queued_verify queued_analyze queued_discover
processes[].worker_name instance_id heartbeat_at metadata healthy
```

Apply explicit nested filtering; never forward leases, source bodies, fragments,
credentials, DB configuration or private provenance. Throughput definitions:
[published metrics](ADMIN_PUBLISHED_METRICS_HANDOFF.md). Validate auth/RBAC,
redaction, contract, responsive/accessibility behavior and build in the website
repo before its own authorized deployment.
