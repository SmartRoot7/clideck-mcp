# Operations

## Network exposure

Only Cloudflare Tunnel publishes `https://mcp.clideck.com/mcp` and the public
health endpoint. The API binds to loopback on the server. The website reaches
the allowlisted playground facade with a shared BFF token. PostgreSQL and the
researcher process bind to loopback and must not be published.

## Services

```text
clideck-mcp-api.service
clideck-mcp-worker.service
clideck-mcp-researcher.service
cloudflared.service
postgresql.service
```

The three application services run as separate non-login users. Secrets live in
root-owned environment files outside the repository.

## Release

Full production deployment has exactly one supported entry point:

```bash
ops/scripts/deploy-production.sh
```

Do not manually reproduce its SSH, archive, migration, grant, symlink, restart,
or smoke-test steps. The script requires a clean commit on `main` and performs:

1. typecheck and production build;
2. a clean temporary PostgreSQL migration and seed;
3. every PostgreSQL integration test without skip;
4. the 250-case product eval;
5. an isolated Linux dependency install and build on `clideck-mcp.lan`;
6. a PostgreSQL and `/etc/clideck-mcp` backup;
7. preserve the current pipeline settings, pause Luna, and drain active leases;
8. additive migrations, least-privilege grants, reconciliation, seed, and
   public-stats cache priming;
9. an atomic `/opt/clideck-mcp/current` switch;
10. researcher, worker, API, and admin restart followed by restoration of the
    previous pipeline state;
11. local and public health, MCP discovery, retrieval, redaction, destructive
    advisory, verification-token, and upgrade smoke tests;
12. automatic application, knowledge-release, environment, and pipeline-state
    rollback when any post-switch check fails.

The default local credentials file is
`.secrets/clideck-mcp-server.env`; it is ignored by Git. Override it with
`CLIDECK_MCP_DEPLOY_SECRETS_FILE` when necessary. The previous immutable
release and deployment backup are retained for rollback.

Lab validation and initial legacy import are separate one-time release gates;
they are not repeated by every application deployment. Import only a lab report
whose commit equals the deployed commit.

Production uses separate API, admin, worker, researcher, and quarantine DB roles.
The site and backend share their playground token only through secret stores.

The worker stores temporary acquired documents under
`/var/lib/clideck-mcp/source-artifacts`. Create that directory with owner
`clideck_mcp_worker:clideck_mcp` and mode `0750`, set
`SOURCE_STORAGE_DIR=/var/lib/clideck-mcp/source-artifacts` in `worker.env`, and
keep the matching `ReadWritePaths=` allowlist in the worker systemd unit.
`ProtectSystem=strict` remains enabled for every other path.

## CliDeck site admin

The website reaches the admin API through explicit server-side BFF routes. Every
admin request requires both `ADMIN_TOKEN` and a short-lived signed actor envelope
using `CLIDECK_MCP_ADMIN_ACTOR_HMAC_SECRET`. The actor ID and role are included in
the HMAC input; mutation audit columns store the verified actor ID.

The backend accepts signatures within 120 seconds of its clock and rejects nonce
replay in the running API process. Keep the website and backend clocks
synchronized. Cloudflare Access is optional for this deployment; whether used
or not, never make the admin bearer token or HMAC secret available to browser
code.

`/admin/mcp` is an independent control center. It uses only fixed BFF mappings,
strict response filtering, `no-store`, bearer + HMAC, and server-side RBAC.
Enable the website feature flag only after testing all of these through the BFF:

1. `admin` can read Overview, Coverage, Sources, Pipeline, Active Source,
   Knowledge, Imports, Agent Runs, Expert Tasks, Quality, Lab, Conflicts,
   Releases, Feedback, and Approvals.
2. `admin` cannot read provenance, source URLs, or perform mutations.
3. `super_admin` can read provenance.
4. A confirmed release switch returns the complete active release.
5. A confirmed approval decision returns the complete updated approval.
6. Reusing a signed request nonce fails.

The control-center performance targets on the full release are p95 ≤1 second
for Overview and Knowledge pagination. Raw UUIDs are secondary labels; releases
use their sequence as the primary identifier.

## Backup

Run daily `pg_dump --format=custom`, encrypt before offsite transfer, retain 14
daily and 8 weekly copies, and test restore monthly. The repository does not
contain offsite credentials. Recovery is incomplete until offsite storage is
provided.

## Knowledge rollback

Use the admin release endpoint to atomically select a previously published
release. The server reconstructs the target from the nearest immutable
snapshot/checkpoint plus ordered deltas and replaces `active_knowledge_state`
inside the same transaction. This does not mutate or delete knowledge revisions.

Application rollback restores the previous checkout and services. Browser
rollback disables its playground feature flag. Knowledge rollback remains the
atomic release switch; schema migrations are not blindly reversed.

For the 0.3 rollout, rollback stops the launchd coordinator, restores the
previous backend checkout, and atomically activates release sequence 3. Imported
immutable revisions remain stored and are not deleted.

## Alerts

Alert on API readiness failure, worker heartbeat age, task backlog/age, failed
publication, DB saturation, backup age, disk pressure, and elevated 429/5xx
rates. A critical notification channel is still an external prerequisite.

## External release blockers

- `mcp.clideck.com` must resolve to the Cloudflare Tunnel.
- The site and backend need the same generated playground token.
- Offsite backup storage and a critical alert channel remain required.
