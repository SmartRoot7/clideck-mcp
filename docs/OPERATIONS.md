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
2. Build, typecheck, run every PostgreSQL integration test without skip, and
   run the 250-case eval.
3. Run isolated Batfish/containerlab CI and download its hashed report.
4. Fetch the exact immutable Git commit on `clideck-mcp.lan`.
5. Install `poppler-utils` and `tesseract-ocr`, install application
   dependencies, build, run migrations, and reapply `ops/sql/grants.sql` with
   the migrator role.
6. Import only a lab report whose commit equals the deployed commit.
7. Confirm the pre-import active release contains exactly 51 revisions.
8. Verify the read-only legacy JSONL manifest and import all 56,747 records with
   resumable batches. Activate only the single 56,798-revision import release.
9. Restart researcher, worker, then API.
10. Verify health, readiness, stats, all fixed admin endpoints, MCP tool
   discovery, known query, redaction,
   blocked change, failed verification, upgrade scope, and topology.
11. Run one public source through acquire, convert, chunk, analyze, verify, and
   package publication; confirm the next coverage target is immediately queued.
12. Install and verify `com.clideck.mcp.pipeline`, then disable the old
   five-minute Codex automation.
13. Deploy the matching CliDeck site commit and enable the admin feature only
   when every backend contract returns 200 through bearer + HMAC.
14. Preserve the previous checkout until smoke tests pass.

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
release. This does not mutate or delete knowledge revisions.

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
