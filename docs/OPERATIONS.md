# Operations

## Host and exposure

Production: `val@100.116.82.78` over Tailscale; internal `10.77.0.10`.
Former host `10.11.5.83` is rollback-only. The primary admin URL is
`https://clideck-mcp.taild43e46.ts.net/admin`; `.lan` is recovery-only.

Cloudflare Tunnel publishes the API's public routes at `mcp.clideck.com`.
API (8787), researcher (8788), admin (8790) and PostgreSQL listen on loopback;
Caddy exposes admin only to trusted networks. Application services are
`clideck-mcp-{api,worker,researcher,admin}.service`, under separate service users.
Supporting services: PostgreSQL, Caddy, cloudflared and backup timer.
Secrets are root-owned files in `/etc/clideck-mcp`, outside Git.

## Deploy

```bash
ops/scripts/deploy-production.sh
```

Only a clean `main` commit is deployable. Keep local/remote `main` synchronized.
The script owns preflight typecheck, disposable PostgreSQL migrations/seed/grants,
all integration tests, 250-case eval, build, remote Linux build, backup,
reconciliation, stats priming, atomic switch, services, smokes and rollback.
It preserves Pause/Resume, keeps capacity fixed at eight, and reloads a previously
running local Luna pool so executors use the deployed coordinator code.
Do not replace it with manual SSH/SCP, migrations, grants, symlinks or restarts.

Local deployment credentials: `.secrets/clideck-mcp-server.env`, host
`100.116.82.78`; override path with `CLIDECK_MCP_DEPLOY_SECRETS_FILE` if needed.
Authorize `sudo -v` interactively on the production host beforehand. The deploy
script checks `sudo -n` and stops before changes if authorization is absent.
Never save a sudo password; `sudo -K` invalidates the remote ticket.

Read [corrective log](PIPELINE_CORRECTIVE_ACTION_LOG.md) before pipeline work
or monitoring. Its latest production baseline and operational-only grants must
be checked before reconciliation; a healthy service is not proof of ingestion,
publication or a completed soak.

## Recovery and host moves

Failed post-switch checks trigger application, knowledge-release, environment
and pipeline-state rollback. Keep the previous release and backup. Knowledge
rollback reconstructs a selected release atomically without modifying revisions;
do not blindly reverse additive migrations.

Host transfer is owned only by `ops/scripts/migrate-production-host.sh`:
`preflight` → `prepare` → `rehearsal` → `cutover` → `verify`.
Cutover requires `CLIDECK_MCP_CONFIRM_CUTOVER=YES`. The script verifies manifests,
rehearses restore and pauses traffic-time writes. Rollback before new writes
requires `CLIDECK_MCP_CONFIRM_ROLLBACK=YES`; after new writes, the new database
must be migrated back instead of starting a stale copy. This is a recovery
reference, not an instruction to repeat the completed host move.

## Storage and backups

- Worker artifacts: `/var/lib/clideck-mcp/source-artifacts`, owner
  `clideck_mcp_worker:clideck_mcp`, mode `0750`; `SOURCE_STORAGE_DIR` and the
  unit's `ReadWritePaths` must agree. Preserve `ProtectSystem=strict` elsewhere.
- Backups: `/var/backups/clideck-mcp`, owner
  `clideck_mcp_backup:clideck_mcp`, mode `0700`.
- Backup policy: daily custom-format `pg_dump`, encrypted offsite transfer,
  14 daily and 8 weekly copies, monthly restore test. A timer success alone
  is insufficient: verify checksum and restore after host migration.
- Offsite destination and critical alert channel were previously external
  prerequisites; verify their actual configuration before claiming recovery
  readiness. This documentation review did not inspect production.

## Admin and monitoring

Use [LAN admin operations](lan-admin-operations.md). The optional website admin
BFF requires `ADMIN_TOKEN` plus an actor/role HMAC, a 120-second clock window,
nonce replay rejection, fixed routes, RBAC and `no-store`. Browser code must
never receive either signing secret. Ordinary admins are read-only and cannot
read private provenance; super admins own protected reads/mutations.

Check actual authenticated Overview response time, executor leases and end-to-end
progress, not just health endpoints. Track readiness, backlog/age, publication
failures, DB saturation, backup age, disk pressure and elevated 429/5xx rates.
The September 8 correction set PostgreSQL `jit=off`; preserve and verify this
configuration when moving/restoring the database (see the corrective log).
