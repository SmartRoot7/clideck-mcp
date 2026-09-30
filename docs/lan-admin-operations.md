# Local admin operations

Primary: `https://clideck-mcp.taild43e46.ts.net/admin` (tailscaled certificate).
Recovery: `https://clideck-mcp.lan/admin` (local DNS and trusted Caddy CA).
Caddy forwards trusted Tailscale/internal requests to loopback port 8790.
Cloudflare serves the public API on loopback 8787; PostgreSQL/researcher 8788
must remain private. See [Operations](OPERATIONS.md) for canonical deployment.

## Provisioning reference

`pnpm admin:setup` creates the scrypt password hash, random session secret and
actor UUID in `/etc/clideck-mcp/admin-ui.env` (mode `0600`). DB role URLs and
internal signing secrets remain in `api.env`. The web-admin password is separate
from the OS sudo password.

Provision/deploy scripts install `ops/systemd/clideck-mcp-admin.service` and
`ops/caddy/Caddyfile`, and configure Caddy as the local tailscaled operator.
Trusted administrator Mac: `100.117.119.94`; HTTPS is allowed from it on
`tailscale0`, not directly to port 8790. Use `100.116.82.78` for the recovery DNS
mapping only if needed. Do not replay setup/restart commands as a deployment.

## Validate

```bash
ops/scripts/admin-smoke-test.sh
```

Also check authenticated Overview, login, navigation, Pause/Resume, eight
executor cards and an authorized audited action in a browser. A health endpoint
alone cannot detect an Overview timeout. Deployment invalidates in-memory
sessions; reauthenticate instead of resetting credentials.

## Optional remote-admin retirement

The earlier 24-hour comparison/cutover plan is historical; completion has not
been established by this documentation audit. Verify the deployed flags first.
If explicitly retiring the website console, validate local admin, then change
`ENABLE_REMOTE_ADMIN_API` through the canonical release workflow and coordinate
the separate website feature flag in an authorized website task. Expect remote
`/admin/v1/overview` to return 404 while MCP and local admin remain healthy.
Keep the previous website implementation for rollback. Do not infer authority to
message another agent, deploy the website or manually restart production here.
