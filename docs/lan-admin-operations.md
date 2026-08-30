# CliDeck MCP LAN admin operations

The independent operations console is served primarily at
`https://clideck-mcp.taild43e46.ts.net/admin`, with
`https://clideck-mcp.lan/admin` retained for recovery. The Tailscale hostname
uses the certificate provided by tailscaled and requires no local DNS or CA
configuration. Caddy accepts HTTPS from the trusted Tailscale administrator
and the VM's internal recovery network, and
forwards it to the loopback-only `clideck-mcp-admin` process on port 8790.
The public Cloudflare tunnel continues to forward only the MCP API on port
8787.

## Initial setup

1. Build the complete application with `pnpm build`.
2. Run `sudo pnpm admin:setup`. This writes the scrypt password hash, random
   session secret and local actor UUID to `/etc/clideck-mcp/admin-ui.env` with
   mode `0600`.
3. Install `ops/systemd/clideck-mcp-admin.service`.
4. Install Caddy and copy `ops/caddy/Caddyfile` to `/etc/caddy/Caddyfile`.
   Set `caddy` as the local tailscaled operator so Caddy can request and renew
   the tailnet certificate. The provision and deploy scripts enforce this.
5. Confirm `clideck-mcp.taild43e46.ts.net` resolves through Tailscale. Resolve
   `clideck-mcp.lan` to `100.116.82.78` only when the recovery name is needed.
   Allow TCP 443 on `tailscale0` only from the administrator Mac
   `100.117.119.94`; do not open port 8790.
6. Start `clideck-mcp-admin` and reload Caddy.
7. The recovery `.lan` name additionally requires Caddy's local root CA in the
   trusted Mac System keychain. The primary Tailscale name does not.

The production `api.env` remains the source of DB role URLs and the internal
admin signing secrets. `admin-ui.env` contains only local authentication and
listener configuration.

The public Cloudflare Tunnel is independent from this hostname and continues
to publish only `127.0.0.1:8787`. PostgreSQL and researcher port 8788 are never
allowed through UFW.

## Validation

Run:

```sh
ops/scripts/admin-smoke-test.sh
```

Then validate login, every section, Pause/Resume, executor concurrency and an
audited non-destructive action in a browser. Keep the existing remote admin
enabled for a 24-hour comparison period.

## Final remote-admin cutover

After the LAN console has remained healthy for 24 hours:

1. Set `ENABLE_REMOTE_ADMIN_API=false` in the public API environment and
   restart `clideck-mcp-api`.
2. Ask the CliDeck website agent to set the existing MCP admin feature flag to
   false. Do not delete its implementation until one later release.
3. Confirm `https://mcp.clideck.com/admin/v1/overview` returns `404`, while
   the public MCP endpoint and LAN admin continue to work.

Exact prompt for the separate CliDeck website agent:

```text
Work only in the main CliDeck website repository. The independent CliDeck MCP
LAN admin has completed its 24-hour production soak. Disable the feature flag
that exposes /admin/mcp and its fixed /api/admin/mcp/* BFF routes. Do not delete
the implementation: retain it for one release as rollback. Verify unauthenticated
and authenticated navigation no longer exposes the MCP admin, run the focused
RBAC/BFF tests and production build, deploy normally, and return the commit SHA,
deployment result and HTTP checks. Do not change the clideck-mcp repository or
the public MCP endpoint.
```

## Rollback

Stop `clideck-mcp-admin`, restore the previous application checkout and re-enable
the existing website feature flag. The public MCP service, knowledge releases
and pipeline are independent of this console and do not need to be rolled back.
