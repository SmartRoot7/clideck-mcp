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

1. Back up PostgreSQL and verify the previous checkout and knowledge release.
2. Build, typecheck, test PostgreSQL integration, and run the 250-case eval.
3. Run isolated Batfish/containerlab CI and download its hashed report.
4. Fetch the exact immutable Git commit on `clideck-mcp.lan`.
5. Install, build, and run migrations.
6. Import only a lab report whose commit equals the deployed commit.
7. Seed the 50-item pack and record the production eval result.
8. Restart researcher, worker, then API.
9. Verify health, readiness, stats, MCP tool discovery, known query, redaction,
   blocked change, failed verification, upgrade scope, and topology.
10. Enable the playground only when the site has the matching BFF token.
11. Preserve the previous checkout until smoke tests pass.

Production uses separate API, admin, worker, researcher, and quarantine DB roles.
The site and backend share their playground token only through secret stores.

## Backup

Run daily `pg_dump --format=custom`, encrypt before offsite transfer, retain 14
daily and 8 weekly copies, and test restore monthly. The repository does not
contain offsite credentials. Recovery is incomplete until offsite storage is
provided.

## Knowledge rollback

Use the admin release endpoint to atomically select a previously published
release. This does not mutate or delete knowledge revisions.

Application rollback restores the previous checkout and services. Browser
rollback disables its playground feature flag. Knowledge rollback remains the
atomic release switch; schema migrations are not blindly reversed.

## Alerts

Alert on API readiness failure, worker heartbeat age, task backlog/age, failed
publication, DB saturation, backup age, disk pressure, and elevated 429/5xx
rates. A critical notification channel is still an external prerequisite.

## External release blockers

- `mcp.clideck.com` must resolve to the Cloudflare Tunnel.
- The site and backend need the same generated playground token.
- Offsite backup storage and a critical alert channel remain required.
