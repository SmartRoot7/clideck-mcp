# Researcher automation

The macOS launchd pool supervises `pipeline-executor-01` through `08`.
Each leases one useful task atomically through the restricted researcher bridge;
standby polling starts no Codex run. PostgreSQL owns task/lease state.
See [capacity policy](PIPELINE_CAPACITY_AUDIT.md) and read the
[corrective log](PIPELINE_CORRECTIVE_ACTION_LOG.md) before changes or monitoring.

## Runtime policy

`src/cli/pipeline-codex-policy.ts` and `src/domain/pipeline.ts` enforce:

- Default: `gpt-5.6-luna`, reasoning `low`.
- Medium reasoning: only `candidate_deep_review` and `demand_diagnosis`.
- Scoped fallback: `gpt-5.6-terra`/`medium` for those same two task types when
  the scheduler's circuit policy allows it; it is not a general model override.
- Web research: only expert research, source discovery and refresh. These enable
  `code_mode`, `code_mode_host` and `standalone_web_search` together.
- Other tasks have no web access. All runs are ephemeral, bounded, read-only,
  without inherited MCP servers, plugins, shell tools or application secrets.

Acquire, conversion/OCR, chunking, hashing, indexing and publication are worker
operations. Scheduling prioritizes useful work without reserving idle capacity;
publication activation is serialized transactionally.

## Local setup

Ignored `.secrets/researcher-bridge.env`:

```text
CLIDECK_RESEARCHER_URL=http://127.0.0.1:28788/mcp
CLIDECK_RESEARCHER_TOKEN=<researcher bearer token>
CLIDECK_PIPELINE_MODEL=gpt-5.6-luna
CLIDECK_PIPELINE_REASONING=low
CLIDECK_PIPELINE_CODEX_BINARY=/absolute/path/to/codex
CLIDECK_RESEARCHER_SSH_HOST=100.116.82.78
CLIDECK_RESEARCHER_SSH_USER=<restricted SSH user>
CLIDECK_RESEARCHER_SSH_IDENTITY=/absolute/path/to/private-key
CLIDECK_RESEARCHER_TUNNEL_PORT=28788
```

After the matching backend migration is healthy:

```bash
pnpm pipeline:install-launchd
pnpm pipeline:pool-status
launchctl print "gui/$(id -u)/com.clideck.mcp.pipeline-tunnel"
```

The tunnel is independent of the pool. Lease files live in
`.secrets/pipeline/<executor-id>/`; schemas/artifacts/usage in
`tmp/pipeline/<executor-id>/`. Never include credentials, lease tokens or another
executor's files in model prompts. Normal deployments manage pool reloads.

## Pause and recovery

Super-admin **Pause all Luna** calls `POST /admin/v1/pipeline/state` with
`{"enabled":false,"reason":"manual pause"}`; resume uses `{"enabled":true}`.
Runs poll control at most every five seconds and terminate within ten seconds,
discard partial output and return reservations. A running mechanical step may
finish; no new work is claimed while paused.

If backend controls are unavailable, use `pnpm pipeline:pool-stop` or
`pnpm pipeline:pool-start`; the tunnel remains available and abandoned leases
expire normally. Capacity is fixed at eight, not an operator throttle.
