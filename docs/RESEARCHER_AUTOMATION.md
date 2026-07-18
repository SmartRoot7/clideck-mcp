# Parallel Luna pipeline

The macOS `launchd` service runs one local pool supervisor and four isolated
executor lanes. PostgreSQL is the source of truth for the configured
concurrency, which defaults to three and may be set from one through four.
Standby lanes poll the restricted researcher bridge but never start Codex until
they atomically lease useful work.

Credentials remain in the ignored `.secrets/researcher-bridge.env` file:

```text
CLIDECK_RESEARCHER_URL=http://127.0.0.1:28788/mcp
CLIDECK_RESEARCHER_TOKEN=<random researcher bearer token>
CLIDECK_PIPELINE_MODEL=gpt-5.6-luna
CLIDECK_PIPELINE_REASONING=low
CLIDECK_PIPELINE_CODEX_BINARY=/absolute/path/to/codex
CLIDECK_RESEARCHER_SSH_HOST=<fixed server LAN address>
CLIDECK_RESEARCHER_SSH_USER=<restricted SSH user>
CLIDECK_RESEARCHER_SSH_IDENTITY=/absolute/path/to/private-key
CLIDECK_RESEARCHER_TUNNEL_PORT=28788
```

The model and reasoning values are enforced in the database, coordinator, and
pool supervisor. Production AI work cannot run with anything except
`gpt-5.6-luna` and reasoning `low`.

Install or replace the pool after the matching backend migration is healthy:

```bash
pnpm pipeline:install-launchd
pnpm pipeline:pool-status
launchctl print "gui/$(id -u)/com.clideck.mcp.pipeline-tunnel"
```

The installer keeps the authenticated SSH tunnel separate from the Luna pool.
Each executor uses its own ignored lease directory:

```text
.secrets/pipeline/pipeline-executor-01/
.secrets/pipeline/pipeline-executor-02/
.secrets/pipeline/pipeline-executor-03/
.secrets/pipeline/pipeline-executor-04/
```

Temporary schemas, output, submissions, and usage files are likewise isolated
under `tmp/pipeline/<executor-id>/`. Every AI run is ephemeral and receives only
its bounded leased payload. Bearer tokens, leases, database credentials, and
other executor files are never included in prompts.

The scheduler reserves work in this order: expert, verify, analyze, then
discover/refresh. Acquire, conversion, OCR, chunking, indexing, and publication
remain deterministic worker operations. Publication is serialized with a
transaction advisory lock.

## Stopping token use

The normal control is the super-admin `Pause all Luna` action, backed by:

```http
POST /admin/v1/pipeline/state
{"enabled":false,"reason":"manual pause"}
```

Active Luna runs poll control at most every five seconds, terminate within ten
seconds, discard partial output, and return their reservations to the queue.
An already-running deterministic worker step may finish, but no new work is
claimed. Resume uses the same endpoint with `{"enabled":true}`.

If the website or backend control is unavailable, stop or start the local pool:

```bash
pnpm pipeline:pool-stop
pnpm pipeline:pool-start
```

The tunnel stays available. An emergency stop creates no AI token usage; any
unreported lease is recovered by the normal lease expiry policy.

Concurrency is changed by a super admin:

```http
POST /admin/v1/pipeline/concurrency
{"max_concurrent_ai_runs":3}
```

Scaling down is graceful: existing runs finish and no replacement run starts
until the active count is within the new limit. Scaling up fills newly available
slots on the next poll.
