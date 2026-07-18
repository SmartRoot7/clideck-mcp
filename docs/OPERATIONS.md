# Operations

## Network exposure

Only Cloudflare Tunnel publishes `https://mcp.clideck.com/mcp` and the public
health endpoint. The API binds to loopback on the server. PostgreSQL and the
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

1. Build and test in CI.
2. Fetch an immutable Git commit.
3. Install with `pnpm install --frozen-lockfile`.
4. Build and run migrations.
5. Restart researcher, worker, then API.
6. Verify `/health`, `/ready`, MCP initialize/tools/list, and the known Cisco
   query.
7. Preserve the previous checkout until smoke tests pass.

## Backup

Run daily `pg_dump --format=custom`, encrypt before offsite transfer, retain 14
daily and 8 weekly copies, and test restore monthly. The repository does not
contain offsite credentials. Recovery is incomplete until offsite storage is
provided.

## Knowledge rollback

Use the admin release endpoint to atomically select a previously published
release. This does not mutate or delete knowledge revisions.

## Alerts

Alert on API readiness failure, worker heartbeat age, task backlog/age, failed
publication, DB saturation, backup age, disk pressure, and elevated 429/5xx
rates. A critical notification channel is still an external prerequisite.
